import * as fs from 'node:fs';
import * as path from 'node:path';
import { Config, Task, Comment } from '../types';
import { TaskProvider } from '../providers';
import { AIRunner } from '../ai';
import { logger, logRunStart } from '../logger';
import { isScreenAvailable } from '../platform';
import * as git from '../git';
import { isGhAuthenticated, isGitHubRemote, createPullRequest } from '../github';
import { collectAndLogDiagnostics } from '../diagnostics';

const SKIP_STATUSES = new Set(['closed', 'done', 'cancelled', 'complete']);
const SLEEPING_MARKER = 'machine appears to be asleep';
export const DEFAULT_TRIGGER_WORD = 'aidev-continue';

export type RunFilter = 'all' | 'open' | 'pending';

export interface SubTask {
  id: number;
  title: string;
  description: string;
  status: 'pending' | 'running' | 'done' | 'failed';
}

export interface ThinkingTaskPlan {
  taskId: string;
  taskName: string;
  subtasks: SubTask[];
}

function isThinkingTask(task: Task, config: Config): boolean {
  if (!config.thinkingTag) return false;
  const tag = config.thinkingTag.toLowerCase();
  return task.tags.some((t) => t.toLowerCase() === tag);
}

function taskPlanPath(taskId: string): string {
  return path.join(process.cwd(), `${taskId}.aidev.task.json`);
}

function taskInstructionsPath(taskId: string): string {
  return path.join(process.cwd(), `${taskId}.aidev.instructions.md`);
}

function cleanupThinkingFiles(taskId: string): void {
  for (const p of [taskPlanPath(taskId), taskInstructionsPath(taskId)]) {
    try { fs.unlinkSync(p); } catch { /* already removed */ }
  }
}

function writeTaskPlan(plan: ThinkingTaskPlan): void {
  fs.writeFileSync(taskPlanPath(plan.taskId), JSON.stringify(plan, null, 2), 'utf8');
}

function readTaskPlan(taskId: string): ThinkingTaskPlan | null {
  const p = taskPlanPath(taskId);
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8')) as ThinkingTaskPlan;
  } catch {
    return null;
  }
}

function formatSubtaskList(plan: ThinkingTaskPlan): string {
  const icons: Record<SubTask['status'], string> = {
    pending: '⬜',
    running: '🔄',
    done: '✅',
    failed: '❌',
  };
  return plan.subtasks
    .map((s) => `${icons[s.status]} **${s.id}.** ${s.title} — _${s.status}_`)
    .join('\n');
}

export async function runCommand(
  filter: RunFilter,
  config: Config,
  provider: TaskProvider,
  runners: AIRunner[]
): Promise<void> {
  logRunStart();

  const screenAvailable = isScreenAvailable();
  if (!screenAvailable) {
    logger.warn('Screen is locked or display is asleep — AI agents cannot operate');
  }

  logger.info(`Fetching tasks (filter: ${filter})...`);
  const tasks = await provider.fetchTasks();
  logger.info(`Found ${tasks.length} tagged task(s)`);

  let processed = 0;
  let skipped = 0;

  for (const task of tasks) {
    const result = await processTask(task, filter, config, provider, runners, screenAvailable);
    if (result === 'processed') processed++;
    else skipped++;
  }

  logger.success(`Done. Processed: ${processed}, Skipped: ${skipped}`);
}

async function processTask(
  task: Task,
  filter: RunFilter,
  config: Config,
  provider: TaskProvider,
  runners: AIRunner[],
  screenAvailable: boolean
): Promise<'processed' | 'skipped'> {
  const isPending = task.status.toLowerCase() === config.clickupPendingStatus.toLowerCase();

  logger.task(`[${task.id}] "${task.name}" (status: ${task.status})`);

  if (SKIP_STATUSES.has(task.status.toLowerCase())) {
    logger.info(`[${task.id}] "${task.name}" skipped — terminal status: ${task.status}`);
    return 'skipped';
  }

  const branchName = `${task.id}/${git.slugify(task.name)}`;
  const branchExists = git.remoteBranchExists(config.gitRemote, branchName);

  if (filter === 'open' && isPending) {
    logger.info(`[${task.id}] "${task.name}" skipped — filter=open but task is pending`);
    return 'skipped';
  }
  if (filter === 'pending' && !isPending) {
    logger.info(`[${task.id}] "${task.name}" skipped — filter=pending but task is not pending`);
    return 'skipped';
  }

  if (isPending || branchExists) {
    const comments = await provider.getComments(task.id);
    const trigger = hasTriggerWord(comments, config.triggerWord);

    if (isPending) {
      const reply = hasHumanReply(comments);
      if (!reply && !trigger) {
        logger.info(`[${task.id}] "${task.name}" skipped — pending task has no human reply or trigger word ("${config.triggerWord}")`);
        return 'skipped';
      }
      logger.info(
        trigger
          ? `Trigger word "${config.triggerWord}" found — re-processing pending task`
          : 'Pending task has a human reply — proceeding'
      );
    } else {
      if (!trigger) {
        logger.info(`[${task.id}] "${task.name}" skipped — branch already exists (${branchName}) and no trigger word found`);
        return 'skipped';
      }
      logger.info(`Trigger word "${config.triggerWord}" found — re-processing task`);
    }

    if (!screenAvailable) {
      await notifySleeping(task, provider);
      return 'skipped';
    }
  } else {
    if (!screenAvailable) {
      await notifySleeping(task, provider);
      return 'skipped';
    }

    const clarification = await checkNeedsClarification(task, config, provider, runners);
    if (clarification) {
      await provider.postComment(task.id, `[aidev] ${clarification}`);
      await provider.updateStatus(task.id, config.clickupPendingStatus);
      logger.info(`Posted clarification question, set status to ${config.clickupPendingStatus}`);
      return 'skipped';
    }
  }

  if (isThinkingTask(task, config)) {
    await implementThinkingTask(task, branchName, branchExists, config, provider, runners);
  } else {
    await implementTask(task, branchName, branchExists, config, provider, runners);
  }
  return 'processed';
}

export function hasHumanReply(comments: Comment[]): boolean {
  if (comments.length < 2) return false;
  const lastComment = comments[comments.length - 1];
  return !lastComment.text.includes('[aidev]');
}

/**
 * Returns true if the last comment contains the trigger word.
 * DEFAULT_TRIGGER_WORD ('aidev-continue') is always recognised regardless of
 * the configured triggerWord, so it works out-of-the-box without env config.
 */
export function hasTriggerWord(comments: Comment[], triggerWord: string): boolean {
  if (comments.length === 0) return false;
  const lastText = comments[comments.length - 1].text.toLowerCase();
  if (lastText.includes(DEFAULT_TRIGGER_WORD)) return true;
  if (triggerWord && lastText.includes(triggerWord.toLowerCase())) return true;
  return false;
}

async function notifySleeping(task: Task, provider: TaskProvider): Promise<void> {
  try {
    const comments = await provider.getComments(task.id);
    const lastComment = comments.length > 0 ? comments[comments.length - 1] : null;
    if (lastComment && lastComment.text.includes(SLEEPING_MARKER)) {
      logger.debug(`[${task.id}] Already notified about sleep — skipping`);
      return;
    }
  } catch {
    // If we can't check comments, still attempt to post
  }

  try {
    await provider.postComment(
      task.id,
      `[aidev] Cannot work on this task — the ${SLEEPING_MARKER} or the screen is locked. ` +
        'AI agents require an active display session to operate. Please wake the machine and unlock the screen so I can continue.'
    );
    logger.info(`[${task.id}] Posted sleep notification`);
  } catch (err) {
    logger.warn(`[${task.id}] Failed to post sleep notification: ${err}`);
  }
}

export async function checkNeedsClarification(
  task: Task,
  config: Config,
  provider: TaskProvider,
  runners: AIRunner[]
): Promise<string | null> {
  if (config.devNotesMode === 'always') {
    return `Any dev notes or implementation preferences for this task?\n\nTask: ${task.name}`;
  }

  // smart mode: ask AI if the task is clear
  const availableRunners = runners.filter((r) => r.isAvailable());
  if (availableRunners.length === 0) {
    logger.warn('No AI runner available — skipping clarification check');
    return null;
  }

  const clarificationPrompt = `You are a senior software developer reviewing a task.
Determine if the following task has enough information to implement without further clarification.

Task name: ${task.name}
Task description: ${task.description || '(no description)'}

Respond with valid JSON only:
{
  "clear": true|false,
  "question": "question to ask if not clear, or null"
}`;

  for (const runner of availableRunners) {
    const result = await runner.run(clarificationPrompt);
    if (!result.success) {
      logger.warn(`${runner.name} clarification check failed — trying next runner`);
      continue;
    }

    try {
      const jsonMatch = result.output.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        logger.debug(`${runner.name} clarification response had no JSON — trying next runner`);
        continue;
      }
      const parsed = JSON.parse(jsonMatch[0]) as { clear: boolean; question?: string | null };
      if (!parsed.clear && parsed.question) {
        return parsed.question;
      }
      return null;
    } catch {
      logger.debug(`${runner.name} clarification response could not be parsed — trying next runner`);
    }
  }

  logger.warn('Clarification check failed for all runners — proceeding without clarification');
  return null;
}

async function implementTask(
  task: Task,
  branchName: string,
  branchExists: boolean,
  config: Config,
  provider: TaskProvider,
  runners: AIRunner[]
): Promise<void> {
  logger.info(`Implementing task: ${task.name}`);

  try {
    await provider.updateStatus(task.id, 'in progress');
    const verb = branchExists ? 'Continuing' : 'Starting';
    await provider.postComment(task.id, `[aidev] ${verb} implementation on branch \`${branchName}\``);
  } catch (err) {
    logger.warn(`Could not update task status: ${err}`);
  }

  if (branchExists) {
    if (!git.fetchAndCheckoutBranch(config.gitRemote, branchName)) {
      logger.error(`Failed to checkout existing branch ${branchName}`);
      await provider.postComment(task.id, '[aidev] Failed to checkout existing branch. Manual intervention needed.');
      return;
    }
    logger.info(`Continuing on existing branch: ${branchName}`);
  } else {
    if (!git.fetchAndCheckout(config.gitRemote, config.githubBaseBranch)) {
      logger.error('Failed to prepare base branch');
      await provider.postComment(task.id, '[aidev] Failed to prepare git branch. Manual intervention needed.');
      return;
    }

    if (!git.createBranch(branchName, config.githubBaseBranch)) {
      logger.error(`Failed to create branch ${branchName}`);
      return;
    }
  }

  // Get conversation context for pending tasks
  let context = '';
  try {
    const comments = await provider.getComments(task.id);
    if (comments.length > 0) {
      context = '\n\nConversation context:\n' + comments.map((c) => `${c.author}: ${c.text}`).join('\n');
    }
  } catch {
    // ignore
  }

  const implementPrompt = buildImplementPrompt(task, context);

  // Run AI runners in order with fallback
  let implemented = false;
  let previousNotes = '';

  for (const runner of runners) {
    if (!runner.isAvailable()) {
      logger.debug(`${runner.name} not available, skipping`);
      continue;
    }

    logger.info(`Running ${runner.name}...`);
    const result = await runner.run(implementPrompt, previousNotes || undefined);

    if (result.success && git.hasChanges()) {
      implemented = true;
      break;
    }

    if (!result.success) {
      logger.warn(`${runner.name} failed — trying next runner`);
      previousNotes = `Previous runner (${runner.name}) output:\n${result.output}\nErrors:\n${result.error}`;
    } else {
      logger.warn(`${runner.name} produced no file changes — trying next runner`);
      previousNotes = `Previous runner (${runner.name}) made no changes. Output:\n${result.output}`;
    }
  }

  if (!implemented) {
    logger.error('All AI runners failed or produced no changes');
    const diagnostics = collectAndLogDiagnostics();
    await provider.postComment(
      task.id,
      `[aidev] All AI runners failed. Manual implementation needed.\n\n${diagnostics}`
    );
    if (!branchExists) {
      git.deleteBranch(branchName);
    }
    return;
  }

  // Commit and push
  if (!git.addAll() || !git.commit(`[aidev] Implement: ${task.name}\n\nTask: ${task.url}`, branchName)) {
    logger.error('Failed to commit changes');
    return;
  }

  if (!git.push(config.gitRemote, branchName)) {
    logger.error('Failed to push branch');
    return;
  }

  // Try creating a PR via gh CLI, fall back to compare URL
  try {
    const prUrl = tryCreatePR(config, branchName, task);
    const comment = buildCompletionComment(branchName, prUrl, config);
    await provider.postComment(task.id, comment);
    await provider.updateStatus(task.id, config.clickupInReviewStatus);
  } catch (err) {
    logger.warn(`Branch pushed but failed to update task: ${err instanceof Error ? err.message : err}`);
  }

  logger.success(`Task implemented: branch ${branchName} pushed`);
}

export function buildImplementPrompt(task: Task, context: string): string {
  return `You are implementing a software development task. Make the necessary code changes to complete the task described below.

Task: ${task.name}

Description:
${task.description || '(no description provided)'}
${context}

Please implement the required changes. Focus on correctness and follow the existing code style in the project.`;
}

async function analyzeAndPlan(
  task: Task,
  context: string,
  runners: AIRunner[]
): Promise<ThinkingTaskPlan | null> {
  const runner = runners.find((r) => r.isAvailable());
  if (!runner) {
    logger.error('No AI runner available for task analysis');
    return null;
  }

  const analysisPrompt = `You are a senior software architect breaking down a development task into smaller, sequential implementation steps.

Task name: ${task.name}

Description:
${task.description || '(no description provided)'}
${context}

Analyze this task and break it into smaller, independently implementable sub-tasks that should be executed sequentially. Each sub-task should be a coherent unit of work that can be committed separately.

Respond with valid JSON only — no markdown fences, no extra text:
{
  "instructions": "Detailed implementation instructions in markdown covering the full task — architecture decisions, key files to modify, edge cases to handle, testing approach",
  "subtasks": [
    {
      "id": 1,
      "title": "Short title for the sub-task",
      "description": "Detailed description of what to implement in this step, including specific files and functions to change"
    }
  ]
}

Keep sub-tasks focused: 2-6 sub-tasks is ideal. Order them by dependency (foundation first).`;

  logger.info('Analyzing task and creating implementation plan...');
  const result = await runner.run(analysisPrompt);
  if (!result.success) {
    logger.error('Task analysis failed');
    return null;
  }

  try {
    const jsonMatch = result.output.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      logger.error('Could not parse analysis response — no JSON found');
      return null;
    }
    const parsed = JSON.parse(jsonMatch[0]) as {
      instructions: string;
      subtasks: Array<{ id: number; title: string; description: string }>;
    };

    if (!parsed.subtasks || parsed.subtasks.length === 0) {
      logger.error('Analysis produced no sub-tasks');
      return null;
    }

    const plan: ThinkingTaskPlan = {
      taskId: task.id,
      taskName: task.name,
      subtasks: parsed.subtasks.map((s, i) => ({
        id: s.id ?? i + 1,
        title: s.title,
        description: s.description,
        status: 'pending' as const,
      })),
    };

    fs.writeFileSync(
      taskInstructionsPath(task.id),
      parsed.instructions || `# Implementation Plan: ${task.name}\n\nSee ${task.id}.aidev.task.json for sub-tasks.`,
      'utf8'
    );
    writeTaskPlan(plan);

    return plan;
  } catch (err) {
    logger.error(`Failed to parse analysis response: ${err}`);
    return null;
  }
}

async function executeSubTask(
  subtask: SubTask,
  task: Task,
  plan: ThinkingTaskPlan,
  config: Config,
  runners: AIRunner[]
): Promise<boolean> {
  const instructionsPath = taskInstructionsPath(task.id);
  const instructions = fs.existsSync(instructionsPath)
    ? fs.readFileSync(instructionsPath, 'utf8')
    : '';

  const completedSteps = plan.subtasks
    .filter((s) => s.status === 'done')
    .map((s) => `  - [done] ${s.id}. ${s.title}`)
    .join('\n');

  const prompt = `You are implementing step ${subtask.id} of a multi-step task.

Overall task: ${task.name}
${task.description ? `\nTask description:\n${task.description}` : ''}

## Full implementation instructions
${instructions}

## Progress
${completedSteps || '(no steps completed yet)'}

## Current step: ${subtask.id}. ${subtask.title}
${subtask.description}

Implement ONLY this step. Focus on correctness and follow the existing code style.`;

  let implemented = false;
  let previousNotes = '';

  for (const runner of runners) {
    if (!runner.isAvailable()) continue;

    logger.info(`  Running ${runner.name} for step ${subtask.id}...`);
    const result = await runner.run(prompt, previousNotes || undefined);

    if (result.success && git.hasChanges()) {
      implemented = true;
      break;
    }

    if (!result.success) {
      logger.warn(`  ${runner.name} failed — trying next runner`);
      previousNotes = `Previous runner (${runner.name}) output:\n${result.output}\nErrors:\n${result.error}`;
    } else {
      logger.warn(`  ${runner.name} produced no file changes — trying next runner`);
      previousNotes = `Previous runner (${runner.name}) made no changes. Output:\n${result.output}`;
    }
  }

  return implemented;
}

async function implementThinkingTask(
  task: Task,
  branchName: string,
  branchExists: boolean,
  config: Config,
  provider: TaskProvider,
  runners: AIRunner[]
): Promise<void> {
  logger.info(`Implementing thinking task: ${task.name}`);

  try {
    await provider.updateStatus(task.id, 'in progress');
    const verb = branchExists ? 'Continuing' : 'Starting';
    await provider.postComment(
      task.id,
      `[aidev] ${verb} implementation on branch \`${branchName}\` (thinking mode — will analyze and break into sub-tasks)`
    );
  } catch (err) {
    logger.warn(`Could not update task status: ${err}`);
  }

  if (branchExists) {
    if (!git.fetchAndCheckoutBranch(config.gitRemote, branchName)) {
      logger.error(`Failed to checkout existing branch ${branchName}`);
      await provider.postComment(task.id, '[aidev] Failed to checkout existing branch. Manual intervention needed.');
      return;
    }
    logger.info(`Continuing on existing branch: ${branchName}`);
  } else {
    if (!git.fetchAndCheckout(config.gitRemote, config.githubBaseBranch)) {
      logger.error('Failed to prepare base branch');
      await provider.postComment(task.id, '[aidev] Failed to prepare git branch. Manual intervention needed.');
      return;
    }

    if (!git.createBranch(branchName, config.githubBaseBranch)) {
      logger.error(`Failed to create branch ${branchName}`);
      return;
    }
  }

  let context = '';
  try {
    const comments = await provider.getComments(task.id);
    if (comments.length > 0) {
      context = '\n\nConversation context:\n' + comments.map((c) => `${c.author}: ${c.text}`).join('\n');
    }
  } catch { /* ignore */ }

  // Check for an existing plan (resume scenario)
  let plan = readTaskPlan(task.id);
  if (plan) {
    logger.info(`Found existing task plan with ${plan.subtasks.length} sub-tasks — resuming`);
  } else {
    plan = await analyzeAndPlan(task, context, runners);
    if (!plan) {
      logger.error('Failed to create implementation plan');
      await provider.postComment(task.id, '[aidev] Failed to analyze and break down the task. Manual implementation needed.');
      cleanupThinkingFiles(task.id);
      if (!branchExists) git.deleteBranch(branchName);
      return;
    }

    logger.info(`Task broken into ${plan.subtasks.length} sub-tasks`);

    try {
      await provider.postComment(
        task.id,
        `[aidev] Task analyzed and broken into ${plan.subtasks.length} sub-tasks:\n\n${formatSubtaskList(plan)}`
      );
    } catch (err) {
      logger.warn(`Failed to post breakdown comment: ${err}`);
    }
  }

  let allSucceeded = true;

  for (const subtask of plan.subtasks) {
    if (subtask.status === 'done') {
      logger.info(`  Step ${subtask.id} already done — skipping`);
      continue;
    }

    subtask.status = 'running';
    writeTaskPlan(plan);

    logger.info(`  Starting step ${subtask.id}: ${subtask.title}`);
    const success = await executeSubTask(subtask, task, plan, config, runners);

    if (!success) {
      subtask.status = 'failed';
      writeTaskPlan(plan);
      allSucceeded = false;
      logger.error(`  Step ${subtask.id} failed: ${subtask.title}`);
      const diagnostics = collectAndLogDiagnostics();

      try {
        await provider.postComment(
          task.id,
          `[aidev] Step ${subtask.id} failed: ${subtask.title}\n\n${formatSubtaskList(plan)}\n\n${diagnostics}`
        );
      } catch { /* ignore */ }

      break;
    }

    if (!git.addAll() || !git.commit(`[aidev] Step ${subtask.id}: ${subtask.title}\n\nTask: ${task.url}`, branchName)) {
      subtask.status = 'failed';
      writeTaskPlan(plan);
      allSucceeded = false;
      logger.error(`  Failed to commit step ${subtask.id}`);
      break;
    }

    if (!git.push(config.gitRemote, branchName)) {
      subtask.status = 'failed';
      writeTaskPlan(plan);
      allSucceeded = false;
      logger.error(`  Failed to push step ${subtask.id}`);
      break;
    }

    subtask.status = 'done';
    writeTaskPlan(plan);
    logger.success(`  Step ${subtask.id} complete: ${subtask.title}`);

    try {
      await provider.postComment(
        task.id,
        `[aidev] Step ${subtask.id} complete: ${subtask.title}\n\n${formatSubtaskList(plan)}`
      );
    } catch { /* ignore */ }
  }

  cleanupThinkingFiles(task.id);

  if (!allSucceeded) {
    logger.error('Thinking task did not complete all sub-tasks');
    try {
      const diagnostics = collectAndLogDiagnostics();
      await provider.postComment(
        task.id,
        `[aidev] Thinking task did not complete all sub-tasks. Manual intervention needed.\n\n${diagnostics}`
      );
    } catch { /* ignore */ }
    return;
  }

  try {
    const prUrl = tryCreatePR(config, branchName, task);
    const comment = buildCompletionComment(branchName, prUrl, config);
    await provider.postComment(task.id, comment);
    await provider.updateStatus(task.id, config.clickupInReviewStatus);
  } catch (err) {
    logger.warn(`Branch pushed but failed to update task: ${err instanceof Error ? err.message : err}`);
  }

  logger.success(`Thinking task implemented: branch ${branchName} pushed`);
}

/**
 * Attempts to create a PR via `gh` CLI. Falls back to a compare URL if gh is
 * unavailable or PR creation fails.
 */
export function tryCreatePR(config: Config, branch: string, task: Task): string {
  if (isGitHubRemote(config.gitRemote) && isGhAuthenticated()) {
    const result = createPullRequest(
      config.githubBaseBranch,
      branch,
      task.name,
      `Implements: ${task.url}\n\nAutomated PR by aidev.`,
    );
    if (result.success) return result.url;
    logger.warn('Falling back to compare URL');
  }
  return buildPRUrl(config, branch);
}

export function buildPRUrl(config: Config, branch: string): string {
  if (!config.githubRepo) return '';
  const encoded = encodeURIComponent(branch);
  return `https://github.com/${config.githubRepo}/compare/${config.githubBaseBranch}...${encoded}?expand=1`;
}

export function buildCompletionComment(branch: string, prUrl: string, config: Config): string {
  const lines = [
    `[aidev] Implementation complete!`,
    ``,
    `Branch: \`${branch}\``,
  ];

  if (prUrl) {
    lines.push(`Open PR: ${prUrl}`);
  }

  lines.push(``, `Status set to: ${config.clickupInReviewStatus}`);
  return lines.join('\n');
}

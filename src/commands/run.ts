import { Config, Task, Comment } from '../types';
import { TaskProvider } from '../providers';
import { AIRunner } from '../ai';
import { logger, logRunStart } from '../logger';
import * as git from '../git';

const SKIP_STATUSES = new Set(['closed', 'done', 'cancelled', 'complete']);

export type RunFilter = 'all' | 'open' | 'pending';

export async function runCommand(
  filter: RunFilter,
  config: Config,
  provider: TaskProvider,
  runners: AIRunner[]
): Promise<void> {
  logRunStart();
  logger.info(`Fetching tasks (filter: ${filter})...`);
  const tasks = await provider.fetchTasks();
  logger.info(`Found ${tasks.length} tagged task(s)`);

  let processed = 0;
  let skipped = 0;

  for (const task of tasks) {
    const result = await processTask(task, filter, config, provider, runners);
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
  runners: AIRunner[]
): Promise<'processed' | 'skipped'> {
  const isPending = task.status.toLowerCase() === config.clickupPendingStatus.toLowerCase();

  logger.task(`[${task.id}] "${task.name}" (status: ${task.status})`);

  // Skip terminal statuses
  if (SKIP_STATUSES.has(task.status.toLowerCase())) {
    logger.debug(`Skipping — terminal status: ${task.status}`);
    return 'skipped';
  }

  // Skip if remote branch already exists for this task
  const branchName = `${task.id}/${git.slugify(task.name)}`;
  if (git.remoteBranchExists(config.gitRemote, branchName)) {
    logger.debug(`Skipping — branch already exists: ${branchName}`);
    return 'skipped';
  }

  // Apply filter
  if (filter === 'open' && isPending) {
    logger.debug('Skipping — filter=open, task is pending');
    return 'skipped';
  }
  if (filter === 'pending' && !isPending) {
    logger.debug('Skipping — filter=pending, task is not pending');
    return 'skipped';
  }

  // Handle pending tasks: check if a human replied
  if (isPending) {
    const hasReply = await checkForHumanReply(task, provider);
    if (!hasReply) {
      logger.debug('Skipping — pending task has no human reply yet');
      return 'skipped';
    }
    logger.info('Pending task has a human reply — proceeding');
  } else {
    // Check if task needs clarification
    const clarification = await checkNeedsClarification(task, config, provider, runners);
    if (clarification) {
      await provider.postComment(task.id, clarification);
      await provider.updateStatus(task.id, config.clickupPendingStatus);
      logger.info(`Posted clarification question, set status to ${config.clickupPendingStatus}`);
      return 'skipped';
    }
  }

  // Implement the task
  await implementTask(task, branchName, config, provider, runners);
  return 'processed';
}

async function checkForHumanReply(task: Task, provider: TaskProvider): Promise<boolean> {
  const comments = await provider.getComments(task.id);
  if (comments.length < 2) return false;

  // The last comment should be from a human (not a bot — heuristic: not containing "[aidev]")
  const lastComment = comments[comments.length - 1];
  return !lastComment.text.includes('[aidev]');
}

async function checkNeedsClarification(
  task: Task,
  config: Config,
  provider: TaskProvider,
  runners: AIRunner[]
): Promise<string | null> {
  if (config.devNotesMode === 'always') {
    return `Any dev notes or implementation preferences for this task?\n\nTask: ${task.name}`;
  }

  // smart mode: ask AI if the task is clear
  const runner = runners.find((r) => r.isAvailable());
  if (!runner) {
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

  const result = await runner.run(clarificationPrompt);
  if (!result.success) {
    logger.warn('Clarification check failed — proceeding without clarification');
    return null;
  }

  try {
    const jsonMatch = result.output.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    const parsed = JSON.parse(jsonMatch[0]) as { clear: boolean; question?: string | null };
    if (!parsed.clear && parsed.question) {
      return parsed.question;
    }
  } catch {
    logger.debug('Could not parse clarification response — proceeding');
  }

  return null;
}

async function implementTask(
  task: Task,
  branchName: string,
  config: Config,
  provider: TaskProvider,
  runners: AIRunner[]
): Promise<void> {
  logger.info(`Implementing task: ${task.name}`);

  // Mark as in progress
  try {
    await provider.updateStatus(task.id, 'in progress');
    await provider.postComment(task.id, `[aidev] Starting implementation on branch \`${branchName}\``);
  } catch (err) {
    logger.warn(`Could not update task status: ${err}`);
  }

  // Prepare git branch
  if (!git.fetchAndCheckout(config.gitRemote, config.githubBaseBranch)) {
    logger.error('Failed to prepare base branch');
    await provider.postComment(task.id, '[aidev] Failed to prepare git branch. Manual intervention needed.');
    return;
  }

  if (!git.createBranch(branchName)) {
    logger.error(`Failed to create branch ${branchName}`);
    return;
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
    await provider.postComment(task.id, '[aidev] All AI runners failed. Manual implementation needed.');
    git.deleteBranch(branchName);
    return;
  }

  // Commit and push
  if (!git.addAll() || !git.commit(`[aidev] Implement: ${task.name}\n\nTask: ${task.url}`)) {
    logger.error('Failed to commit changes');
    return;
  }

  if (!git.push(config.gitRemote, branchName)) {
    logger.error('Failed to push branch');
    return;
  }

  // Post completion comment
  try {
    const prUrl = buildPRUrl(config, branchName);
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

import * as fs from 'node:fs';
import * as path from 'node:path';
import { Config, Task, Comment } from '../types';
import { TaskProvider } from '../providers';
import { AIRunner } from '../ai';
import { logger, logRunStart } from '../logger';
import { isScreenAvailable } from '../platform';
import * as git from '../git';
import {
  isGhAuthenticated, isGhInstalled, isGitHubRemote, createPullRequest,
  getPrNumberForBranch, fetchUnresolvedReviewThreads, resolveReviewThread,
  replyToReviewThread, filterUnresolvedByNonAidev,
  ReviewThread,
} from '../github';
import { collectAndLogDiagnostics } from '../diagnostics';
import { acquireLock, releaseLock, readLock } from '../lockfile';
import {
  AidevHooks, HookVM, executeHook,
  RunContext, TaskContext, ResolveConflictsContext, NonCodeTaskContext, ThinkingTaskContext,
  ReviewTaskContext,
} from '../hooks';
import { buildCompressedContext } from '../sessions';
import { resolveDoneStatus } from './accepted';

const SKIP_STATUSES = new Set(['closed', 'done', 'cancelled', 'complete']);
const NO_PRIORITY = Number.MAX_SAFE_INTEGER;
const SLEEPING_MARKER = 'machine appears to be asleep';
export const DEFAULT_TRIGGER_WORD = 'aidev-continue';

export function getPendingStatus(config: Config): string {
  const p = (config.provider || 'clickup').toLowerCase();
  if (p === 'jira') return config.jiraPendingStatus;
  if (p === 'linear') return config.linearPendingStatus;
  if (p === 'notion') return config.notionPendingStatus;
  if (p === 'trello') return config.trelloPendingStatus;
  return config.clickupPendingStatus;
}

export function getOpenStatus(config: Config): string {
  const p = (config.provider || 'clickup').toLowerCase();
  if (p === 'jira') return 'open';
  if (p === 'linear') return 'open';
  if (p === 'trello') return config.trelloOpenStatus || 'open';
  return config.clickupOpenStatus || 'open';
}

export function getInReviewStatus(config: Config): string {
  const p = (config.provider || 'clickup').toLowerCase();
  if (p === 'jira') return config.jiraInReviewStatus;
  if (p === 'linear') return config.linearInReviewStatus;
  if (p === 'notion') return config.notionInReviewStatus;
  if (p === 'trello') return config.trelloInReviewStatus;
  return config.clickupInReviewStatus;
}

export type RunFilter = 'all' | 'open' | 'pending' | 'review';

export interface SubTask {
  id: number | string;
  title: string;
  description: string;
  status: 'pending' | 'running' | 'done' | 'failed';
  attempts: number;
  lastError?: string;
}

export interface ThinkingTaskPlan {
  taskId: string;
  taskName: string;
  /** Short summary of the ticket goal for compact sub-task prompts (from analyze step). */
  taskSummary?: string;
  subtasks: SubTask[];
}

export function getRunSkipReason(status: string, filter: RunFilter, pendingStatus: string, openStatus: string = 'open'): string | null {
  const normalizedStatus = status.toLowerCase();
  const normalizedPendingStatus = pendingStatus.toLowerCase();
  const normalizedOpenStatus = openStatus.toLowerCase();
  const isPending = normalizedStatus === normalizedPendingStatus;
  const isOpen = normalizedStatus === normalizedOpenStatus;

  if (SKIP_STATUSES.has(normalizedStatus)) {
    return `terminal status: ${status}`;
  }

  if (!isOpen && !isPending) {
    return `status "${status}" is not open or pending`;
  }

  if (filter === 'open' && isPending) {
    return 'filter=open but task is pending';
  }

  if (filter === 'pending' && !isPending) {
    return 'filter=pending but task is not pending';
  }

  // The UI exposes a dedicated 'review' button that only walks the in-review
  // queue (see runCommand's review phase). All other tasks must be skipped.
  if (filter === 'review') {
    return 'filter=review skips open/pending tasks';
  }

  return null;
}

export function isThinkingTask(task: Task, config: Config): boolean {
  if (!config.thinkingTag) return false;
  const tag = config.thinkingTag.toLowerCase();
  return task.tags.some((t) => t.toLowerCase() === tag);
}

export function isPlanningTask(task: Task, config: Config): boolean {
  if (!config.planningTag) return false;
  const tag = config.planningTag.toLowerCase();
  return task.tags.some((t) => t.toLowerCase() === tag);
}

export interface PlanningSubtaskDraft {
  title: string;
  description: string;
  priority?: number;
}

export interface PlanningAnalysisResponse {
  clarification?: string;
  subtasks: PlanningSubtaskDraft[];
}

export function buildPlanningAnalysisPrompt(task: Task, context: string): string {
  const tagsLine = task.tags.length > 0
    ? `\nParent task tags: ${task.tags.join(', ')}`
    : '';

  return `You are a senior software architect operating in PLANNING MODE. Your job is to break a parent task into a list of fully self-contained sub-task tickets that will be pushed to the task management provider and worked on independently — each by a different agent, in isolation, with NO access to the parent task or to its sibling sub-tasks.

Parent task name: ${task.name}

Parent task description:
${task.description || '(no description provided)'}${tagsLine}
${context}

Decide one of:
  (a) If critical information is missing and you cannot produce useful self-contained sub-tasks without it, return a single clarification question.
  (b) Otherwise, return a list of sub-task drafts.

CRITICAL — each sub-task description MUST be fully isolated:
  - Do NOT reference the parent task, sibling sub-tasks, or "the plan".
  - Do NOT use phrases like "as discussed above", "see the parent ticket", "from step 1", or "after the previous sub-task". The agent executing this sub-task will not see any of that.
  - Include every file path, function name, schema, constraint, reasoning, and reference the executing agent will need to complete the work standalone.
  - Restate any shared context (architecture decisions, conventions, motivation) that is required to do the work correctly.
  - Each description should read like its own complete ticket — title, what to change, why, where, and acceptance criteria.

Sub-task priority is optional and uses an integer 1–4 (1 = urgent, 4 = low). Omit the field if you have no opinion.

Respond with valid JSON only — no markdown fences, no extra text:
{
  "clarification": "question text, or null if no clarification is needed",
  "subtasks": [
    {
      "title": "Short, specific title",
      "description": "Fully self-contained ticket body (markdown ok). Include all paths, references, and reasoning needed to do this work without seeing the parent ticket.",
      "priority": 2
    }
  ]
}

If you set "clarification" to a non-null question, "subtasks" must be an empty array. If you provide sub-tasks, "clarification" must be null.`;
}

export function parsePlanningResponse(output: string): PlanningAnalysisResponse | null {
  const jsonMatch = output.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== 'object') return null;
  const obj = parsed as { clarification?: unknown; subtasks?: unknown };

  let clarification: string | undefined;
  if (typeof obj.clarification === 'string') {
    const trimmed = obj.clarification.trim();
    if (trimmed.length > 0 && trimmed.toLowerCase() !== 'null') {
      clarification = trimmed;
    }
  }

  const rawSubtasks = Array.isArray(obj.subtasks) ? obj.subtasks : [];
  const subtasks: PlanningSubtaskDraft[] = [];
  for (const s of rawSubtasks) {
    if (!s || typeof s !== 'object') continue;
    const entry = s as { title?: unknown; description?: unknown; priority?: unknown };
    const title = typeof entry.title === 'string' ? entry.title.trim() : '';
    const description = typeof entry.description === 'string' ? entry.description.trim() : '';
    if (!title || !description) continue;

    const draft: PlanningSubtaskDraft = { title, description };
    if (typeof entry.priority === 'number' && Number.isFinite(entry.priority)) {
      draft.priority = entry.priority;
    }
    subtasks.push(draft);
  }

  if (!clarification && subtasks.length === 0) return null;

  return clarification ? { clarification, subtasks } : { subtasks };
}

export function sortTasksByPriority(tasks: Task[]): Task[] {
  return [...tasks].sort(
    (a, b) => (a.priority ?? NO_PRIORITY) - (b.priority ?? NO_PRIORITY)
  );
}

function taskPlanPath(taskId: string): string {
  return path.join(process.cwd(), `${taskId}.aidev.task.json`);
}

function taskInstructionsPath(taskId: string): string {
  return path.join(process.cwd(), `${taskId}.aidev.instructions.md`);
}

const THINKING_TASK_JSON_SUFFIX = '.aidev.task.json';
const THINKING_INSTRUCTIONS_SUFFIX = '.aidev.instructions.md';

/** 30 days — stale `.aidev.task.json` / `.aidev.instructions.md` files are removed. Exported for tests. */
export const THINKING_ARTIFACT_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

function effectiveFileCreationMs(stat: fs.Stats): number {
  const b = stat.birthtimeMs;
  if (Number.isFinite(b) && b > 0) return b;
  return stat.mtimeMs;
}

/**
 * Removes thinking artifact files in `cwd` older than {@link THINKING_ARTIFACT_MAX_AGE_MS}.
 * Uses birth time when available, otherwise mtime (Linux often lacks birthtime).
 */
export function cleanupStaleThinkingArtifacts(cwd: string = process.cwd(), nowMs: number = Date.now()): void {
  let entries: string[];
  try {
    entries = fs.readdirSync(cwd);
  } catch {
    return;
  }
  for (const name of entries) {
    if (
      !name.endsWith(THINKING_TASK_JSON_SUFFIX)
      && !name.endsWith(THINKING_INSTRUCTIONS_SUFFIX)
    ) {
      continue;
    }
    const full = path.join(cwd, name);
    let stat: fs.Stats;
    try {
      stat = fs.statSync(full);
    } catch {
      continue;
    }
    if (!stat.isFile()) continue;
    if (nowMs - effectiveFileCreationMs(stat) <= THINKING_ARTIFACT_MAX_AGE_MS) continue;
    try {
      fs.unlinkSync(full);
    } catch { /* ignore */ }
  }
}

function cleanupThinkingFiles(taskId: string): void {
  for (const p of [taskPlanPath(taskId), taskInstructionsPath(taskId)]) {
    try { fs.unlinkSync(p); } catch { /* already removed */ }
  }
}

export function writeTaskPlan(plan: ThinkingTaskPlan): void {
  fs.writeFileSync(taskPlanPath(plan.taskId), JSON.stringify(plan, null, 2), 'utf8');
}

function truncateError(msg: string): string {
  const MAX_LEN = 4096;
  if (msg.length <= MAX_LEN) return msg;
  return msg.slice(0, MAX_LEN) + '\n... (truncated)';
}

export function readTaskPlan(taskId: string): ThinkingTaskPlan | null {
  const p = taskPlanPath(taskId);
  if (!fs.existsSync(p)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(p, 'utf8')) as ThinkingTaskPlan;
    if (typeof raw.taskSummary !== 'string') delete raw.taskSummary;
    // Backward compat: older plans may be missing `attempts` / `lastError`.
    raw.subtasks = (raw.subtasks || []).map((s) => ({
      id: s.id,
      title: s.title,
      description: s.description,
      status: s.status,
      attempts: typeof s.attempts === 'number' ? s.attempts : 0,
      lastError: s.lastError,
    }));
    return raw;
  } catch {
    return null;
  }
}

export function formatSubtaskId(id: number | string): string {
  // Decimal string IDs like "3.1" already contain a dot; plain numeric IDs get
  // a trailing dot so the list reads "1. Title", "2. Title", "3.1 Title".
  return typeof id === 'string' ? id : `${id}.`;
}

export function subtaskDepth(id: number | string): number {
  if (typeof id === 'number') return 0;
  return (id.match(/\./g) || []).length;
}

/** Max chars for ticket description when compact mode has no {@link ThinkingTaskPlan.taskSummary}. */
export const SUBTASK_PROMPT_COMPACT_DESCRIPTION_FALLBACK_MAX = 3000;

/** Max chars for archived instructions markdown in compact sub-task prompts. */
export const SUBTASK_PROMPT_COMPACT_INSTRUCTIONS_MAX = 8192;

export function truncateForSubtaskPrompt(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return `${text.slice(0, maxLen)}\n\n… (truncated)`;
}

export interface ThinkingSubtaskPromptOptions {
  /** Smaller prompt: concise goal + truncated plan; used when there are no human ticket comments or on AI retry. */
  compact: boolean;
}

export function buildThinkingSubtaskPrompt(
  subtask: SubTask,
  task: Task,
  plan: ThinkingTaskPlan,
  instructions: string,
  reviewContext: string | undefined,
  previousError: string | undefined,
  options: ThinkingSubtaskPromptOptions,
): string {
  const completedSteps = plan.subtasks
    .filter((s) => s.status === 'done')
    .map((s) => `  - [done] ${s.id}. ${s.title}`)
    .join('\n');

  const retrySection = previousError && previousError !== '__git__'
    ? `\n## Previous attempt failure diagnostics\nThis step failed on a previous attempt. Diagnostics below — please take them into account and avoid repeating the same failure.\n\n${previousError}\n`
    : '';

  const { compact } = options;

  let taskContextSection = '';
  if (compact) {
    const summary = plan.taskSummary?.trim();
    if (summary) {
      taskContextSection = `\nGoal (concise):\n${summary}\n`;
    } else if (task.description?.trim()) {
      taskContextSection = `\nTask description (truncated):\n${truncateForSubtaskPrompt(
        task.description.trim(),
        SUBTASK_PROMPT_COMPACT_DESCRIPTION_FALLBACK_MAX,
      )}\n`;
    }
  } else if (task.description?.trim()) {
    taskContextSection = `\nTask description:\n${task.description}\n`;
  }

  let instructionsSection = '';
  const instr = instructions.trim();
  if (compact) {
    if (instr) {
      instructionsSection = `## Implementation plan (truncated)\n${truncateForSubtaskPrompt(
        instr,
        SUBTASK_PROMPT_COMPACT_INSTRUCTIONS_MAX,
      )}\n\n(Full plan: \`${plan.taskId}.aidev.instructions.md\`.)\n`;
    }
  } else if (instr) {
    instructionsSection = `## Full implementation instructions\n${instr}\n`;
  }

  return `You are implementing step ${subtask.id} of a multi-step task.

Overall task: ${task.name}${taskContextSection}
${instructionsSection}${reviewContext || ''}${retrySection}## Progress
${completedSteps || '(no steps completed yet)'}

## Current step: ${subtask.id}. ${subtask.title}
${subtask.description}

Implement ONLY this step. Focus on correctness and follow the existing code style.`;
}

export function formatSubtaskList(plan: ThinkingTaskPlan): string {
  const icons: Record<SubTask['status'], string> = {
    pending: '⬜',
    running: '🔄',
    done: '✅',
    failed: '❌',
  };
  return plan.subtasks
    .map((s) => `${icons[s.status]} **${formatSubtaskId(s.id)}** ${s.title} — *${s.status}*`)
    .join('\n');
}

export async function runCommand(
  filter: RunFilter,
  config: Config,
  provider: TaskProvider,
  runners: AIRunner[],
  nonCodeProvider?: TaskProvider,
  hooks: AidevHooks = {},
  vm?: HookVM,
  taskId?: string
): Promise<void> {
  const cwd = process.cwd();
  if (!acquireLock(cwd)) {
    const pid = readLock(cwd);
    logger.warn(`aidev is already running in this directory (PID ${pid}). Use "aidev stop" to terminate it.`);
    process.exit(1);
  }

  logRunStart();

  try {
    const screenAvailable = isScreenAvailable();
    if (!screenAvailable) {
      logger.warn('Screen is locked or display is asleep — AI agents cannot operate');
    }

    logger.info(`Fetching tasks (filter: ${filter})...`);
    let tasks = sortTasksByPriority(await provider.fetchTasks());
    if (taskId) {
      const before = tasks.length;
      tasks = tasks.filter((t) => t.id === taskId);
      if (tasks.length === 0) {
        logger.warn(`Task ${taskId} not found among ${before} tagged task(s) — nothing to do`);
      }
    }
    logger.info(`Found ${tasks.length} tagged task(s)`);

    // beforeRun hook
    if (vm) {
      const runCtx: RunContext = { config, filter, taskCount: tasks.length };
      await executeHook(hooks, 'beforeRun', runCtx, vm);
    }

    let processed = 0;
    let skipped = 0;

    for (const task of tasks) {
      const result = await processTask(task, filter, config, provider, runners, screenAvailable, hooks, vm);
      if (result === 'processed') processed++;
      else skipped++;
    }

    if (nonCodeProvider && !taskId) {
      logger.info(`Fetching non-code tasks (filter: ${filter})...`);
      const nonCodeTasks = sortTasksByPriority(await nonCodeProvider.fetchTasks());
      logger.info(`Found ${nonCodeTasks.length} non-code task(s)`);

      for (const task of nonCodeTasks) {
        const result = await processNonCodeTask(task, filter, config, nonCodeProvider, runners, screenAvailable, hooks, vm);
        if (result === 'processed') processed++;
        else skipped++;
      }
    }

    // Review task phase: check tasks in review status for unresolved code review comments
    if (!taskId && isGitHubRemote(config.gitRemote) && isGhInstalled() && isGhAuthenticated() && config.githubRepo) {
      const reviewStatus = getInReviewStatus(config);
      logger.info(`Fetching tasks in "${reviewStatus}" status for code review checks...`);
      try {
        const reviewTasks = await provider.fetchTasksByStatus([reviewStatus]);
        const mainTag = (config.clickupTag || '').toLowerCase();
        const reviewCandidates = mainTag
          ? reviewTasks.filter((t) => t.tags.some((tag) => tag.toLowerCase() === mainTag))
          : reviewTasks;

        if (reviewCandidates.length > 0) {
          logger.info(`Found ${reviewCandidates.length} task(s) in review — checking for unresolved code reviews`);

          for (const task of reviewCandidates) {
            if (!screenAvailable) {
              logger.info(`[${task.id}] Skipping review check — screen not available`);
              break;
            }
            const result = await processReviewTask(task, config, provider, runners, screenAvailable, hooks, vm);
            if (result === 'processed') processed++;
          }
        }
      } catch (err) {
        logger.warn(`Failed to fetch review tasks: ${err instanceof Error ? err.message : err}`);
      }

      // Checkout back to base branch after processing review tasks
      git.fetchAndCheckout(config.gitRemote, config.githubBaseBranch);
    } else if (!taskId) {
      if (!isGhInstalled() || !isGhAuthenticated()) {
        logger.debug('gh CLI not available — skipping review task checks');
      }
    }

    // afterRun hook
    if (vm) {
      const afterCtx: RunContext & { processed: number; skipped: number } = {
        config, filter, taskCount: tasks.length, processed, skipped,
      };
      await executeHook(hooks, 'afterRun', afterCtx, vm);
    }

    logger.success(`Done. Processed: ${processed}, Skipped: ${skipped}`);
  } finally {
    releaseLock(cwd);
  }
}

async function processTask(
  task: Task,
  filter: RunFilter,
  config: Config,
  provider: TaskProvider,
  runners: AIRunner[],
  screenAvailable: boolean,
  hooks: AidevHooks = {},
  vm?: HookVM
): Promise<'processed' | 'skipped'> {
  const pendingStatus = getPendingStatus(config);
  const openStatus = getOpenStatus(config);
  const isPending = task.status.toLowerCase() === pendingStatus.toLowerCase();
  const skipReason = getRunSkipReason(task.status, filter, pendingStatus, openStatus);

  logger.task(`[${task.id}] "${task.name}" (status: ${task.status})`);

  if (skipReason) {
    logger.info(`[${task.id}] "${task.name}" skipped — ${skipReason}`);
    return 'skipped';
  }

  const branchName = `${task.id}/${git.slugify(task.name)}`;
  const branchExists = git.remoteBranchExists(config.gitRemote, branchName);

  if (isPending || branchExists) {
    const comments = await provider.getComments(task.id);
    const trigger = hasTriggerWord(comments, config.triggerWord);

    if (isPending) {
      const hasHumanFollowUp = hasHumanComment(comments, config.commentPrefix);
      if (!hasHumanFollowUp && !trigger) {
        logger.info(`[${task.id}] "${task.name}" skipped — pending task has no human comment or trigger word ("${config.triggerWord}")`);
        return 'skipped';
      }
      logger.info(
        trigger
          ? `Trigger word "${config.triggerWord}" found — re-processing pending task`
          : 'Pending task has a human comment — proceeding'
      );
    } else {
      if (!trigger) {
        logger.info(`[${task.id}] "${task.name}" skipped — branch already exists (${branchName}) and no trigger word found`);
        return 'skipped';
      }
      logger.info(`Trigger word "${config.triggerWord}" found — re-processing task`);
    }

    if (!screenAvailable) {
      await notifySleeping(task, provider, config.commentPrefix);
      return 'skipped';
    }
  } else {
    if (!screenAvailable) {
      await notifySleeping(task, provider, config.commentPrefix);
      return 'skipped';
    }

    const clarification = await checkNeedsClarification(task, config, provider, runners);
    if (clarification) {
      await provider.postComment(task.id, `${config.commentPrefix} ${clarification}`);
      await provider.updateStatus(task.id, getPendingStatus(config));
      logger.info(`Posted clarification question, set status to ${getPendingStatus(config)}`);
      return 'skipped';
    }
  }

  if (isPlanningTask(task, config)) {
    await implementPlanningTask(task, config, provider, runners, hooks, vm);
  } else if (isThinkingTask(task, config)) {
    await implementThinkingTask(task, branchName, branchExists, config, provider, runners, hooks, vm);
  } else {
    await implementTask(task, branchName, branchExists, config, provider, runners, hooks, vm);
  }
  return 'processed';
}

export function isAidevComment(text: string, commentPrefix: string = '[aidev]'): boolean {
  return text.trimStart().startsWith(commentPrefix);
}

/**
 * True when someone other than aidev spoke after an aidev message: there is a non-aidev
 * comment that has at least one earlier [aidev]-prefixed comment in the thread.
 * Ignores trailing aidev-only noise after the human (e.g. another bot post or sync).
 */
export function hasHumanReply(comments: Comment[], commentPrefix: string = '[aidev]'): boolean {
  if (comments.length === 0) return false;

  let lastNonAidevIndex = -1;
  for (let i = comments.length - 1; i >= 0; i--) {
    if (!isAidevComment(comments[i].text, commentPrefix)) {
      lastNonAidevIndex = i;
      break;
    }
  }

  if (lastNonAidevIndex === -1) {
    return false;
  }

  for (let j = lastNonAidevIndex - 1; j >= 0; j--) {
    if (isAidevComment(comments[j].text, commentPrefix)) {
      return true;
    }
  }

  return false;
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

async function notifySleeping(task: Task, provider: TaskProvider, commentPrefix: string): Promise<void> {
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
      `${commentPrefix} Cannot work on this task — the ${SLEEPING_MARKER} or the screen is locked. ` +
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

export function buildConflictResolutionPrompt(task: Task, conflictFiles: string[], context: string): string {
  return `You are resolving merge conflicts in a software development task branch.

The task branch has fallen behind the base branch and has merge conflicts that need to be resolved.

## Task context (DO NOT break this — the task must still work after conflict resolution)

Task: ${task.name}

Description:
${task.description || '(no description provided)'}
${context}

## Merge conflicts

The following files have merge conflicts with conflict markers (<<<<<<< HEAD, =======, >>>>>>> ...):
${conflictFiles.map((f) => `- ${f}`).join('\n')}

## Instructions

1. Open each conflicting file and resolve the conflict markers
2. Keep BOTH the task's changes AND the base branch updates where possible
3. If the base branch changed something the task also changed, prefer the task's intent but make sure it works with the new base branch code
4. Remove all conflict markers (<<<<<<< HEAD, =======, >>>>>>> ...)
5. Make sure the code compiles and is consistent after resolution
6. Do NOT make any changes beyond what is needed to resolve the conflicts`;
}

async function resolveConflictsWithAI(
  task: Task,
  config: Config,
  provider: TaskProvider,
  runners: AIRunner[],
  context: string,
  hooks: AidevHooks,
  vm: HookVM | undefined,
  branchName: string
): Promise<boolean> {
  const check = git.checkConflictsWithBase(config.gitRemote, config.githubBaseBranch);

  if (check.behindCommits === 0) {
    logger.debug('Branch is up to date with base — no merge needed');
    return true;
  }

  if (check.clean) {
    logger.info(`Branch is ${check.behindCommits} commit(s) behind base — merging (no conflicts)`);
    if (!git.mergeBaseBranch(config.gitRemote, config.githubBaseBranch)) {
      logger.warn('Clean merge unexpectedly failed — continuing without merge');
      return true;
    }

    if (!git.push(config.gitRemote, branchName)) {
      logger.warn('Failed to push merge commit — continuing anyway');
    }

    return true;
  }

  logger.warn(
    `Branch has conflicts with ${config.githubBaseBranch} in ${check.conflictFiles.length} file(s): ` +
    check.conflictFiles.join(', ')
  );

  try {
    await provider.postComment(
      task.id,
      `${config.commentPrefix} Branch \`${branchName}\` has merge conflicts with \`${config.githubBaseBranch}\` ` +
      `in ${check.conflictFiles.length} file(s). Attempting automatic resolution...`
    );
  } catch { /* ignore */ }

  if (!git.mergeBaseBranch(config.gitRemote, config.githubBaseBranch)) {
    let prompt = buildConflictResolutionPrompt(task, check.conflictFiles, context);

    // beforeResolveConflicts hook
    if (vm) {
      const conflictCtx: ResolveConflictsContext = { task, config, branchName, conflictFiles: check.conflictFiles, prompt };
      const modified = await executeHook(hooks, 'beforeResolveConflicts', conflictCtx, vm);
      prompt = modified.prompt;
    }

    let resolved = false;
    let previousNotes = '';

    for (const runner of runners) {
      if (!runner.isAvailable()) continue;

      logger.info(`Running ${runner.name} to resolve merge conflicts...`);
      const result = await runner.run(prompt, previousNotes || undefined);

      if (result.success && !git.hasChanges()) {
        logger.warn(`${runner.name} made no changes to resolve conflicts — trying next runner`);
        previousNotes = `Previous runner (${runner.name}) made no file changes. The conflict markers still need to be resolved.`;
        continue;
      }

      if (result.success) {
        resolved = true;
        break;
      }

      logger.warn(`${runner.name} failed to resolve conflicts — trying next runner`);
      previousNotes = `Previous runner (${runner.name}) failed:\n${result.output}\nErrors:\n${result.error}`;
    }

    if (!resolved) {
      logger.error('All AI runners failed to resolve merge conflicts');
      try {
        if (vm) {
          const afterFailCtx: ResolveConflictsContext & { resolved: boolean } = {
            task,
            config,
            branchName,
            conflictFiles: check.conflictFiles,
            prompt,
            resolved: false,
          };
          await executeHook(hooks, 'afterResolveConflicts', afterFailCtx, vm);
        }
      } finally {
        git.abortMerge();
      }
      try {
        await provider.postComment(
          task.id,
          `${config.commentPrefix} Failed to automatically resolve merge conflicts. Manual intervention needed to rebase/merge the branch.`
        );
      } catch { /* ignore */ }
      return false;
    }

    if (!git.commitMerge(`Merge ${config.githubBaseBranch} into ${branchName} — resolve conflicts`)) {
      logger.error('Failed to commit merge resolution');
      git.abortMerge();
      return false;
    }

    if (!git.push(config.gitRemote, branchName)) {
      logger.warn('Failed to push conflict resolution — continuing anyway');
    }

    logger.success('Merge conflicts resolved successfully');

    // afterResolveConflicts hook
    if (vm) {
      const afterCtx: ResolveConflictsContext & { resolved: boolean } = {
        task, config, branchName, conflictFiles: check.conflictFiles, prompt, resolved: true,
      };
      await executeHook(hooks, 'afterResolveConflicts', afterCtx, vm);
    }

    try {
      await provider.postComment(task.id, `${config.commentPrefix} Merge conflicts resolved automatically.`);
    } catch { /* ignore */ }
  }

  return true;
}

function fetchPrReviewComments(config: Config, branchName: string): ReviewThread[] {
  if (!isGitHubRemote(config.gitRemote) || !isGhAuthenticated()) return [];
  if (!config.githubRepo) return [];

  const prNumber = getPrNumberForBranch(branchName);
  if (!prNumber) {
    logger.debug('No PR found for branch — skipping review comment check');
    return [];
  }

  const parts = config.githubRepo.split('/');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return [];

  return fetchUnresolvedReviewThreads(parts[0], parts[1], prNumber);
}

function formatReviewComments(threads: ReviewThread[]): string {
  if (threads.length === 0) return '';

  let section = '\n\n## Unresolved GitHub Code Review Comments\n\n';
  section += 'The following code review comments on the pull request must be addressed:\n';

  for (const thread of threads) {
    const location = thread.line
      ? `\`${thread.path}\` (line ${thread.line})`
      : `\`${thread.path}\``;
    section += `\n### ${location}\n`;
    for (const comment of thread.comments) {
      section += `> **${comment.author}**: ${comment.body}\n`;
    }
  }

  section += '\nPlease fix ALL the issues mentioned in the review comments above.\n';
  return section;
}

function resolveHandledThreads(threads: ReviewThread[]): void {
  let resolved = 0;
  for (const thread of threads) {
    if (resolveReviewThread(thread.id)) {
      resolved++;
    }
  }
  if (resolved > 0) {
    logger.info(`Resolved ${resolved}/${threads.length} review thread(s) on GitHub`);
  }
}

async function implementTask(
  task: Task,
  branchName: string,
  branchExists: boolean,
  config: Config,
  provider: TaskProvider,
  runners: AIRunner[],
  hooks: AidevHooks = {},
  vm?: HookVM
): Promise<void> {
  logger.info(`Implementing task: ${task.name}`);

  try {
    await provider.updateStatus(task.id, 'in progress');
    const verb = branchExists ? 'Continuing' : 'Starting';
    await provider.postComment(task.id, `${config.commentPrefix} ${verb} implementation on branch \`${branchName}\``);
  } catch (err) {
    logger.warn(`Could not update task status: ${err}`);
  }

  if (branchExists) {
    if (!git.fetchAndCheckoutBranch(config.gitRemote, branchName)) {
      logger.error(`Failed to checkout existing branch ${branchName}`);
      await provider.postComment(task.id, `${config.commentPrefix} Failed to checkout existing branch. Manual intervention needed.`);
      return;
    }
    logger.info(`Continuing on existing branch: ${branchName}`);
  } else {
    if (!git.createBranchFromRemote(config.gitRemote, config.githubBaseBranch, branchName)) {
      logger.error(`Failed to create branch ${branchName} from ${config.gitRemote}/${config.githubBaseBranch}`);
      await provider.postComment(task.id, `${config.commentPrefix} Failed to prepare git branch. Manual intervention needed.`);
      return;
    }
  }

  let context = '';
  try {
    const comments = await provider.getComments(task.id);
    context = await buildConversationContext(task.id, comments, config, runners);
  } catch {
    // ignore
  }

  if (branchExists) {
    const conflictsOk = await resolveConflictsWithAI(task, config, provider, runners, context, hooks, vm, branchName);
    if (!conflictsOk) {
      logger.error('Cannot proceed — merge conflicts could not be resolved');
      return;
    }
  }

  // Fetch unresolved PR review comments for existing branches
  const reviewThreads = branchExists
    ? fetchPrReviewComments(config, branchName)
    : [];
  if (reviewThreads.length > 0) {
    logger.info(`Found ${reviewThreads.length} unresolved review comment(s) to address`);
    context += formatReviewComments(reviewThreads);
  }

  let implementPrompt = buildImplementPrompt(task, context);

  // beforeEachTask hook — may modify context (e.g. improve the prompt)
  if (vm) {
    const taskCtx: TaskContext = { task, config, branchName, prompt: implementPrompt };
    const modified = await executeHook(hooks, 'beforeEachTask', taskCtx, vm);
    implementPrompt = modified.prompt;
  }

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

    if (result.success && !git.hasChanges() && git.hasCommitsAhead(config.gitRemote, config.githubBaseBranch)) {
      logger.info(`${runner.name} produced no new file changes, but branch already has commits ahead of ${config.githubBaseBranch}`);
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
      `${config.commentPrefix} All AI runners failed. Manual implementation needed.\n\n${diagnostics}`
    );
    if (!branchExists) {
      git.deleteBranch(branchName);
    }
    return;
  }

  // Commit and push (only if there are new changes to commit)
  if (git.hasChanges()) {
    if (!git.addAll() || !git.commit(`${config.commentPrefix} Implement: ${task.name}\n\nTask: ${task.url}`, branchName)) {
      logger.error('Failed to commit changes');
      return;
    }

    if (!git.push(config.gitRemote, branchName)) {
      logger.error('Failed to push branch');
      return;
    }
  }

  if (reviewThreads.length > 0) {
    resolveHandledThreads(reviewThreads);
  }

  // Try creating a PR via gh CLI, fall back to compare URL
  try {
    const prUrl = tryCreatePR(config, branchName, task);
    const comment = buildCompletionComment(branchName, prUrl, config);
    await provider.postComment(task.id, comment);
    await provider.updateStatus(task.id, getInReviewStatus(config));
  } catch (err) {
    logger.warn(`Branch pushed but failed to update task: ${err instanceof Error ? err.message : err}`);
  }

  // afterEachTask hook
  if (vm) {
    const afterCtx: TaskContext & { success: boolean } = { task, config, branchName, prompt: implementPrompt, success: true };
    await executeHook(hooks, 'afterEachTask', afterCtx, vm);
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

CRITICAL: Every sub-task MUST result in actual file modifications (create, edit, or delete files) that can be committed to git. A sub-task that produces no file changes is treated as a failure. Do NOT create sub-tasks that are pure investigation, verification, or read-only steps — for example "check if this folder exists", "review the existing code", "decide on an approach", "verify the build passes", or "run the tests". Any necessary investigation must happen inside a sub-task that also produces concrete file changes (e.g. fold the discovery into the step that applies the resulting edits). Each sub-task's description must name specific files and functions to add, modify, or remove.

Respond with valid JSON only — no markdown fences, no extra text:
{
  "taskSummary": "2-5 short sentences: overall goal and constraints only — for reuse in each sub-task prompt (no step-by-step detail; that goes in instructions and subtasks)",
  "instructions": "Detailed implementation instructions in markdown covering the full task — architecture decisions, key files to modify, edge cases to handle, testing approach",
  "subtasks": [
    {
      "id": 1,
      "title": "Short title for the sub-task",
      "description": "Detailed description of what to implement in this step, including specific files and functions to change. Must describe concrete file modifications."
    }
  ]
}

Keep sub-tasks focused: 2-10 sub-tasks is ideal. Order them by dependency (foundation first).`;

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
      taskSummary?: string;
      instructions: string;
      subtasks: Array<{ id: number | string; title: string; description: string }>;
    };

    if (!parsed.subtasks || parsed.subtasks.length === 0) {
      logger.error('Analysis produced no sub-tasks');
      return null;
    }

    const taskSummaryRaw = typeof parsed.taskSummary === 'string' ? parsed.taskSummary.trim() : '';
    const plan: ThinkingTaskPlan = {
      taskId: task.id,
      taskName: task.name,
      ...(taskSummaryRaw ? { taskSummary: taskSummaryRaw } : {}),
      subtasks: parsed.subtasks.map((s, i) => ({
        id: s.id ?? i + 1,
        title: s.title,
        description: s.description,
        status: 'pending' as const,
        attempts: 0,
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

export async function splitFailedSubtask(
  parentTask: Task,
  plan: ThinkingTaskPlan,
  failedSubtask: SubTask,
  runners: AIRunner[]
): Promise<SubTask[] | null> {
  const runner = runners.find((r) => r.isAvailable());
  if (!runner) {
    logger.error('No AI runner available for sub-task split');
    return null;
  }

  const siblings = plan.subtasks
    .filter((s) => s.id !== failedSubtask.id)
    .map((s) => `  - [${s.status}] ${formatSubtaskId(s.id)} ${s.title}`)
    .join('\n');

  const diagnostics = failedSubtask.lastError && failedSubtask.lastError !== '__git__'
    ? failedSubtask.lastError
    : '(no diagnostics captured)';

  const splitTaskContext =
    plan.taskSummary?.trim()
      ? plan.taskSummary.trim()
      : parentTask.description?.trim()
        ? truncateForSubtaskPrompt(parentTask.description.trim(), SUBTASK_PROMPT_COMPACT_DESCRIPTION_FALLBACK_MAX)
        : '';

  const splitPrompt = `You are a senior software architect helping recover a stalled implementation step by splitting it into exactly two smaller, sequential sub-tasks.

Overall task: ${parentTask.name}
${splitTaskContext ? `\nTask context:\n${splitTaskContext}\n` : ''}
## Surrounding plan
${siblings || '(no sibling sub-tasks)'}

## Failed sub-task
ID: ${formatSubtaskId(failedSubtask.id)}
Title: ${failedSubtask.title}
Description: ${failedSubtask.description}

## Previous failure diagnostics
${diagnostics}

Split the failed sub-task above into exactly two smaller, independently implementable sub-tasks that together achieve the original goal. Each new sub-task should be a coherent unit of work that can be committed separately, ordered by dependency (foundation first). Take the diagnostics into account so the split actually addresses what broke.

CRITICAL: Each new sub-task MUST result in actual file modifications (create, edit, or delete files) that can be committed to git. Do NOT produce sub-tasks that are pure investigation, verification, or read-only steps (e.g. "check if this folder exists", "review the existing code", "verify the build passes"). Each description must name specific files and functions to change.

Respond with valid JSON only — no markdown fences, no extra text:
{
  "subtasks": [
    { "title": "Short title for the first new sub-task", "description": "Detailed description of what to implement in this step, including specific files to change" },
    { "title": "Short title for the second new sub-task", "description": "Detailed description of what to implement in this step, including specific files to change" }
  ]
}

Exactly two entries — no more, no fewer.`;

  logger.info(`Splitting failed sub-task ${formatSubtaskId(failedSubtask.id)} into two smaller steps...`);
  const result = await runner.run(splitPrompt);
  if (!result.success) {
    logger.error('Sub-task split failed');
    return null;
  }

  try {
    const jsonMatch = result.output.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      logger.error('Could not parse split response — no JSON found');
      return null;
    }
    const parsed = JSON.parse(jsonMatch[0]) as {
      subtasks: Array<{ title?: string; description?: string }>;
    };

    if (!parsed.subtasks || parsed.subtasks.length !== 2) {
      logger.error(`Split response must contain exactly 2 sub-tasks (got ${parsed.subtasks?.length ?? 0})`);
      return null;
    }

    const newSubtasks: SubTask[] = [];
    for (let i = 0; i < 2; i++) {
      const entry = parsed.subtasks[i];
      const title = (entry?.title || '').trim();
      const description = (entry?.description || '').trim();
      if (!title || !description) {
        logger.error(`Split response sub-task ${i + 1} has empty title or description`);
        return null;
      }
      newSubtasks.push({
        id: `${failedSubtask.id}.${i + 1}`,
        title,
        description,
        status: 'pending',
        attempts: 0,
      });
    }

    return newSubtasks;
  } catch (err) {
    logger.error(`Failed to parse split response: ${err}`);
    return null;
  }
}

async function executeSubTask(
  subtask: SubTask,
  task: Task,
  plan: ThinkingTaskPlan,
  config: Config,
  runners: AIRunner[],
  reviewContext: string | undefined,
  previousError: string | undefined,
  hasTicketConversationContext: boolean,
): Promise<boolean> {
  const instructionsPath = taskInstructionsPath(task.id);
  const instructions = fs.existsSync(instructionsPath)
    ? fs.readFileSync(instructionsPath, 'utf8')
    : '';

  const useCompactPrompt =
    (!!previousError && previousError !== '__git__') || !hasTicketConversationContext;

  const prompt = buildThinkingSubtaskPrompt(
    subtask,
    task,
    plan,
    instructions,
    reviewContext,
    previousError,
    { compact: useCompactPrompt },
  );

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
  runners: AIRunner[],
  hooks: AidevHooks = {},
  vm?: HookVM
): Promise<void> {
  logger.info(`Implementing thinking task: ${task.name}`);
  cleanupStaleThinkingArtifacts();

  try {
    await provider.updateStatus(task.id, 'in progress');
    const verb = branchExists ? 'Continuing' : 'Starting';
    await provider.postComment(
      task.id,
      `${config.commentPrefix} ${verb} implementation on branch \`${branchName}\` (thinking mode — will analyze and break into sub-tasks)`
    );
  } catch (err) {
    logger.warn(`Could not update task status: ${err}`);
  }

  if (branchExists) {
    if (!git.fetchAndCheckoutBranch(config.gitRemote, branchName)) {
      logger.error(`Failed to checkout existing branch ${branchName}`);
      await provider.postComment(task.id, `${config.commentPrefix} Failed to checkout existing branch. Manual intervention needed.`);
      return;
    }
    logger.info(`Continuing on existing branch: ${branchName}`);
  } else {
    if (!git.createBranchFromRemote(config.gitRemote, config.githubBaseBranch, branchName)) {
      logger.error(`Failed to create branch ${branchName} from ${config.gitRemote}/${config.githubBaseBranch}`);
      await provider.postComment(task.id, `${config.commentPrefix} Failed to prepare git branch. Manual intervention needed.`);
      return;
    }
  }

  let ticketConversationContext = '';
  try {
    const comments = await provider.getComments(task.id);
    ticketConversationContext = await buildConversationContext(task.id, comments, config, runners);
  } catch { /* ignore */ }
  let context = ticketConversationContext;

  if (branchExists) {
    const conflictsOk = await resolveConflictsWithAI(task, config, provider, runners, context, hooks, vm, branchName);
    if (!conflictsOk) {
      logger.error('Cannot proceed — merge conflicts could not be resolved');
      return;
    }
  }

  // Fetch unresolved PR review comments for existing branches
  const reviewThreads = branchExists
    ? fetchPrReviewComments(config, branchName)
    : [];
  const reviewContext = reviewThreads.length > 0
    ? formatReviewComments(reviewThreads)
    : undefined;
  if (reviewThreads.length > 0) {
    logger.info(`Found ${reviewThreads.length} unresolved review comment(s) to address`);
    context += reviewContext;
  }

  // Check for an existing plan (resume scenario)
  let plan = readTaskPlan(task.id);
  if (plan) {
    logger.info(`Found existing task plan with ${plan.subtasks.length} sub-tasks — resuming`);
  } else {
    plan = await analyzeAndPlan(task, context, runners);
    if (!plan) {
      logger.error('Failed to create implementation plan');
      await provider.postComment(task.id, `${config.commentPrefix} Failed to analyze and break down the task. Manual implementation needed.`);
      cleanupThinkingFiles(task.id);
      if (!branchExists) git.deleteBranch(branchName);
      return;
    }

    logger.info(`Task broken into ${plan.subtasks.length} sub-tasks`);

    try {
      await provider.postComment(
        task.id,
        `${config.commentPrefix} Task analyzed and broken into ${plan.subtasks.length} sub-tasks:\n\n${formatSubtaskList(plan)}`
      );
    } catch (err) {
      logger.warn(`Failed to post breakdown comment: ${err}`);
    }
  }

  // beforeThinkingTask hook — may adjust subtask titles/descriptions before execution
  if (vm) {
    const thinkCtx: ThinkingTaskContext = {
      task,
      config,
      branchName,
      subtasks: plan.subtasks.map((s) => ({
        id: s.id,
        title: s.title,
        description: s.description,
        status: s.status,
      })),
    };
    const modified = await executeHook(hooks, 'beforeThinkingTask', thinkCtx, vm);
    const prevById = new Map(plan.subtasks.map((s) => [s.id, s]));
    plan.subtasks = modified.subtasks.map((s) => {
      const prev = prevById.get(s.id);
      return {
        id: s.id,
        title: s.title,
        description: s.description,
        status: (prev?.status ?? s.status) as SubTask['status'],
        attempts: prev?.attempts ?? 0,
        lastError: prev?.lastError,
      };
    });
    writeTaskPlan(plan);
  }

  let allSucceeded = true;

  for (let i = 0; i < plan.subtasks.length; i++) {
    const subtask = plan.subtasks[i];

    if (subtask.status === 'done') {
      logger.info(`  Step ${subtask.id} already done — skipping`);
      continue;
    }

    // Failure recovery on resume: a sub-task that ended in 'failed' on a prior run
    // gets a chance to be split into two smaller steps before we retry it.
    if (subtask.status === 'failed') {
      const isGitFailure = subtask.lastError === '__git__';
      const depth = subtaskDepth(subtask.id);
      const attempts = subtask.attempts ?? 0;
      const shouldSplit = !isGitFailure && attempts >= 2 && depth < 2;

      if (shouldSplit) {
        const failedId = subtask.id;
        const newSubtasks = await splitFailedSubtask(task, plan, subtask, runners);
        if (newSubtasks) {
          plan.subtasks.splice(i, 1, ...newSubtasks);
          writeTaskPlan(plan);
          const newIds = newSubtasks.map((s) => s.id).join(', ');
          logger.info(`  Step ${failedId} was split into ${newIds}`);
          try {
            await provider.postComment(
              task.id,
              `${config.commentPrefix} Step ${failedId} was split into ${newIds}:\n\n${formatSubtaskList(plan)}`
            );
          } catch { /* ignore */ }
          i--; // re-process this index — it now points at the first new sub-task
          continue;
        }
        logger.warn(`  Could not split failed step ${failedId} — falling back to plain retry`);
        try {
          await provider.postComment(
            task.id,
            `${config.commentPrefix} Failed to automatically split step ${failedId}. Retrying as-is.`
          );
        } catch { /* ignore */ }
      } else if (!isGitFailure && attempts >= 2 && depth >= 2) {
        logger.warn(`  Step ${subtask.id} has reached the split-depth cap — manual intervention may be needed`);
        try {
          await provider.postComment(
            task.id,
            `${config.commentPrefix} Step ${subtask.id} has already been split twice and is still failing. Retrying as-is — please consider manual intervention.`
          );
        } catch { /* ignore */ }
      }
    }

    const previousError = subtask.lastError;
    subtask.status = 'running';
    subtask.attempts = (subtask.attempts ?? 0) + 1;
    writeTaskPlan(plan);

    logger.info(`  Starting step ${subtask.id}: ${subtask.title} (attempt ${subtask.attempts})`);
    const success = await executeSubTask(
      subtask,
      task,
      plan,
      config,
      runners,
      reviewContext,
      previousError,
      ticketConversationContext.trim().length > 0,
    );

    if (!success) {
      const diagnostics = collectAndLogDiagnostics();
      subtask.status = 'failed';
      subtask.lastError = truncateError(diagnostics);
      writeTaskPlan(plan);
      allSucceeded = false;
      logger.error(`  Step ${subtask.id} failed: ${subtask.title}`);

      try {
        await provider.postComment(
          task.id,
          `${config.commentPrefix} Step ${subtask.id} failed: ${subtask.title}\n\n${formatSubtaskList(plan)}\n\n${diagnostics}`
        );
      } catch { /* ignore */ }

      break;
    }

    if (!git.addAll() || !git.commit(`${config.commentPrefix} Step ${subtask.id}: ${subtask.title}\n\nTask: ${task.url}`, branchName)) {
      subtask.status = 'failed';
      subtask.lastError = '__git__';
      writeTaskPlan(plan);
      allSucceeded = false;
      logger.error(`  Failed to commit step ${subtask.id}`);
      break;
    }

    if (!git.push(config.gitRemote, branchName)) {
      subtask.status = 'failed';
      subtask.lastError = '__git__';
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
        `${config.commentPrefix} Step ${subtask.id} complete: ${subtask.title}\n\n${formatSubtaskList(plan)}`
      );
    } catch { /* ignore */ }
  }

  if (!allSucceeded) {
    logger.error('Thinking task did not complete all sub-tasks');
    try {
      const diagnostics = collectAndLogDiagnostics();
      await provider.postComment(
        task.id,
        `${config.commentPrefix} Thinking task did not complete all sub-tasks. Manual intervention needed.\n\n${diagnostics}`
      );
    } catch { /* ignore */ }
    return;
  }

  cleanupThinkingFiles(task.id);

  if (reviewThreads.length > 0) {
    resolveHandledThreads(reviewThreads);
  }

  try {
    const prUrl = tryCreatePR(config, branchName, task);
    const comment = buildCompletionComment(branchName, prUrl, config);
    await provider.postComment(task.id, comment);
    await provider.updateStatus(task.id, getInReviewStatus(config));
    if (config.thinkingTag && provider.removeTag) {
      try {
        await provider.removeTag(task.id, config.thinkingTag);
      } catch (err) {
        logger.warn(`Could not remove thinking tag: ${err instanceof Error ? err.message : err}`);
      }
    }
  } catch (err) {
    logger.warn(`Branch pushed but failed to update task: ${err instanceof Error ? err.message : err}`);
  }

  // afterThinkingTask hook
  if (vm) {
    const afterCtx: ThinkingTaskContext & { success: boolean } = {
      task, config, branchName, subtasks: plan.subtasks.map((s) => ({ ...s })), success: true,
    };
    await executeHook(hooks, 'afterThinkingTask', afterCtx, vm);
  }

  logger.success(`Thinking task implemented: branch ${branchName} pushed`);
}

export async function implementPlanningTask(
  task: Task,
  config: Config,
  provider: TaskProvider,
  runners: AIRunner[],
  _hooks: AidevHooks = {},
  _vm?: HookVM
): Promise<void> {
  logger.info(`Implementing planning task: ${task.name}`);

  try {
    await provider.updateStatus(task.id, 'in progress');
    await provider.postComment(
      task.id,
      `${config.commentPrefix} Starting planning mode — analyzing task and drafting sub-tickets`
    );
  } catch (err) {
    logger.warn(`Could not update task status: ${err}`);
  }

  let context = '';
  try {
    const comments = await provider.getComments(task.id);
    context = await buildConversationContext(task.id, comments, config, runners);
  } catch {
    // ignore
  }

  const prompt = buildPlanningAnalysisPrompt(task, context);

  let parsed: PlanningAnalysisResponse | null = null;
  let previousNotes = '';
  for (const runner of runners) {
    if (!runner.isAvailable()) continue;
    logger.info(`Running ${runner.name} for planning analysis...`);
    const result = await runner.run(prompt, previousNotes || undefined);
    if (!result.success) {
      logger.warn(`${runner.name} planning analysis failed — trying next runner`);
      previousNotes = `Previous runner (${runner.name}) output:\n${result.output}\nErrors:\n${result.error}`;
      continue;
    }
    parsed = parsePlanningResponse(result.output);
    if (parsed) break;
    logger.warn(`${runner.name} planning analysis returned unparseable output — trying next runner`);
    previousNotes = `Previous runner (${runner.name}) produced unparseable output:\n${result.output}`;
  }

  if (!parsed) {
    logger.error('Planning produced no sub-tasks');
    try {
      await provider.postComment(task.id, `${config.commentPrefix} Planning produced no sub-tasks`);
    } catch { /* ignore */ }
    return;
  }

  if (parsed.clarification) {
    try {
      await provider.postComment(task.id, `${config.commentPrefix} ${parsed.clarification}`);
      await provider.updateStatus(task.id, getPendingStatus(config));
      logger.info(`Posted planning clarification, set status to ${getPendingStatus(config)}`);
    } catch (err) {
      logger.warn(`Failed to post clarification or set pending status: ${err instanceof Error ? err.message : err}`);
    }
    return;
  }

  if (parsed.subtasks.length === 0) {
    logger.error('Planning produced no sub-tasks');
    try {
      await provider.postComment(task.id, `${config.commentPrefix} Planning produced no sub-tasks`);
    } catch { /* ignore */ }
    return;
  }

  const planningTagLower = config.planningTag.toLowerCase();
  const ticketTags = task.tags.filter((t) => t.toLowerCase() !== planningTagLower);

  const created: Array<{ title: string; url: string; id: string }> = [];
  const failures: Array<{ title: string; error: string }> = [];

  for (const draft of parsed.subtasks) {
    try {
      const result = await provider.createTask({
        title: draft.title,
        description: draft.description,
        tags: ticketTags,
        priority: draft.priority,
        listId: task.sourceListId,
      });
      created.push({ title: draft.title, url: result.url, id: result.id });
      logger.success(`  Created sub-ticket "${draft.title}" — ${result.url}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.warn(`  Failed to create sub-ticket "${draft.title}": ${message}`);
      failures.push({ title: draft.title, error: message });
    }
  }

  const summaryLines: string[] = [
    `${config.commentPrefix} Planning complete — created ${created.length} ticket${created.length === 1 ? '' : 's'}` +
      (failures.length > 0 ? ` (${failures.length} failed)` : '') +
      ':',
  ];
  if (created.length > 0) {
    summaryLines.push('');
    for (const c of created) {
      summaryLines.push(`- ${c.title} — ${c.url}`);
    }
  }
  if (failures.length > 0) {
    summaryLines.push('', 'Failed to create:');
    for (const f of failures) {
      summaryLines.push(`- ${f.title} — ${f.error}`);
    }
  }
  try {
    await provider.postComment(task.id, summaryLines.join('\n'));
  } catch (err) {
    logger.warn(`Failed to post planning summary: ${err instanceof Error ? err.message : err}`);
  }

  if (config.planningTag && provider.removeTag) {
    try {
      await provider.removeTag(task.id, config.planningTag);
    } catch (err) {
      logger.warn(`Could not remove planning tag: ${err instanceof Error ? err.message : err}`);
    }
  }

  const doneStatus = await resolveDoneStatus(config, provider);
  if (doneStatus) {
    try {
      await provider.updateStatus(task.id, doneStatus);
      logger.info(`Planning task transitioned to "${doneStatus}"`);
    } catch (err) {
      logger.warn(`Failed to transition planning task to "${doneStatus}": ${err instanceof Error ? err.message : err}`);
    }
  } else {
    logger.warn('No done status configured or detectable — leaving planning task in current status');
  }

  logger.success(`Planning task complete: ${task.name}`);
}

/**
 * Attempts to create a PR via `gh` CLI. Falls back to a compare URL if gh is
 * unavailable or PR creation fails.
 */
export function buildPRBody(task: Task): string {
  const signature = process.env.PR_SIGNATURE || 'Automated PR by aidev.';
  return `Implements: ${task.url}\n\n${signature}`;
}

export function tryCreatePR(config: Config, branch: string, task: Task): string {
  if (isGitHubRemote(config.gitRemote) && isGhAuthenticated()) {
    const result = createPullRequest(
      config.githubBaseBranch,
      branch,
      task.name,
      buildPRBody(task),
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
    `${config.commentPrefix} Implementation complete!`,
    ``,
    `Branch: \`${branch}\``,
  ];

  if (prUrl) {
    lines.push(`Open PR: ${prUrl}`);
  }

  lines.push(``, `Status set to: ${getInReviewStatus(config)}`);
  return lines.join('\n');
}

export function buildNonCodePrompt(task: Task, context: string): string {
  const hasComments = context.trim().length > 0;

  if (hasComments) {
    return `Task: ${task.name}

Original description:
${task.description || '(no description provided)'}
${context}

⚠️ CRITICAL: This is a FOLLOW-UP request. The conversation above contains new comments from the user.
YOUR PRIMARY TASK is to address the LATEST comment at the bottom of the conversation - this is the user's current request.
The latest comment may:
- Ask for something completely different from the original task
- Request modifications to what was already done
- Add new requirements

DO NOT repeat what was already done. DO NOT re-execute the original task unless explicitly asked.
Focus ENTIRELY on addressing the latest comment as your main instruction.

Please provide a clear, detailed response to the LATEST comment. Your response will be posted as a comment on the task ticket, so write it as a direct answer or explanation addressed to the person who wrote the latest comment.`;
  }

  return `Task: ${task.name}

Description:
${task.description || '(no description provided)'}

Please provide a clear, detailed response to this task. Your response will be posted as a comment on the task ticket, so write it as a direct answer or explanation addressed to the person who created the task.`;
}

export function buildNonCodeCompletionComment(config: Config, agentResponse?: string): string {
  const lines = [
    `${config.commentPrefix} Non-code task complete!`,
  ];

  if (agentResponse) {
    // Filter out instructional text like "Here's text you can paste as the **task ticket comment**"
    // and extract only the actual content
    let cleanedResponse = agentResponse;
    
    // Look for the content after the first "---" separator, as the actual content usually follows
    const separatorIndex = agentResponse.indexOf('---');
    if (separatorIndex !== -1) {
      const afterSeparator = agentResponse.substring(separatorIndex + 3).trim();
      // Look for the start of actual content (skip any remaining instructional text)
      const lines = afterSeparator.split('\n');
      const contentStartIndex = lines.findIndex(line => 
        line.trim() && 
        !line.toLowerCase().includes('here\'s text you can paste') &&
        !line.toLowerCase().includes('task ticket comment') &&
        !line.toLowerCase().includes('addresses your latest ask')
      );
      
      if (contentStartIndex !== -1) {
        cleanedResponse = lines.slice(contentStartIndex).join('\n').trim();
      }
    }
    
    lines.push(``, `---`, ``, cleanedResponse);
  }

  lines.push(``, `Status set to: ${getInReviewStatus(config)}`);
  return lines.join('\n');
}

export function hasAidevComment(comments: Comment[], commentPrefix: string = '[aidev]'): boolean {
  return comments.some((c) => isAidevComment(c.text, commentPrefix));
}

export function filterAutomatedComments(comments: Comment[], commentPrefix: string = '[aidev]'): Comment[] {
  return comments.filter((c) => !isAidevComment(c.text, commentPrefix));
}

export function hasHumanComment(comments: Comment[], commentPrefix: string = '[aidev]'): boolean {
  return comments.some((c) => !isAidevComment(c.text, commentPrefix));
}

async function buildConversationContext(
  taskId: string,
  comments: Comment[],
  config: Config,
  runners: AIRunner[]
): Promise<string> {
  const humanComments = filterAutomatedComments(comments, config.commentPrefix);
  if (humanComments.length === 0) return '';

  const rawLength =
    '\n\nConversation context:\n'.length +
    humanComments.reduce((n, c, i) => n + c.author.length + 2 + c.text.length + (i > 0 ? 1 : 0), 0);

  const context = await buildCompressedContext(humanComments, taskId, runners, config);

  if (
    config.autoCompress &&
    humanComments.length > 1 &&
    rawLength > config.compressThreshold &&
    context.startsWith('\n\nSummary of earlier conversation')
  ) {
    logger.info(
      `[${taskId}] Auto-compressed conversation context: ${rawLength} → ${context.length} chars`
    );
  }

  return context;
}

async function processNonCodeTask(
  task: Task,
  filter: RunFilter,
  config: Config,
  provider: TaskProvider,
  runners: AIRunner[],
  screenAvailable: boolean,
  hooks: AidevHooks = {},
  vm?: HookVM
): Promise<'processed' | 'skipped'> {
  const pendingStatus = getPendingStatus(config);
  const openStatus = getOpenStatus(config);
  const isPending = task.status.toLowerCase() === pendingStatus.toLowerCase();
  const skipReason = getRunSkipReason(task.status, filter, pendingStatus, openStatus);

  logger.task(`[${task.id}] "${task.name}" [non-code] (status: ${task.status})`);

  if (skipReason) {
    logger.info(`[${task.id}] "${task.name}" skipped — ${skipReason}`);
    return 'skipped';
  }

  const comments = await provider.getComments(task.id);
  const wasProcessed = hasAidevComment(comments, config.commentPrefix);

  if (isPending || wasProcessed) {
    const trigger = hasTriggerWord(comments, config.triggerWord);
    const hasHumanFollowUp = hasHumanReply(comments, config.commentPrefix);

    if (isPending) {
      const hasHumanCommentForPending = hasHumanComment(comments, config.commentPrefix);
      if (!hasHumanCommentForPending && !trigger) {
        logger.info(`[${task.id}] "${task.name}" skipped — pending with no human comment or trigger word ("${config.triggerWord}")`);
        return 'skipped';
      }
      logger.info(
        trigger
          ? `Trigger word "${config.triggerWord}" found — re-processing non-code task`
          : 'Pending non-code task has a human comment — proceeding'
      );
    } else {
      // For already processed tasks, check if there's a human follow-up or trigger word
      if (!trigger && !hasHumanFollowUp) {
        logger.info(`[${task.id}] "${task.name}" skipped — already processed, no trigger word or human follow-up`);
        return 'skipped';
      }
      logger.info(
        trigger
          ? `Trigger word "${config.triggerWord}" found — re-processing non-code task`
          : 'Human follow-up comment found — processing non-code task'
      );
    }

    if (!screenAvailable) {
      await notifySleeping(task, provider, config.commentPrefix);
      return 'skipped';
    }
  } else {
    if (!screenAvailable) {
      await notifySleeping(task, provider, config.commentPrefix);
      return 'skipped';
    }

    const clarification = await checkNeedsClarification(task, config, provider, runners);
    if (clarification) {
      await provider.postComment(task.id, `${config.commentPrefix} ${clarification}`);
      await provider.updateStatus(task.id, getPendingStatus(config));
      logger.info(`Posted clarification question, set status to ${getPendingStatus(config)}`);
      return 'skipped';
    }
  }

  if (isPlanningTask(task, config)) {
    await implementPlanningTask(task, config, provider, runners, hooks, vm);
  } else if (isThinkingTask(task, config)) {
    await implementNonCodeThinkingTask(task, config, provider, runners, hooks, vm);
  } else {
    await implementNonCodeTask(task, config, provider, runners, hooks, vm);
  }
  return 'processed';
}

async function implementNonCodeTask(
  task: Task,
  config: Config,
  provider: TaskProvider,
  runners: AIRunner[],
  hooks: AidevHooks = {},
  vm?: HookVM
): Promise<void> {
  logger.info(`Implementing non-code task: ${task.name}`);

  try {
    await provider.updateStatus(task.id, 'in progress');
    await provider.postComment(task.id, `${config.commentPrefix} Starting non-code task execution`);
  } catch (err) {
    logger.warn(`Could not update task status: ${err}`);
  }

  let context = '';
  try {
    const comments = await provider.getComments(task.id);
    context = await buildConversationContext(task.id, comments, config, runners);
  } catch {
    // ignore
  }

  let nonCodePrompt = buildNonCodePrompt(task, context);

  // beforeNonCodeTask hook
  if (vm) {
    const ncCtx: NonCodeTaskContext = { task, config, prompt: nonCodePrompt };
    const modified = await executeHook(hooks, 'beforeNonCodeTask', ncCtx, vm);
    nonCodePrompt = modified.prompt;
  }

  let implemented = false;
  let agentOutput = '';
  let previousNotes = '';

  for (const runner of runners) {
    if (!runner.isAvailable()) {
      logger.debug(`${runner.name} not available, skipping`);
      continue;
    }

    logger.info(`Running ${runner.name}...`);
    const result = await runner.run(nonCodePrompt, previousNotes || undefined);

    if (result.success) {
      implemented = true;
      agentOutput = result.output;
      break;
    }

    logger.warn(`${runner.name} failed — trying next runner`);
    previousNotes = `Previous runner (${runner.name}) output:\n${result.output}\nErrors:\n${result.error}`;
  }

  if (!implemented) {
    logger.error('All AI runners failed');
    const diagnostics = collectAndLogDiagnostics();
    await provider.postComment(
      task.id,
      `${config.commentPrefix} All AI runners failed. Manual intervention needed.\n\n${diagnostics}`
    );
    return;
  }

  try {
    const comment = buildNonCodeCompletionComment(config, agentOutput);
    await provider.postComment(task.id, comment);
    await provider.updateStatus(task.id, getInReviewStatus(config));
  } catch (err) {
    logger.warn(`Failed to update task: ${err instanceof Error ? err.message : err}`);
  }

  // afterNonCodeTask hook
  if (vm) {
    const afterCtx: NonCodeTaskContext & { success: boolean; output: string } = {
      task, config, prompt: nonCodePrompt, success: true, output: agentOutput,
    };
    await executeHook(hooks, 'afterNonCodeTask', afterCtx, vm);
  }

  logger.success(`Non-code task complete: ${task.name}`);
}

// ─── Non-code thinking task processing ──────────────────────────────────────

export interface NonCodeSubTaskResult {
  id: number | string;
  title: string;
  summary: string;
}

export function buildNonCodeAnalysisPrompt(task: Task, context: string): string {
  return `You are a senior analyst breaking down a non-code task (research, investigation, documentation, communication, planning, etc.) into smaller, sequential sub-tasks.

Each sub-task will be executed in order. Each later sub-task will receive a short summary of every earlier sub-task's result, so subsequent steps can build on previous findings.

Task name: ${task.name}

Description:
${task.description || '(no description provided)'}
${context}

Analyze this task and break it into 2-8 focused, sequential sub-tasks. Each sub-task should be a coherent unit of work that produces a textual outcome (analysis, summary, draft, list of findings, etc.) — no code changes are expected.

Respond with valid JSON only — no markdown fences, no extra text:
{
  "taskSummary": "2-5 short sentences: overall goal and constraints only — reused as compact context for each sub-task",
  "subtasks": [
    {
      "id": 1,
      "title": "Short title for the sub-task",
      "description": "Detailed description of what to investigate, produce, or decide in this step"
    }
  ]
}

Order sub-tasks by dependency (foundation first). Keep titles short — they will appear in ticket comments.`;
}

export function buildNonCodeSubtaskPrompt(
  subtask: SubTask,
  task: Task,
  plan: ThinkingTaskPlan,
  previousResults: NonCodeSubTaskResult[],
  reviewContext: string | undefined,
): string {
  const completedSteps = plan.subtasks
    .filter((s) => s.status === 'done')
    .map((s) => `  - [done] ${formatSubtaskId(s.id)} ${s.title}`)
    .join('\n');

  const previousSection = previousResults.length > 0
    ? `\n## Summaries from previous sub-tasks\nUse these findings as context — do not repeat work already done.\n\n${previousResults
        .map((r) => `### ${formatSubtaskId(r.id)} ${r.title}\n${r.summary}`)
        .join('\n\n')}\n`
    : '';

  const summary = plan.taskSummary?.trim();
  const goalSection = summary
    ? `\nGoal (concise):\n${summary}\n`
    : task.description?.trim()
      ? `\nTask description:\n${task.description.trim()}\n`
      : '';

  return `You are working on step ${formatSubtaskId(subtask.id)} of a multi-step non-code task. No code changes are expected — produce a clear textual response.

Overall task: ${task.name}${goalSection}${previousSection}${reviewContext || ''}## Progress
${completedSteps || '(no steps completed yet)'}

## Current step: ${formatSubtaskId(subtask.id)} ${subtask.title}
${subtask.description}

Focus ONLY on this step. Write the response so it can be posted directly as a ticket comment — clear, self-contained, and addressed to the task's stakeholders. Do not include preambles like "Here's text you can paste"; output only the content itself.`;
}

export function buildNonCodeThinkingCompletionComment(config: Config): string {
  return [
    `${config.commentPrefix} Non-code task complete!`,
    ``,
    `All sub-tasks finished. Individual summaries were posted above.`,
    ``,
    `Status set to: ${getInReviewStatus(config)}`,
  ].join('\n');
}

async function analyzeAndPlanNonCode(
  task: Task,
  context: string,
  runners: AIRunner[]
): Promise<ThinkingTaskPlan | null> {
  const runner = runners.find((r) => r.isAvailable());
  if (!runner) {
    logger.error('No AI runner available for non-code task analysis');
    return null;
  }

  const analysisPrompt = buildNonCodeAnalysisPrompt(task, context);

  logger.info('Analyzing non-code task and creating sub-task plan...');
  const result = await runner.run(analysisPrompt);
  if (!result.success) {
    logger.error('Non-code task analysis failed');
    return null;
  }

  try {
    const jsonMatch = result.output.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      logger.error('Could not parse non-code analysis response — no JSON found');
      return null;
    }
    const parsed = JSON.parse(jsonMatch[0]) as {
      taskSummary?: string;
      subtasks: Array<{ id?: number | string; title: string; description: string }>;
    };

    if (!parsed.subtasks || parsed.subtasks.length === 0) {
      logger.error('Non-code analysis produced no sub-tasks');
      return null;
    }

    const taskSummaryRaw = typeof parsed.taskSummary === 'string' ? parsed.taskSummary.trim() : '';
    const plan: ThinkingTaskPlan = {
      taskId: task.id,
      taskName: task.name,
      ...(taskSummaryRaw ? { taskSummary: taskSummaryRaw } : {}),
      subtasks: parsed.subtasks.map((s, i) => ({
        id: s.id ?? i + 1,
        title: s.title,
        description: s.description,
        status: 'pending' as const,
        attempts: 0,
      })),
    };

    return plan;
  } catch (err) {
    logger.error(`Failed to parse non-code analysis response: ${err}`);
    return null;
  }
}

async function implementNonCodeThinkingTask(
  task: Task,
  config: Config,
  provider: TaskProvider,
  runners: AIRunner[],
  hooks: AidevHooks = {},
  vm?: HookVM
): Promise<void> {
  logger.info(`Implementing non-code thinking task: ${task.name}`);

  try {
    await provider.updateStatus(task.id, 'in progress');
    await provider.postComment(
      task.id,
      `${config.commentPrefix} Starting non-code task execution (thinking mode — will analyze and break into sub-tasks)`
    );
  } catch (err) {
    logger.warn(`Could not update task status: ${err}`);
  }

  let context = '';
  try {
    const comments = await provider.getComments(task.id);
    context = await buildConversationContext(task.id, comments, config, runners);
  } catch {
    // ignore
  }

  const plan = await analyzeAndPlanNonCode(task, context, runners);
  if (!plan) {
    logger.error('Failed to create non-code task plan');
    await provider.postComment(
      task.id,
      `${config.commentPrefix} Failed to analyze and break down the non-code task. Manual intervention needed.`
    );
    return;
  }

  logger.info(`Non-code task broken into ${plan.subtasks.length} sub-tasks`);

  try {
    await provider.postComment(
      task.id,
      `${config.commentPrefix} Task analyzed and broken into ${plan.subtasks.length} sub-tasks:\n\n${formatSubtaskList(plan)}`
    );
  } catch (err) {
    logger.warn(`Failed to post non-code breakdown comment: ${err}`);
  }

  // beforeThinkingTask hook — may adjust subtask titles/descriptions before execution.
  // branchName is empty because non-code tasks don't create a branch.
  if (vm) {
    const thinkCtx: ThinkingTaskContext = {
      task,
      config,
      branchName: '',
      subtasks: plan.subtasks.map((s) => ({
        id: s.id,
        title: s.title,
        description: s.description,
        status: s.status,
      })),
    };
    const modified = await executeHook(hooks, 'beforeThinkingTask', thinkCtx, vm);
    const prevById = new Map(plan.subtasks.map((s) => [s.id, s]));
    plan.subtasks = modified.subtasks.map((s) => {
      const prev = prevById.get(s.id);
      return {
        id: s.id,
        title: s.title,
        description: s.description,
        status: (prev?.status ?? s.status) as SubTask['status'],
        attempts: prev?.attempts ?? 0,
        lastError: prev?.lastError,
      };
    });
  }

  const previousResults: NonCodeSubTaskResult[] = [];
  let allSucceeded = true;

  for (const subtask of plan.subtasks) {
    subtask.status = 'running';
    subtask.attempts = (subtask.attempts ?? 0) + 1;

    logger.info(`  Starting non-code step ${formatSubtaskId(subtask.id)}: ${subtask.title}`);

    const prompt = buildNonCodeSubtaskPrompt(subtask, task, plan, previousResults, undefined);

    let summary = '';
    let success = false;
    let previousNotes = '';

    for (const runner of runners) {
      if (!runner.isAvailable()) continue;

      logger.info(`    Running ${runner.name} for step ${formatSubtaskId(subtask.id)}...`);
      const result = await runner.run(prompt, previousNotes || undefined);

      if (result.success && result.output.trim().length > 0) {
        summary = result.output.trim();
        success = true;
        break;
      }

      if (!result.success) {
        logger.warn(`    ${runner.name} failed — trying next runner`);
        previousNotes = `Previous runner (${runner.name}) output:\n${result.output}\nErrors:\n${result.error}`;
      } else {
        logger.warn(`    ${runner.name} produced empty output — trying next runner`);
        previousNotes = `Previous runner (${runner.name}) produced empty output.`;
      }
    }

    if (!success) {
      subtask.status = 'failed';
      subtask.lastError = previousNotes;
      allSucceeded = false;
      logger.error(`  Non-code step ${formatSubtaskId(subtask.id)} failed: ${subtask.title}`);

      try {
        await provider.postComment(
          task.id,
          `${config.commentPrefix} Step ${formatSubtaskId(subtask.id)} failed: ${subtask.title}\n\n${formatSubtaskList(plan)}`
        );
      } catch { /* ignore */ }

      break;
    }

    // Post the sub-task summary BEFORE marking it done — per the task spec, the
    // comment is posted, then the sub-task is announced as complete.
    try {
      await provider.postComment(
        task.id,
        `${config.commentPrefix} Step ${formatSubtaskId(subtask.id)}: ${subtask.title}\n\n---\n\n${summary}`
      );
    } catch (err) {
      logger.warn(`Failed to post summary for step ${formatSubtaskId(subtask.id)}: ${err}`);
    }

    previousResults.push({ id: subtask.id, title: subtask.title, summary });
    subtask.status = 'done';
    logger.success(`  Non-code step ${formatSubtaskId(subtask.id)} complete: ${subtask.title}`);

    try {
      await provider.postComment(
        task.id,
        `${config.commentPrefix} Step ${formatSubtaskId(subtask.id)} complete: ${subtask.title}\n\n${formatSubtaskList(plan)}`
      );
    } catch { /* ignore */ }
  }

  if (!allSucceeded) {
    logger.error('Non-code thinking task did not complete all sub-tasks');
    try {
      await provider.postComment(
        task.id,
        `${config.commentPrefix} Non-code thinking task did not complete all sub-tasks. Manual intervention needed.`
      );
    } catch { /* ignore */ }
    return;
  }

  try {
    await provider.postComment(task.id, buildNonCodeThinkingCompletionComment(config));
    await provider.updateStatus(task.id, getInReviewStatus(config));
    if (config.thinkingTag && provider.removeTag) {
      try {
        await provider.removeTag(task.id, config.thinkingTag);
      } catch (err) {
        logger.warn(`Could not remove thinking tag: ${err instanceof Error ? err.message : err}`);
      }
    }
  } catch (err) {
    logger.warn(`Non-code thinking task done but failed to update task: ${err instanceof Error ? err.message : err}`);
  }

  // afterThinkingTask hook
  if (vm) {
    const afterCtx: ThinkingTaskContext & { success: boolean } = {
      task,
      config,
      branchName: '',
      subtasks: plan.subtasks.map((s) => ({
        id: s.id,
        title: s.title,
        description: s.description,
        status: s.status,
      })),
      success: true,
    };
    await executeHook(hooks, 'afterThinkingTask', afterCtx, vm);
  }

  logger.success(`Non-code thinking task complete: ${task.name}`);
}

// ─── Review task processing ─────────────────────────────────────────────────

const REPLY_REGEX = /<!-- AIDEV-REPLY ([\w=+/]+) -->([\s\S]*?)<!-- \/AIDEV-REPLY -->/g;

export function parseReplyDirectives(output: string): Array<{ threadId: string; body: string }> {
  const replies: Array<{ threadId: string; body: string }> = [];
  let match: RegExpExecArray | null;
  while ((match = REPLY_REGEX.exec(output)) !== null) {
    replies.push({ threadId: match[1], body: match[2].trim() });
  }
  return replies;
}

async function processReviewTask(
  task: Task,
  config: Config,
  provider: TaskProvider,
  runners: AIRunner[],
  screenAvailable: boolean,
  hooks: AidevHooks = {},
  vm?: HookVM
): Promise<'processed' | 'skipped'> {
  const branchName = `${task.id}/${git.slugify(task.name)}`;

  logger.task(`[${task.id}] "${task.name}" [review] — checking code reviews`);

  if (!config.githubRepo) {
    logger.debug(`[${task.id}] No githubRepo configured — skipping review check`);
    return 'skipped';
  }

  const prNumber = getPrNumberForBranch(branchName);
  if (!prNumber) {
    logger.debug(`[${task.id}] No PR found for branch ${branchName} — skipping`);
    return 'skipped';
  }

  const parts = config.githubRepo.split('/');
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    logger.debug(`[${task.id}] Invalid githubRepo format — skipping`);
    return 'skipped';
  }

  const allThreads = fetchUnresolvedReviewThreads(parts[0], parts[1], prNumber);
  if (allThreads.length === 0) {
    logger.debug(`[${task.id}] No unresolved review threads — skipping`);
    return 'skipped';
  }

  const actionableThreads = filterUnresolvedByNonAidev(allThreads, config.commentPrefix);
  if (actionableThreads.length === 0) {
    logger.debug(`[${task.id}] All unresolved threads are from aidev — skipping`);
    return 'skipped';
  }

  if (!screenAvailable) {
    await notifySleeping(task, provider, config.commentPrefix);
    return 'skipped';
  }

  logger.info(`[${task.id}] Found ${actionableThreads.length} actionable review thread(s) — resolving`);
  await implementReviewTask(task, branchName, config, provider, runners, actionableThreads, hooks, vm);
  return 'processed';
}

async function implementReviewTask(
  task: Task,
  branchName: string,
  config: Config,
  provider: TaskProvider,
  runners: AIRunner[],
  threads: ReviewThread[],
  hooks: AidevHooks = {},
  vm?: HookVM
): Promise<void> {
  logger.info(`Resolving review comments for: ${task.name}`);

  if (!git.fetchAndCheckoutBranch(config.gitRemote, branchName)) {
    logger.error(`[${task.id}] Failed to checkout branch ${branchName}`);
    return;
  }

  let reviewPrompt = buildReviewPrompt(task, threads);

  // beforeReviewTask hook
  if (vm) {
    const reviewCtx: ReviewTaskContext = { task, config, branchName, threads, prompt: reviewPrompt };
    const modified = await executeHook(hooks, 'beforeReviewTask', reviewCtx, vm);
    reviewPrompt = modified.prompt;
  }

  let success = false;
  let agentOutput = '';
  let previousNotes = '';

  for (const runner of runners) {
    if (!runner.isAvailable()) continue;

    logger.info(`Running ${runner.name} to address review comments...`);
    const result = await runner.run(reviewPrompt, previousNotes || undefined);

    if (result.success) {
      success = true;
      agentOutput = result.output;
      break;
    }

    logger.warn(`${runner.name} failed — trying next runner`);
    previousNotes = `Previous runner (${runner.name}) output:\n${result.output}\nErrors:\n${result.error}`;
  }

  if (!success) {
    logger.error(`[${task.id}] All AI runners failed to address review comments`);
    const diagnostics = collectAndLogDiagnostics();
    try {
      await provider.postComment(
        task.id,
        `${config.commentPrefix} Failed to address code review comments automatically.\n\n${diagnostics}`
      );
    } catch { /* ignore */ }

    // afterReviewTask hook — failure
    if (vm) {
      const afterCtx: ReviewTaskContext & { success: boolean; resolvedCount: number } = {
        task, config, branchName, threads, prompt: reviewPrompt, success: false, resolvedCount: 0,
      };
      await executeHook(hooks, 'afterReviewTask', afterCtx, vm);
    }
    return;
  }

  let resolvedCount = 0;
  let repliedCount = 0;

  // Handle code fixes: commit and push if agent made changes
  if (git.hasChanges()) {
    if (git.addAll() && git.commit(`${config.commentPrefix} Address code review comments\n\nTask: ${task.url}`, branchName)) {
      if (git.push(config.gitRemote, branchName)) {
        // Resolve threads that were addressed via code changes
        resolveHandledThreads(threads);
        resolvedCount = threads.length;
        logger.info(`Pushed code fixes and resolved ${resolvedCount} thread(s)`);
      } else {
        logger.error(`[${task.id}] Failed to push review fixes`);
      }
    } else {
      logger.error(`[${task.id}] Failed to commit review fixes`);
    }
  }

  // Handle reply directives from agent output
  const replies = parseReplyDirectives(agentOutput);
  for (const reply of replies) {
    const prefixedBody = `${config.commentPrefix} ${reply.body}`;
    if (replyToReviewThread(reply.threadId, prefixedBody)) {
      repliedCount++;
    }
  }

  if (repliedCount > 0) {
    logger.info(`Posted ${repliedCount} reply(ies) to review threads`);
  }

  // Post completion comment on task provider
  if (resolvedCount > 0 || repliedCount > 0) {
    try {
      const comment = buildReviewCompletionComment(config, resolvedCount, repliedCount);
      await provider.postComment(task.id, comment);
    } catch { /* ignore */ }
  }

  // afterReviewTask hook
  if (vm) {
    const afterCtx: ReviewTaskContext & { success: boolean; resolvedCount: number } = {
      task, config, branchName, threads, prompt: reviewPrompt, success: true, resolvedCount,
    };
    await executeHook(hooks, 'afterReviewTask', afterCtx, vm);
  }

  logger.success(`Review comments addressed for: ${task.name}`);
}

export function buildReviewPrompt(task: Task, threads: ReviewThread[]): string {
  let prompt = `You are addressing code review comments on a pull request for a software development task.

Task: ${task.name}

Description:
${task.description || '(no description provided)'}

## Unresolved Code Review Threads

The following review threads need to be addressed. For each thread, either:
- Fix the code as requested (make the changes directly in the files)
- Or, if it's a discussion/question that doesn't require code changes, output a REPLY block:
  <!-- AIDEV-REPLY thread_id -->Your reply here<!-- /AIDEV-REPLY -->

Replace "thread_id" with the actual thread ID shown below.

`;

  for (const thread of threads) {
    const location = thread.line
      ? `\`${thread.path}\` (line ${thread.line})`
      : `\`${thread.path}\``;
    prompt += `### Thread ${thread.id} — ${location}\n`;
    for (const comment of thread.comments) {
      prompt += `> **${comment.author}**: ${comment.body}\n`;
    }
    prompt += '\n';
  }

  prompt += `## Instructions

1. Read each review thread carefully
2. For code change requests: make the fix directly in the relevant file(s)
3. For questions or discussions: output a REPLY block with a clear, helpful response
4. You may handle multiple threads — some with code fixes, others with replies
5. Focus on correctness and follow the existing code style`;

  return prompt;
}

export function buildReviewCompletionComment(config: Config, resolvedCount: number, repliedCount: number): string {
  const parts: string[] = [`${config.commentPrefix} Code review comments addressed!`];

  if (resolvedCount > 0) {
    parts.push(`Resolved ${resolvedCount} thread(s) with code fixes.`);
  }
  if (repliedCount > 0) {
    parts.push(`Replied to ${repliedCount} thread(s).`);
  }

  return parts.join('\n');
}

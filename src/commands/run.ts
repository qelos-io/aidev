import * as fs from 'node:fs';
import * as path from 'node:path';
import { Config, Task, Comment } from '../types';
import { TaskProvider } from '../providers';
import { AIRunner } from '../ai';
import type { AIRunOptions } from '../ai/base';
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
import { writeActiveTask, clearActiveTask } from '../activeTask';
import {
  AidevHooks, HookVM, executeHook, postCommentWithHooks,
  RunContext, TaskContext, ResolveConflictsContext, NonCodeTaskContext, ThinkingTaskContext,
  ReviewTaskContext,
} from '../hooks';
import { buildCompressedContext } from '../sessions';
import { resolveDoneStatus } from './accepted';
import { collectSecrets, sanitizeTaskForSafeMode } from '../safeMode';
import {
  checkImplementationStillActive,
  ImplementationTagMode,
  runRunnerWithStatusWatch,
} from '../statusWatch';
import {
  getOpenStatus,
  getPendingStatus,
  getInReviewStatus,
} from '../taskStatus';
import {   getExistingAssetDirs, listTaskAssetFiles } from '../aidevAssets';
import {
  buildAssetsAccessInstructions,
  buildCompletionComment,
  buildConflictResolutionPrompt,
  buildConsultCompletionComment,
  buildConsultPrompt,
  buildImplementPrompt,
  buildNoChangesCompletionComment,
  buildNonCodeAnalysisPrompt,
  buildNonCodeCompletionComment,
  buildNonCodePrompt,
  buildNonCodeSubtaskPrompt,
  buildNonCodeThinkingCompletionComment,
  buildPlanningAnalysisPrompt,
  buildPRBody,
  buildPRUrl,
  buildReviewCompletionComment,
  buildReviewPrompt,
  buildThinkingAnalysisPrompt,
  buildThinkingEscalationContext,
  buildThinkingSubtaskPrompt,
  formatSubtaskId,
  parseReplyDirectives,
  SUBTASK_PROMPT_COMPACT_DESCRIPTION_FALLBACK_MAX,
  SUBTASK_PROMPT_COMPACT_INSTRUCTIONS_MAX,
  truncateForSubtaskPrompt,
} from '../prompts';
import type {
  NonCodeSubTaskResult,
  PlanningAnalysisResponse,
  PlanningSubtaskDraft,
  SubTask,
  ThinkingAnalysisDraft,
  ThinkingSubtaskPromptOptions,
  ThinkingTaskPlan,
} from '../prompts/types';

function applySafeMode(task: Task, context: string, config: Config): { task: Task; context: string } {
  if (!config.safeMode) return { task, context };
  const secrets = collectSecrets();
  const sanitized = sanitizeTaskForSafeMode(task, context, secrets);
  return { task: { ...task, ...sanitized.task }, context: sanitized.context };
}

export function augmentPromptForAssets(prompt: string, taskId: string, cwd = process.cwd()): string {
  const assetFiles = listTaskAssetFiles(taskId, cwd);
  const referencesAssets = prompt.includes('.aidev/assets/');
  if (assetFiles.length === 0 && !referencesAssets) {
    const instructions = buildAssetsAccessInstructions(taskId, cwd);
    if (!instructions) return prompt;
    return prompt + instructions;
  }

  const instructions = buildAssetsAccessInstructions(taskId, cwd, { assetFiles });
  return instructions ? prompt + instructions : prompt;
}

export function buildAssetRunOptions(taskId: string, cwd = process.cwd()): Pick<AIRunOptions, 'assetDirs'> {
  const assetDirs = getExistingAssetDirs(taskId, cwd);
  return assetDirs.length > 0 ? { assetDirs } : {};
}

async function handleImplementationStoppedByStatus(
  task: Task,
  reason: string,
  config: Config,
  provider: TaskProvider,
  hooks: AidevHooks,
  vm: HookVM | undefined,
  branchName?: string,
  branchExists?: boolean,
): Promise<void> {
  logger.warn(`Stopping implementation: ${reason}`);
  git.discardWorkingChanges();

  if (branchName && branchExists === false) {
    git.deleteBranch(branchName);
  }

  try {
    await postCommentWithHooks(
      task,
      `${config.commentPrefix} Implementation stopped: ${reason}. Uncommitted changes were discarded.`,
      config, provider, hooks, vm
    );
  } catch { /* ignore */ }
}

async function ensureImplementationStillActive(
  task: Task,
  config: Config,
  provider: TaskProvider,
  hooks: AidevHooks,
  vm: HookVM | undefined,
  branchName?: string,
  branchExists?: boolean,
  tagMode: ImplementationTagMode = 'code',
): Promise<boolean> {
  const check = await checkImplementationStillActive(provider, task.id, config, tagMode);
  if (check.active) return true;

  await handleImplementationStoppedByStatus(
    task,
    check.reason,
    config,
    provider,
    hooks,
    vm,
    branchName,
    branchExists,
  );
  return false;
}

const SKIP_STATUSES = new Set(['closed', 'done', 'cancelled', 'complete', 'resolved', 'completed']);
const NO_PRIORITY = Number.MAX_SAFE_INTEGER;
const SLEEPING_MARKER = 'machine appears to be asleep';
export const DEFAULT_TRIGGER_WORD = 'aidev-continue';

export {
  getPendingStatus,
  getOpenStatus,
  getInProgressStatus,
  getInReviewStatus,
} from '../taskStatus';

export type {
  NonCodeSubTaskResult,
  PlanningAnalysisResponse,
  PlanningSubtaskDraft,
  SubTask,
  ThinkingAnalysisDraft,
  ThinkingSubtaskPromptOptions,
  ThinkingTaskPlan,
} from '../prompts/types';

export {
  buildCompletionComment,
  buildConflictResolutionPrompt,
  buildConsultCompletionComment,
  buildConsultPrompt,
  buildImplementPrompt,
  buildNoChangesCompletionComment,
  buildNonCodeAnalysisPrompt,
  buildNonCodeCompletionComment,
  buildNonCodePrompt,
  buildNonCodeSubtaskPrompt,
  buildNonCodeThinkingCompletionComment,
  buildPlanningAnalysisPrompt,
  buildPRBody,
  buildPRUrl,
  buildReviewCompletionComment,
  buildReviewPrompt,
  buildThinkingAnalysisPrompt,
  buildThinkingSubtaskPrompt,
  formatSubtaskId,
  parseReplyDirectives,
  SUBTASK_PROMPT_COMPACT_DESCRIPTION_FALLBACK_MAX,
  SUBTASK_PROMPT_COMPACT_INSTRUCTIONS_MAX,
  truncateForSubtaskPrompt,
} from '../prompts';

export type RunFilter = 'all' | 'open' | 'pending' | 'review';

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

/** Apply {@link Config.acceptedTag} when {@link Config.autoApprove} is enabled for a first-time open pickup. */
export async function applyAutoApproveTag(
  task: Task,
  config: Config,
  provider: TaskProvider,
): Promise<void> {
  if (!config.autoApprove || !config.acceptedTag) return;
  if (!provider.addTag) {
    logger.warn(`[${task.id}] autoApprove enabled but provider does not support addTag`);
    return;
  }
  const tag = config.acceptedTag;
  if (task.tags.some((t) => t.toLowerCase() === tag.toLowerCase())) return;
  await provider.addTag(task.id, tag);
  logger.info(`[${task.id}] Applied accepted tag "${tag}" (autoApprove)`);
}

/** Apply {@link Config.agentReviewTag} when {@link Config.autoReview} is enabled for a first-time open pickup. */
export async function applyAutoReviewTag(
  task: Task,
  config: Config,
  provider: TaskProvider,
): Promise<void> {
  if (!config.autoReview || !config.agentReviewTag) return;
  if (!provider.addTag) {
    logger.warn(`[${task.id}] autoReview enabled but provider does not support addTag`);
    return;
  }
  const tag = config.agentReviewTag;
  if (task.tags.some((t) => t.toLowerCase() === tag.toLowerCase())) return;
  await provider.addTag(task.id, tag);
  logger.info(`[${task.id}] Applied agent review tag "${tag}" (autoReview)`);
}

export async function getBlockedBySkipReason(task: Task, provider: TaskProvider): Promise<string | null> {
  if (!task.blockedBy || task.blockedBy.length === 0) return null;
  if (!provider.fetchTaskById) {
    logger.debug(`[${task.id}] provider does not support fetchTaskById — skipping blocked-by check`);
    return null;
  }
  for (const blockerId of task.blockedBy) {
    const blocker = await provider.fetchTaskById(blockerId);
    if (blocker === null) {
      logger.debug(`[${task.id}] blocker ${blockerId} not found — treating as non-blocking`);
      continue;
    }
    if (!SKIP_STATUSES.has(blocker.status.toLowerCase())) {
      return `blocked by task ${blockerId} (status: ${blocker.status})`;
    }
    logger.debug(`[${task.id}] blocker ${blockerId} is closed (status: ${blocker.status}) — not blocking`);
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

export function canEscalateToThinkingMode(
  task: Task,
  config: Config,
  provider: TaskProvider,
  opts: { hadExplicitRunnerFailure: boolean },
): boolean {
  if (!opts.hadExplicitRunnerFailure) return false;
  if (isPlanningTask(task, config)) return false;
  if (isThinkingTask(task, config)) return false;
  if (!config.thinkingTag) return false;
  if (!provider.addTag) return false;
  return true;
}

export async function escalateTaskToThinkingMode(
  task: Task,
  provider: TaskProvider,
  config: Config,
  hooks: AidevHooks,
  vm: HookVM | undefined,
  failureDiagnostics: string,
): Promise<string | null> {
  const tag = config.thinkingTag;
  if (!tag || !provider.addTag) return null;

  try {
    await provider.addTag(task.id, tag);
  } catch (err) {
    logger.warn(`[${task.id}] Failed to add thinking tag: ${err}`);
    return null;
  }

  if (!task.tags.some((t) => t.toLowerCase() === tag.toLowerCase())) {
    task.tags.push(tag);
  }

  await postCommentWithHooks(
    task,
    `${config.commentPrefix} All runners failed — escalating to thinking mode for automatic breakdown and retry.\n\n${failureDiagnostics}`,
    config,
    provider,
    hooks,
    vm,
  );

  logger.info(`[${task.id}] Escalating to thinking mode (tag: "${tag}")`);

  return buildThinkingEscalationContext(failureDiagnostics, git.listWorkingTreeChanges());
}

function tryParseJson(text: string): unknown | null {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function extractBalancedJsonSlice(text: string, start: number): string | null {
  if (text[start] !== '{') return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
    } else if (ch === '{') {
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0) {
        return text.slice(start, i + 1);
      }
    }
  }

  return null;
}

/** Collects JSON object candidates from agent output (fences + balanced `{...}` slices). */
export function extractJsonObjectsFromAgentOutput(output: string): Record<string, unknown>[] {
  const candidates: string[] = [];
  const seen = new Set<string>();

  const addCandidate = (raw: string): void => {
    const trimmed = raw.trim();
    if (!trimmed.startsWith('{') || seen.has(trimmed)) return;
    seen.add(trimmed);
    candidates.push(trimmed);
  };

  const fenceRe = /```(?:json)?\s*\n?([\s\S]*?)```/gi;
  let fenceMatch: RegExpExecArray | null;
  while ((fenceMatch = fenceRe.exec(output)) !== null) {
    addCandidate(fenceMatch[1]);
  }

  for (let i = 0; i < output.length; i++) {
    if (output[i] !== '{') continue;
    const slice = extractBalancedJsonSlice(output, i);
    if (slice) addCandidate(slice);
  }

  const objects: Record<string, unknown>[] = [];
  for (const candidate of candidates) {
    const parsed = tryParseJson(candidate);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      objects.push(parsed as Record<string, unknown>);
    }
  }

  return objects;
}

export function extractJsonObjectFromAgentOutput(output: string): Record<string, unknown> | null {
  const objects = extractJsonObjectsFromAgentOutput(output);
  return objects.length > 0 ? objects[objects.length - 1]! : null;
}

async function runAgentJsonAnalysis<T>(
  runners: AIRunner[],
  prompt: string,
  parse: (output: string) => T | null,
  label: string,
  watch?: { provider: TaskProvider; taskId: string; config: Config; tagMode?: ImplementationTagMode },
): Promise<T | null> {
  let previousNotes = '';
  const runPrompt = watch ? augmentPromptForAssets(prompt, watch.taskId) : prompt;
  const assetOptions = watch ? buildAssetRunOptions(watch.taskId) : {};

  for (const runner of runners) {
    if (!runner.isAvailable()) continue;

    logger.info(`Running ${runner.name} for ${label}...`);
    const result = watch
      ? await runRunnerWithStatusWatch(
        runner,
        runPrompt,
        previousNotes || undefined,
        watch.provider,
        watch.taskId,
        watch.config,
        watch.tagMode ?? 'code',
        assetOptions,
      )
      : await runner.run(runPrompt, previousNotes || undefined);
    if ('stoppedByStatus' in result && result.stoppedByStatus) {
      return null;
    }
    if (!result.success) {
      logger.warn(`${runner.name} ${label} failed — trying next runner`);
      previousNotes = `Previous runner (${runner.name}) output:\n${result.output}\nErrors:\n${result.error}`;
      continue;
    }

    const parsed = parse(result.output);
    if (parsed !== null) return parsed;

    logger.warn(`${runner.name} ${label} returned unparseable output — trying next runner`);
    previousNotes = `Previous runner (${runner.name}) produced unparseable output:\n${result.output}`;
  }

  logger.error(`${label} failed for all runners`);
  return null;
}

export function parsePlanningResponse(output: string): PlanningAnalysisResponse | null {
  const objects = extractJsonObjectsFromAgentOutput(output);
  for (let i = objects.length - 1; i >= 0; i--) {
    const parsed = parsePlanningResponseObject(objects[i]!);
    if (parsed) return parsed;
  }
  return null;
}

function parsePlanningResponseObject(obj: Record<string, unknown>): PlanningAnalysisResponse | null {

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
    const idx = subtasks.length;
    if (Array.isArray((entry as { blockedBy?: unknown }).blockedBy)) {
      const cleaned = ((entry as { blockedBy: unknown[] }).blockedBy)
        .filter((n): n is number =>
          typeof n === 'number' &&
          Number.isInteger(n) &&
          n >= 0 &&
          n < rawSubtasks.length &&
          n !== idx
        );
      if (cleaned.length > 0) draft.blockedBy = cleaned;
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

export function subtaskDepth(id: number | string): number {
  if (typeof id === 'number') return 0;
  return (id.match(/\./g) || []).length;
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
  consultProvider?: TaskProvider,
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

    // Review task phase (first): check tasks in review status for unresolved code review comments
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

    if (consultProvider && !taskId) {
      logger.info(`Fetching consult tasks (filter: ${filter})...`);
      const consultTasks = sortTasksByPriority(await consultProvider.fetchTasks());
      logger.info(`Found ${consultTasks.length} consult task(s)`);

      for (const task of consultTasks) {
        const result = await processConsultTask(task, filter, config, consultProvider, runners, screenAvailable, hooks, vm);
        if (result === 'processed') processed++;
        else skipped++;
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
    clearActiveTask(cwd);
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

  const blockedReason = await getBlockedBySkipReason(task, provider);
  if (blockedReason) {
    logger.info(`[${task.id}] "${task.name}" skipped — ${blockedReason}`);
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
      await notifySleeping(task, provider, config, hooks, vm);
      return 'skipped';
    }
  } else {
    await applyAutoApproveTag(task, config, provider);
    await applyAutoReviewTag(task, config, provider);

    if (!screenAvailable) {
      await notifySleeping(task, provider, config, hooks, vm);
      return 'skipped';
    }

    const clarification = await checkNeedsClarification(task, config, provider, runners);
    if (clarification) {
      await postCommentWithHooks(task, `${config.commentPrefix} ${clarification}`, config, provider, hooks, vm);
      await provider.updateStatus(task.id, getPendingStatus(config));
      logger.info(`Posted clarification question, set status to ${getPendingStatus(config)}`);
      return 'skipped';
    }
  }

  writeActiveTask(process.cwd(), task.id);
  try {
    if (isPlanningTask(task, config)) {
      await implementPlanningTask(task, config, provider, runners, hooks, vm);
    } else if (isThinkingTask(task, config)) {
      await implementThinkingTask(task, branchName, branchExists, config, provider, runners, hooks, vm);
    } else {
      await implementTask(task, branchName, branchExists, config, provider, runners, hooks, vm);
    }
    return 'processed';
  } finally {
    clearActiveTask(process.cwd());
  }
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

async function notifySleeping(
  task: Task,
  provider: TaskProvider,
  config: Config,
  hooks: AidevHooks,
  vm: HookVM | undefined
): Promise<void> {
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
    await postCommentWithHooks(
      task,
      `${config.commentPrefix} Cannot work on this task — the ${SLEEPING_MARKER} or the screen is locked. ` +
        'AI agents require an active display session to operate. Please wake the machine and unlock the screen so I can continue.',
      config,
      provider,
      hooks,
      vm
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
      const parsed = extractJsonObjectFromAgentOutput(result.output) as { clear?: boolean; question?: string | null } | null;
      if (!parsed || typeof parsed.clear !== 'boolean') {
        logger.debug(`${runner.name} clarification response had no JSON — trying next runner`);
        continue;
      }
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
    await postCommentWithHooks(
      task,
      `${config.commentPrefix} Branch \`${branchName}\` has merge conflicts with \`${config.githubBaseBranch}\` ` +
      `in ${check.conflictFiles.length} file(s). Attempting automatic resolution...`,
      config, provider, hooks, vm
    );
  } catch { /* ignore */ }

  if (!git.mergeBaseBranch(config.gitRemote, config.githubBaseBranch)) {
    const { task: safeTask, context: safeContext } = applySafeMode(task, context, config);
    let prompt = buildConflictResolutionPrompt(safeTask, check.conflictFiles, safeContext);

    // beforeResolveConflicts hook
    if (vm) {
      const conflictCtx: ResolveConflictsContext = { task, config, branchName, conflictFiles: check.conflictFiles, prompt };
      const modified = await executeHook(hooks, 'beforeResolveConflicts', conflictCtx, vm);
      prompt = modified.prompt;
    }

    prompt = augmentPromptForAssets(prompt, task.id);
    const assetOptions = buildAssetRunOptions(task.id);

    let resolved = false;
    let previousNotes = '';

    for (const runner of runners) {
      if (!runner.isAvailable()) continue;

      logger.info(`Running ${runner.name} to resolve merge conflicts...`);
      const result = await runRunnerWithStatusWatch(
        runner, prompt, previousNotes || undefined, provider, task.id, config, 'code', assetOptions,
      );

      if (result.stoppedByStatus) {
        git.abortMerge();
        await handleImplementationStoppedByStatus(
          task,
          result.stopReason || 'task status changed externally',
          config,
          provider,
          hooks,
          vm,
          branchName,
          true,
        );
        return false;
      }

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
        await postCommentWithHooks(
          task,
          `${config.commentPrefix} Failed to automatically resolve merge conflicts. Manual intervention needed to rebase/merge the branch.`,
          config, provider, hooks, vm
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
      await postCommentWithHooks(task, `${config.commentPrefix} Merge conflicts resolved automatically.`, config, provider, hooks, vm);
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
    await postCommentWithHooks(task, `${config.commentPrefix} ${verb} implementation on branch \`${branchName}\``, config, provider, hooks, vm);
  } catch (err) {
    logger.warn(`Could not update task status: ${err}`);
  }

  if (branchExists) {
    if (!git.fetchAndCheckoutBranch(config.gitRemote, branchName)) {
      logger.error(`Failed to checkout existing branch ${branchName}`);
      await postCommentWithHooks(task, `${config.commentPrefix} Failed to checkout existing branch. Manual intervention needed.`, config, provider, hooks, vm);
      return;
    }
    logger.info(`Continuing on existing branch: ${branchName}`);
  } else {
    if (!git.createBranchFromRemote(config.gitRemote, config.githubBaseBranch, branchName)) {
      logger.error(`Failed to create branch ${branchName} from ${config.gitRemote}/${config.githubBaseBranch}`);
      await postCommentWithHooks(task, `${config.commentPrefix} Failed to prepare git branch. Manual intervention needed.`, config, provider, hooks, vm);
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

  const { task: safeTask, context: safeContext } = applySafeMode(task, context, config);

  let implementPrompt = buildImplementPrompt(safeTask, safeContext);

  // beforeEachTask hook — may modify context (e.g. improve the prompt)
  if (vm) {
    const taskCtx: TaskContext = { task: safeTask, config, branchName, prompt: implementPrompt };
    const modified = await executeHook(hooks, 'beforeEachTask', taskCtx, vm);
    implementPrompt = modified.prompt;
  }

  implementPrompt = augmentPromptForAssets(implementPrompt, task.id);
  const assetOptions = buildAssetRunOptions(task.id);

  // Run AI runners in order with fallback
  let implemented = false;
  let previousNotes = '';
  let noChangeResponse: string | undefined;

  for (const runner of runners) {
    if (!runner.isAvailable()) {
      logger.debug(`${runner.name} not available, skipping`);
      continue;
    }

    logger.info(`Running ${runner.name}...`);
    const result = await runRunnerWithStatusWatch(
      runner, implementPrompt, previousNotes || undefined, provider, task.id, config, 'code', assetOptions,
    );

    if (result.stoppedByStatus) {
      await handleImplementationStoppedByStatus(
        task,
        result.stopReason || 'task status changed externally',
        config,
        provider,
        hooks,
        vm,
        branchName,
        branchExists,
      );
      return;
    }

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
      // The agent may have completed a status update, asked a question, or otherwise
      // responded substantively without touching files (e.g. it's waiting for direction
      // before continuing). Keep that response so it isn't silently discarded below.
      noChangeResponse = result.output.trim() ? result.output : noChangeResponse;
    }
  }

  if (!implemented) {
    if (noChangeResponse) {
      logger.warn('No AI runner produced file changes, but received a substantive response — recording it and setting task back to pending');
      const comment = buildNoChangesCompletionComment(config, noChangeResponse);
      await postCommentWithHooks(task, comment, config, provider, hooks, vm);
      try {
        await provider.updateStatus(task.id, getPendingStatus(config));
      } catch (err) {
        logger.warn(`Could not update task status: ${err}`);
      }
      if (!branchExists) {
        git.deleteBranch(branchName);
      }
      return;
    }

    logger.error('All AI runners failed or produced no changes');
    const diagnostics = collectAndLogDiagnostics();
    await postCommentWithHooks(
      task,
      `${config.commentPrefix} All AI runners failed. Manual implementation needed.\n\n${diagnostics}`,
      config, provider, hooks, vm
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
    await postCommentWithHooks(task, comment, config, provider, hooks, vm);
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

function parseThinkingAnalysisObject(obj: Record<string, unknown>): ThinkingAnalysisDraft | null {
  const rawSubtasks = Array.isArray(obj.subtasks) ? obj.subtasks : [];
  const subtasks: ThinkingAnalysisDraft['subtasks'] = [];

  for (const s of rawSubtasks) {
    if (!s || typeof s !== 'object') continue;
    const entry = s as { id?: unknown; title?: unknown; description?: unknown };
    const title = typeof entry.title === 'string' ? entry.title.trim() : '';
    const description = typeof entry.description === 'string' ? entry.description.trim() : '';
    if (!title || !description) continue;

    const draft: ThinkingAnalysisDraft['subtasks'][number] = { title, description };
    if (typeof entry.id === 'number' || typeof entry.id === 'string') {
      draft.id = entry.id;
    }
    subtasks.push(draft);
  }

  if (subtasks.length === 0) return null;

  const taskSummary = typeof obj.taskSummary === 'string' ? obj.taskSummary.trim() : undefined;
  const instructions = typeof obj.instructions === 'string' ? obj.instructions : undefined;

  return {
    ...(taskSummary ? { taskSummary } : {}),
    ...(instructions !== undefined ? { instructions } : {}),
    subtasks,
  };
}

export function parseThinkingAnalysisResponse(output: string): ThinkingAnalysisDraft | null {
  const objects = extractJsonObjectsFromAgentOutput(output);
  for (let i = objects.length - 1; i >= 0; i--) {
    const parsed = parseThinkingAnalysisObject(objects[i]!);
    if (parsed) return parsed;
  }
  return null;
}

function buildThinkingTaskPlan(task: Task, parsed: ThinkingAnalysisDraft): ThinkingTaskPlan {
  const taskSummaryRaw = parsed.taskSummary?.trim() ?? '';
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
    'utf8',
  );
  writeTaskPlan(plan);

  return plan;
}

async function analyzeAndPlan(
  task: Task,
  context: string,
  runners: AIRunner[],
  provider: TaskProvider,
  config: Config,
): Promise<ThinkingTaskPlan | null> {
  if (runners.every((r) => !r.isAvailable())) {
    logger.error('No AI runner available for task analysis');
    return null;
  }

  logger.info('Analyzing task and creating implementation plan...');
  const parsed = await runAgentJsonAnalysis(
    runners,
    buildThinkingAnalysisPrompt(task, context),
    parseThinkingAnalysisResponse,
    'task analysis',
    { provider, taskId: task.id, config },
  );
  if (!parsed) return null;

  return buildThinkingTaskPlan(task, parsed);
}

export function parseSplitSubtaskResponse(output: string): Array<{ title: string; description: string }> | null {
  const objects = extractJsonObjectsFromAgentOutput(output);
  for (let i = objects.length - 1; i >= 0; i--) {
    const obj = objects[i]!;
    const rawSubtasks = Array.isArray(obj.subtasks) ? obj.subtasks : [];
    if (rawSubtasks.length !== 2) continue;

    const subtasks: Array<{ title: string; description: string }> = [];
    for (const entry of rawSubtasks) {
      if (!entry || typeof entry !== 'object') return null;
      const row = entry as { title?: unknown; description?: unknown };
      const title = typeof row.title === 'string' ? row.title.trim() : '';
      const description = typeof row.description === 'string' ? row.description.trim() : '';
      if (!title || !description) return null;
      subtasks.push({ title, description });
    }

    return subtasks;
  }

  return null;
}

export async function splitFailedSubtask(
  parentTask: Task,
  plan: ThinkingTaskPlan,
  failedSubtask: SubTask,
  runners: AIRunner[],
  provider?: TaskProvider,
  config?: Config,
): Promise<SubTask[] | null> {
  if (runners.every((r) => !r.isAvailable())) {
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
  const parsed = await runAgentJsonAnalysis(
    runners,
    splitPrompt,
    parseSplitSubtaskResponse,
    'sub-task split',
    provider && config ? { provider, taskId: parentTask.id, config } : undefined,
  );
  if (!parsed) return null;

  return parsed.map((entry, i) => ({
    id: `${failedSubtask.id}.${i + 1}`,
    title: entry.title,
    description: entry.description,
    status: 'pending' as const,
    attempts: 0,
  }));
}

async function executeSubTask(
  subtask: SubTask,
  task: Task,
  plan: ThinkingTaskPlan,
  config: Config,
  provider: TaskProvider,
  runners: AIRunner[],
  reviewContext: string | undefined,
  previousError: string | undefined,
  hasTicketConversationContext: boolean,
): Promise<'ok' | 'failed' | 'stopped'> {
  const instructionsPath = taskInstructionsPath(task.id);
  const instructions = fs.existsSync(instructionsPath)
    ? fs.readFileSync(instructionsPath, 'utf8')
    : '';

  const useCompactPrompt =
    (!!previousError && previousError !== '__git__') || !hasTicketConversationContext;

  const prompt = augmentPromptForAssets(
    buildThinkingSubtaskPrompt(
      subtask,
      task,
      plan,
      instructions,
      reviewContext,
      previousError,
      { compact: useCompactPrompt },
    ),
    task.id,
  );
  const assetOptions = buildAssetRunOptions(task.id);

  let implemented = false;
  let previousNotes = '';

  for (const runner of runners) {
    if (!runner.isAvailable()) continue;

    logger.info(`  Running ${runner.name} for step ${subtask.id}...`);
    const result = await runRunnerWithStatusWatch(
      runner, prompt, previousNotes || undefined, provider, task.id, config, 'code', assetOptions,
    );

    if (result.stoppedByStatus) {
      return 'stopped';
    }

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

  return implemented ? 'ok' : 'failed';
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
    await postCommentWithHooks(
      task,
      `${config.commentPrefix} ${verb} implementation on branch \`${branchName}\` (thinking mode — will analyze and break into sub-tasks)`,
      config, provider, hooks, vm
    );
  } catch (err) {
    logger.warn(`Could not update task status: ${err}`);
  }

  if (branchExists) {
    if (!git.fetchAndCheckoutBranch(config.gitRemote, branchName)) {
      logger.error(`Failed to checkout existing branch ${branchName}`);
      await postCommentWithHooks(task, `${config.commentPrefix} Failed to checkout existing branch. Manual intervention needed.`, config, provider, hooks, vm);
      return;
    }
    logger.info(`Continuing on existing branch: ${branchName}`);
  } else {
    if (!git.createBranchFromRemote(config.gitRemote, config.githubBaseBranch, branchName)) {
      logger.error(`Failed to create branch ${branchName} from ${config.gitRemote}/${config.githubBaseBranch}`);
      await postCommentWithHooks(task, `${config.commentPrefix} Failed to prepare git branch. Manual intervention needed.`, config, provider, hooks, vm);
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

  const { task: safeTask, context: safeContext } = applySafeMode(task, context, config);

  // Check for an existing plan (resume scenario)
  let plan = readTaskPlan(task.id);
  if (plan) {
    logger.info(`Found existing task plan with ${plan.subtasks.length} sub-tasks — resuming`);
  } else {
    plan = await analyzeAndPlan(safeTask, safeContext, runners, provider, config);
    if (!plan) {
      const statusCheck = await checkImplementationStillActive(provider, task.id, config);
      if (!statusCheck.active) {
        await handleImplementationStoppedByStatus(
          task,
          statusCheck.reason,
          config,
          provider,
          hooks,
          vm,
          branchName,
          branchExists,
        );
        return;
      }

      logger.error('Failed to create implementation plan');
      await postCommentWithHooks(task, `${config.commentPrefix} Failed to analyze and break down the task. Manual implementation needed.`, config, provider, hooks, vm);
      cleanupThinkingFiles(task.id);
      if (!branchExists) git.deleteBranch(branchName);
      return;
    }

    logger.info(`Task broken into ${plan.subtasks.length} sub-tasks`);

    try {
      await postCommentWithHooks(
        task,
        `${config.commentPrefix} Task analyzed and broken into ${plan.subtasks.length} sub-tasks:\n\n${formatSubtaskList(plan)}`,
        config, provider, hooks, vm
      );
    } catch (err) {
      logger.warn(`Failed to post breakdown comment: ${err}`);
    }
  }

  // beforeThinkingTask hook — may adjust subtask titles/descriptions before execution
  if (vm) {
    const thinkCtx: ThinkingTaskContext = {
      task: safeTask,
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

    if (!(await ensureImplementationStillActive(task, config, provider, hooks, vm, branchName, branchExists))) {
      return;
    }

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
        const newSubtasks = await splitFailedSubtask(task, plan, subtask, runners, provider, config);
        if (!newSubtasks) {
          const statusCheck = await checkImplementationStillActive(provider, task.id, config);
          if (!statusCheck.active) {
            await handleImplementationStoppedByStatus(
              task,
              statusCheck.reason,
              config,
              provider,
              hooks,
              vm,
              branchName,
              branchExists,
            );
            return;
          }
        }
        if (newSubtasks) {
          plan.subtasks.splice(i, 1, ...newSubtasks);
          writeTaskPlan(plan);
          const newIds = newSubtasks.map((s) => s.id).join(', ');
          logger.info(`  Step ${failedId} was split into ${newIds}`);
          try {
            await postCommentWithHooks(
              task,
              `${config.commentPrefix} Step ${failedId} was split into ${newIds}:\n\n${formatSubtaskList(plan)}`,
              config, provider, hooks, vm
            );
          } catch { /* ignore */ }
          i--; // re-process this index — it now points at the first new sub-task
          continue;
        }
        logger.warn(`  Could not split failed step ${failedId} — falling back to plain retry`);
        try {
          await postCommentWithHooks(
            task,
            `${config.commentPrefix} Failed to automatically split step ${failedId}. Retrying as-is.`,
            config, provider, hooks, vm
          );
        } catch { /* ignore */ }
      } else if (!isGitFailure && attempts >= 2 && depth >= 2) {
        logger.warn(`  Step ${subtask.id} has reached the split-depth cap — manual intervention may be needed`);
        try {
          await postCommentWithHooks(
            task,
            `${config.commentPrefix} Step ${subtask.id} has already been split twice and is still failing. Retrying as-is — please consider manual intervention.`,
            config, provider, hooks, vm
          );
        } catch { /* ignore */ }
      }
    }

    const previousError = subtask.lastError;
    subtask.status = 'running';
    subtask.attempts = (subtask.attempts ?? 0) + 1;
    writeTaskPlan(plan);

    logger.info(`  Starting step ${subtask.id}: ${subtask.title} (attempt ${subtask.attempts})`);
    const subtaskResult = await executeSubTask(
      subtask,
      safeTask,
      plan,
      config,
      provider,
      runners,
      reviewContext,
      previousError,
      ticketConversationContext.trim().length > 0,
    );

    if (subtaskResult === 'stopped') {
      await handleImplementationStoppedByStatus(
        task,
        'task status changed externally',
        config,
        provider,
        hooks,
        vm,
        branchName,
        branchExists,
      );
      return;
    }

    if (subtaskResult === 'failed') {
      const diagnostics = collectAndLogDiagnostics();
      subtask.status = 'failed';
      subtask.lastError = truncateError(diagnostics);
      writeTaskPlan(plan);
      allSucceeded = false;
      logger.error(`  Step ${subtask.id} failed: ${subtask.title}`);

      try {
        await postCommentWithHooks(
          task,
          `${config.commentPrefix} Step ${subtask.id} failed: ${subtask.title}\n\n${formatSubtaskList(plan)}\n\n${diagnostics}`,
          config, provider, hooks, vm
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
      await postCommentWithHooks(
        task,
        `${config.commentPrefix} Step ${subtask.id} complete: ${subtask.title}\n\n${formatSubtaskList(plan)}`,
        config, provider, hooks, vm
      );
    } catch { /* ignore */ }
  }

  if (!allSucceeded) {
    logger.error('Thinking task did not complete all sub-tasks');
    try {
      const diagnostics = collectAndLogDiagnostics();
      await postCommentWithHooks(
        task,
        `${config.commentPrefix} Thinking task did not complete all sub-tasks. Manual intervention needed.\n\n${diagnostics}`,
        config, provider, hooks, vm
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
    await postCommentWithHooks(task, comment, config, provider, hooks, vm);
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
  hooks: AidevHooks = {},
  vm?: HookVM
): Promise<void> {
  logger.info(`Implementing planning task: ${task.name}`);

  try {
    await provider.updateStatus(task.id, 'in progress');
    await postCommentWithHooks(
      task,
      `${config.commentPrefix} Starting planning mode — analyzing task and drafting sub-tickets`,
      config, provider, hooks, vm
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

  const { task: safeTask, context: safeContext } = applySafeMode(task, context, config);

  const prompt = buildPlanningAnalysisPrompt(safeTask, safeContext);

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
      await postCommentWithHooks(task, `${config.commentPrefix} Planning produced no sub-tasks`, config, provider, hooks, vm);
    } catch { /* ignore */ }
    return;
  }

  if (parsed.clarification) {
    try {
      await postCommentWithHooks(task, `${config.commentPrefix} ${parsed.clarification}`, config, provider, hooks, vm);
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
      await postCommentWithHooks(task, `${config.commentPrefix} Planning produced no sub-tasks`, config, provider, hooks, vm);
    } catch { /* ignore */ }
    return;
  }

  const planningTagLower = config.planningTag.toLowerCase();
  const ticketTags = task.tags.filter((t) => t.toLowerCase() !== planningTagLower);

  const created: Array<{ title: string; url: string; id: string }> = [];
  const failures: Array<{ title: string; error: string }> = [];
  const createdIdByIndex: Array<string | null> = [];

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
      createdIdByIndex.push(result.id);
      logger.success(`  Created sub-ticket "${draft.title}" — ${result.url}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.warn(`  Failed to create sub-ticket "${draft.title}": ${message}`);
      failures.push({ title: draft.title, error: message });
      createdIdByIndex.push(null);
    }
  }

  const blockerFailures: Array<{ title: string; error: string }> = [];
  if (provider.setBlockedBy) {
    for (let i = 0; i < parsed.subtasks.length; i++) {
      const draft = parsed.subtasks[i];
      const taskId = createdIdByIndex[i];
      if (!taskId || !draft.blockedBy || draft.blockedBy.length === 0) continue;
      const resolvedIds = draft.blockedBy
        .map((idx) => createdIdByIndex[idx])
        .filter((id): id is string => id !== null);
      if (resolvedIds.length === 0) continue;
      try {
        await provider.setBlockedBy(taskId, resolvedIds);
        logger.info(`  Set blockers for "${draft.title}"`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.warn(`  Failed to set blockers for "${draft.title}": ${message}`);
        blockerFailures.push({ title: draft.title, error: message });
      }
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
  if (blockerFailures.length > 0) {
    summaryLines.push('', 'Failed to set blockers:');
    for (const f of blockerFailures) {
      summaryLines.push(`- ${f.title} — ${f.error}`);
    }
  }
  try {
    await postCommentWithHooks(task, summaryLines.join('\n'), config, provider, hooks, vm);
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

export function getConsultSkipReason(
  status: string,
  filter: RunFilter,
  pendingStatus: string,
  openStatus: string = 'open',
): string | null {
  const base = getRunSkipReason(status, filter, pendingStatus, openStatus);
  if (base) return base;
  if (status.toLowerCase() !== pendingStatus.toLowerCase()) {
    return 'consult tasks only run when pending';
  }
  return null;
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
      await notifySleeping(task, provider, config, hooks, vm);
      return 'skipped';
    }
  } else {
    if (!screenAvailable) {
      await notifySleeping(task, provider, config, hooks, vm);
      return 'skipped';
    }

    const clarification = await checkNeedsClarification(task, config, provider, runners);
    if (clarification) {
      await postCommentWithHooks(task, `${config.commentPrefix} ${clarification}`, config, provider, hooks, vm);
      await provider.updateStatus(task.id, getPendingStatus(config));
      logger.info(`Posted clarification question, set status to ${getPendingStatus(config)}`);
      return 'skipped';
    }
  }

  writeActiveTask(process.cwd(), task.id);
  try {
    if (isPlanningTask(task, config)) {
      await implementPlanningTask(task, config, provider, runners, hooks, vm);
    } else if (isThinkingTask(task, config)) {
      await implementNonCodeThinkingTask(task, config, provider, runners, hooks, vm);
    } else {
      await implementNonCodeTask(task, config, provider, runners, hooks, vm);
    }
    return 'processed';
  } finally {
    clearActiveTask(process.cwd());
  }
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
    await postCommentWithHooks(task, `${config.commentPrefix} Starting non-code task execution`, config, provider, hooks, vm);
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

  const { task: safeTask, context: safeContext } = applySafeMode(task, context, config);

  let nonCodePrompt = buildNonCodePrompt(safeTask, safeContext);

  // beforeNonCodeTask hook
  if (vm) {
    const ncCtx: NonCodeTaskContext = { task: safeTask, config, prompt: nonCodePrompt };
    const modified = await executeHook(hooks, 'beforeNonCodeTask', ncCtx, vm);
    nonCodePrompt = modified.prompt;
  }

  nonCodePrompt = augmentPromptForAssets(nonCodePrompt, task.id);
  const assetOptions = buildAssetRunOptions(task.id);

  let implemented = false;
  let agentOutput = '';
  let previousNotes = '';

  for (const runner of runners) {
    if (!runner.isAvailable()) {
      logger.debug(`${runner.name} not available, skipping`);
      continue;
    }

    logger.info(`Running ${runner.name}...`);
    const result = await runRunnerWithStatusWatch(
      runner, nonCodePrompt, previousNotes || undefined, provider, task.id, config, 'non-code', assetOptions,
    );

    if (result.stoppedByStatus) {
      await handleImplementationStoppedByStatus(
        task,
        result.stopReason || 'task status changed externally',
        config,
        provider,
        hooks,
        vm,
      );
      return;
    }

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
    await postCommentWithHooks(
      task,
      `${config.commentPrefix} All AI runners failed. Manual intervention needed.\n\n${diagnostics}`,
      config, provider, hooks, vm
    );
    return;
  }

  try {
    const comment = buildNonCodeCompletionComment(config, agentOutput);
    await postCommentWithHooks(task, comment, config, provider, hooks, vm);
    await provider.updateStatus(task.id, getInReviewStatus(config));
  } catch (err) {
    logger.warn(`Failed to update task: ${err instanceof Error ? err.message : err}`);
  }

  // afterNonCodeTask hook
  if (vm) {
    const afterCtx: NonCodeTaskContext & { success: boolean; output: string } = {
      task: safeTask, config, prompt: nonCodePrompt, success: true, output: agentOutput,
    };
    await executeHook(hooks, 'afterNonCodeTask', afterCtx, vm);
  }

  logger.success(`Non-code task complete: ${task.name}`);
}

async function processConsultTask(
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
  const skipReason = getConsultSkipReason(task.status, filter, pendingStatus, openStatus);

  logger.task(`[${task.id}] "${task.name}" [consult] (status: ${task.status})`);

  if (skipReason) {
    logger.info(`[${task.id}] "${task.name}" skipped — ${skipReason}`);
    return 'skipped';
  }

  if (!screenAvailable) {
    await notifySleeping(task, provider, config, hooks, vm);
    return 'skipped';
  }

  writeActiveTask(process.cwd(), task.id);
  try {
    await implementConsultTask(task, config, provider, runners, hooks, vm);
    return 'processed';
  } finally {
    clearActiveTask(process.cwd());
  }
}

async function implementConsultTask(
  task: Task,
  config: Config,
  provider: TaskProvider,
  runners: AIRunner[],
  hooks: AidevHooks = {},
  vm?: HookVM
): Promise<void> {
  logger.info(`Running consult task: ${task.name}`);

  try {
    await provider.updateStatus(task.id, 'in progress');
    await postCommentWithHooks(task, `${config.commentPrefix} Starting consultation`, config, provider, hooks, vm);
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

  const { task: safeTask, context: safeContext } = applySafeMode(task, context, config);
  let consultPrompt = buildConsultPrompt(safeTask, safeContext);

  if (vm) {
    const ncCtx: NonCodeTaskContext = { task: safeTask, config, prompt: consultPrompt };
    const modified = await executeHook(hooks, 'beforeNonCodeTask', ncCtx, vm);
    consultPrompt = modified.prompt;
  }

  consultPrompt = augmentPromptForAssets(consultPrompt, task.id);
  const assetOptions = buildAssetRunOptions(task.id);

  let implemented = false;
  let agentOutput = '';
  let previousNotes = '';

  for (const runner of runners) {
    if (!runner.isAvailable()) {
      logger.debug(`${runner.name} not available, skipping`);
      continue;
    }

    logger.info(`Running ${runner.name}...`);
    const result = await runRunnerWithStatusWatch(
      runner, consultPrompt, previousNotes || undefined, provider, task.id, config, 'consult', assetOptions,
    );

    if (result.stoppedByStatus) {
      await handleImplementationStoppedByStatus(
        task,
        result.stopReason || 'task status changed externally',
        config,
        provider,
        hooks,
        vm,
      );
      return;
    }

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
    await postCommentWithHooks(
      task,
      `${config.commentPrefix} Consultation failed. Manual intervention needed.\n\n${diagnostics}`,
      config, provider, hooks, vm
    );
    return;
  }

  try {
    const comment = buildConsultCompletionComment(config, agentOutput);
    await postCommentWithHooks(task, comment, config, provider, hooks, vm);

    if (provider.removeTag) {
      await provider.removeTag(task.id, config.consultTag);
    }
    if (provider.addTag) {
      await provider.addTag(task.id, config.consultedTag);
    }
    await provider.updateStatus(task.id, getPendingStatus(config));
  } catch (err) {
    logger.warn(`Failed to update task after consultation: ${err instanceof Error ? err.message : err}`);
  }

  if (vm) {
    const afterCtx: NonCodeTaskContext & { success: boolean; output: string } = {
      task: safeTask, config, prompt: consultPrompt, success: true, output: agentOutput,
    };
    await executeHook(hooks, 'afterNonCodeTask', afterCtx, vm);
  }

  logger.success(`Consult task complete: ${task.name}`);
}

// ─── Non-code thinking task processing ──────────────────────────────────────

async function analyzeAndPlanNonCode(
  task: Task,
  context: string,
  runners: AIRunner[],
  provider: TaskProvider,
  config: Config,
): Promise<ThinkingTaskPlan | null> {
  if (runners.every((r) => !r.isAvailable())) {
    logger.error('No AI runner available for non-code task analysis');
    return null;
  }

  logger.info('Analyzing non-code task and creating sub-task plan...');
  const parsed = await runAgentJsonAnalysis(
    runners,
    buildNonCodeAnalysisPrompt(task, context),
    parseThinkingAnalysisResponse,
    'non-code task analysis',
    { provider, taskId: task.id, config, tagMode: 'non-code' },
  );
  if (!parsed) return null;

  const taskSummaryRaw = parsed.taskSummary?.trim() ?? '';
  return {
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
    await postCommentWithHooks(
      task,
      `${config.commentPrefix} Starting non-code task execution (thinking mode — will analyze and break into sub-tasks)`,
      config, provider, hooks, vm
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

  const { task: safeTask, context: safeContext } = applySafeMode(task, context, config);

  const plan = await analyzeAndPlanNonCode(safeTask, safeContext, runners, provider, config);
  if (!plan) {
    const statusCheck = await checkImplementationStillActive(provider, task.id, config, 'non-code');
    if (!statusCheck.active) {
      await handleImplementationStoppedByStatus(
        task,
        statusCheck.reason,
        config,
        provider,
        hooks,
        vm,
      );
      return;
    }

    logger.error('Failed to create non-code task plan');
    await postCommentWithHooks(
      task,
      `${config.commentPrefix} Failed to analyze and break down the non-code task. Manual intervention needed.`,
      config, provider, hooks, vm
    );
    return;
  }

  logger.info(`Non-code task broken into ${plan.subtasks.length} sub-tasks`);

  try {
    await postCommentWithHooks(
      task,
      `${config.commentPrefix} Task analyzed and broken into ${plan.subtasks.length} sub-tasks:\n\n${formatSubtaskList(plan)}`,
      config, provider, hooks, vm
    );
  } catch (err) {
    logger.warn(`Failed to post non-code breakdown comment: ${err}`);
  }

  // beforeThinkingTask hook — may adjust subtask titles/descriptions before execution.
  // branchName is empty because non-code tasks don't create a branch.
  if (vm) {
    const thinkCtx: ThinkingTaskContext = {
      task: safeTask,
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
    if (!(await ensureImplementationStillActive(task, config, provider, hooks, vm, undefined, undefined, 'non-code'))) {
      return;
    }

    subtask.status = 'running';
    subtask.attempts = (subtask.attempts ?? 0) + 1;

    logger.info(`  Starting non-code step ${formatSubtaskId(subtask.id)}: ${subtask.title}`);

    const prompt = augmentPromptForAssets(
      buildNonCodeSubtaskPrompt(subtask, task, plan, previousResults, undefined),
      task.id,
    );
    const assetOptions = buildAssetRunOptions(task.id);

    let summary = '';
    let success = false;
    let previousNotes = '';

    for (const runner of runners) {
      if (!runner.isAvailable()) continue;

      logger.info(`    Running ${runner.name} for step ${formatSubtaskId(subtask.id)}...`);
      const result = await runRunnerWithStatusWatch(
        runner, prompt, previousNotes || undefined, provider, task.id, config, 'non-code', assetOptions,
      );

      if (result.stoppedByStatus) {
        await handleImplementationStoppedByStatus(
          task,
          result.stopReason || 'task status changed externally',
          config,
          provider,
          hooks,
          vm,
        );
        return;
      }

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
        await postCommentWithHooks(
          task,
          `${config.commentPrefix} Step ${formatSubtaskId(subtask.id)} failed: ${subtask.title}\n\n${formatSubtaskList(plan)}`,
          config, provider, hooks, vm
        );
      } catch { /* ignore */ }

      break;
    }

    // Post the sub-task summary BEFORE marking it done — per the task spec, the
    // comment is posted, then the sub-task is announced as complete.
    try {
      await postCommentWithHooks(
        task,
        `${config.commentPrefix} Step ${formatSubtaskId(subtask.id)}: ${subtask.title}\n\n---\n\n${summary}`,
        config, provider, hooks, vm
      );
    } catch (err) {
      logger.warn(`Failed to post summary for step ${formatSubtaskId(subtask.id)}: ${err}`);
    }

    previousResults.push({ id: subtask.id, title: subtask.title, summary });
    subtask.status = 'done';
    logger.success(`  Non-code step ${formatSubtaskId(subtask.id)} complete: ${subtask.title}`);

    try {
      await postCommentWithHooks(
        task,
        `${config.commentPrefix} Step ${formatSubtaskId(subtask.id)} complete: ${subtask.title}\n\n${formatSubtaskList(plan)}`,
        config, provider, hooks, vm
      );
    } catch { /* ignore */ }
  }

  if (!allSucceeded) {
    logger.error('Non-code thinking task did not complete all sub-tasks');
    try {
      await postCommentWithHooks(
        task,
        `${config.commentPrefix} Non-code thinking task did not complete all sub-tasks. Manual intervention needed.`,
        config, provider, hooks, vm
      );
    } catch { /* ignore */ }
    return;
  }

  try {
    await postCommentWithHooks(task, buildNonCodeThinkingCompletionComment(config), config, provider, hooks, vm);
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
    await notifySleeping(task, provider, config, hooks, vm);
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

  const { task: safeTask } = applySafeMode(task, '', config);
  let reviewPrompt = buildReviewPrompt(safeTask, threads);

  // beforeReviewTask hook
  if (vm) {
    const reviewCtx: ReviewTaskContext = { task, config, branchName, threads, prompt: reviewPrompt };
    const modified = await executeHook(hooks, 'beforeReviewTask', reviewCtx, vm);
    reviewPrompt = modified.prompt;
  }

  reviewPrompt = augmentPromptForAssets(reviewPrompt, task.id);
  const assetOptions = buildAssetRunOptions(task.id);

  let success = false;
  let agentOutput = '';
  let previousNotes = '';

  for (const runner of runners) {
    if (!runner.isAvailable()) continue;

    logger.info(`Running ${runner.name} to address review comments...`);
    const result = await runner.run(reviewPrompt, previousNotes || undefined, assetOptions);

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
      await postCommentWithHooks(
        task,
        `${config.commentPrefix} Failed to address code review comments automatically.\n\n${diagnostics}`,
        config, provider, hooks, vm
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
      await postCommentWithHooks(task, comment, config, provider, hooks, vm);
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

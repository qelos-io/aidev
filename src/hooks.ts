import * as fs from 'node:fs';
import * as path from 'node:path';
import { Config, Task } from './types';
import { TaskProvider } from './providers/base';
import { AIRunner, AIRunResult } from './ai/base';
import { ReviewThread } from './github';
import { logger } from './logger';

// ─── Hook context types ──────────────────────────────────────────────────────

export interface RunContext {
  config: Config;
  filter: string;
  taskCount: number;
}

export interface TaskContext {
  task: Task;
  config: Config;
  branchName: string;
  prompt: string;
}

export interface ResolveConflictsContext {
  task: Task;
  config: Config;
  branchName: string;
  conflictFiles: string[];
  prompt: string;
}

export interface NonCodeTaskContext {
  task: Task;
  config: Config;
  prompt: string;
}

export interface ThinkingTaskContext {
  task: Task;
  config: Config;
  branchName: string;
  subtasks: Array<{ id: number; title: string; description: string; status: string }>;
}

export interface ReviewTaskContext {
  task: Task;
  config: Config;
  branchName: string;
  threads: ReviewThread[];
  prompt: string;
}

// ─── VM — abilities available to hook functions ──────────────────────────────

export interface HookVM {
  /** Run a prompt through the first available AI runner */
  runAI(prompt: string): Promise<AIRunResult>;
  /** Post a comment on a task */
  postComment(taskId: string, text: string): Promise<void>;
  /** Update task status */
  updateStatus(taskId: string, status: string): Promise<void>;
  /** Get task comments */
  getComments(taskId: string): Promise<Array<{ id: string; text: string; author: string }>>;
  /** Access the logger */
  log: {
    info(msg: string): void;
    warn(msg: string): void;
    error(msg: string): void;
  };
}

// ─── Hook function signatures ────────────────────────────────────────────────

export interface AidevHooks {
  /** Called before the run loop starts processing tasks */
  beforeRun?(context: RunContext, vm: HookVM): Promise<RunContext | void>;
  /** Called after the run loop finishes processing all tasks */
  afterRun?(context: RunContext & { processed: number; skipped: number }, vm: HookVM): Promise<void>;
  /** Called before each task is implemented (code tasks) */
  beforeEachTask?(context: TaskContext, vm: HookVM): Promise<TaskContext | void>;
  /** Called after each task is implemented (code tasks) */
  afterEachTask?(context: TaskContext & { success: boolean }, vm: HookVM): Promise<void>;
  /** Called before merge conflict resolution */
  beforeResolveConflicts?(context: ResolveConflictsContext, vm: HookVM): Promise<ResolveConflictsContext | void>;
  /** Called after merge conflict resolution */
  afterResolveConflicts?(context: ResolveConflictsContext & { resolved: boolean }, vm: HookVM): Promise<void>;
  /** Called before each non-code task is executed */
  beforeNonCodeTask?(context: NonCodeTaskContext, vm: HookVM): Promise<NonCodeTaskContext | void>;
  /** Called after each non-code task is executed */
  afterNonCodeTask?(context: NonCodeTaskContext & { success: boolean; output: string }, vm: HookVM): Promise<void>;
  /** Called before a thinking task is analyzed and planned */
  beforeThinkingTask?(context: ThinkingTaskContext, vm: HookVM): Promise<ThinkingTaskContext | void>;
  /** Called after all sub-tasks of a thinking task complete */
  afterThinkingTask?(context: ThinkingTaskContext & { success: boolean }, vm: HookVM): Promise<void>;
  /** Called before a review task's unresolved threads are processed */
  beforeReviewTask?(context: ReviewTaskContext, vm: HookVM): Promise<ReviewTaskContext | void>;
  /** Called after a review task's threads have been processed */
  afterReviewTask?(context: ReviewTaskContext & { success: boolean; resolvedCount: number }, vm: HookVM): Promise<void>;
}

// ─── Loader ──────────────────────────────────────────────────────────────────

/**
 * Loads hooks from the file path specified by AIDEV_HOOKS_PATH env var or
 * the config's hooksPath. Supports .ts (via jiti) and .js files.
 * Returns an empty object if no hooks file is configured or found. Exports that are not
 * known hook names are stripped so the returned object only contains hook functions.
 */
export function loadHooks(hooksPath: string): AidevHooks {
  if (!hooksPath) return {};

  const resolved = path.isAbsolute(hooksPath)
    ? hooksPath
    : path.resolve(process.cwd(), hooksPath);

  if (!fs.existsSync(resolved)) {
    logger.warn(`Hooks file not found: ${resolved} — hooks disabled`);
    return {};
  }

  try {
    let mod: Record<string, unknown>;

    if (resolved.endsWith('.ts')) {
      // Use jiti to load TypeScript files at runtime — no compiler needed
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { createJiti } = require('jiti') as typeof import('jiti');
      const jiti = createJiti(__filename, { interopDefault: true });
      mod = jiti(resolved) as Record<string, unknown>;
    } else {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      mod = require(resolved);
    }

    const hooks: AidevHooks = (mod.default || mod) as AidevHooks;

    const validKeys = new Set<string>([
      'beforeRun', 'afterRun',
      'beforeEachTask', 'afterEachTask',
      'beforeResolveConflicts', 'afterResolveConflicts',
      'beforeNonCodeTask', 'afterNonCodeTask',
      'beforeThinkingTask', 'afterThinkingTask',
      'beforeReviewTask', 'afterReviewTask',
    ]);

    // Keep only known hook names; drop unknown keys and non-functions
    for (const key of Object.keys(hooks)) {
      if (!validKeys.has(key)) {
        delete (hooks as Record<string, unknown>)[key];
        continue;
      }
      const val = (hooks as Record<string, unknown>)[key];
      if (typeof val !== 'function') {
        logger.warn(`Hook "${key}" is not a function — ignoring`);
        delete (hooks as Record<string, unknown>)[key];
      }
    }

    const loaded = Object.keys(hooks).filter((k) => validKeys.has(k) && typeof (hooks as Record<string, unknown>)[k] === 'function');
    if (loaded.length > 0) {
      logger.info(`Hooks loaded: ${loaded.join(', ')}`);
    } else {
      logger.debug('Hooks file loaded but no hook functions found');
    }

    return hooks;
  } catch (err) {
    logger.error(`Failed to load hooks from ${resolved}: ${err}`);
    return {};
  }
}

// ─── Executor ────────────────────────────────────────────────────────────────

export function createHookVM(
  provider: TaskProvider,
  runners: AIRunner[]
): HookVM {
  return {
    async runAI(prompt: string): Promise<AIRunResult> {
      const runner = runners.find((r) => r.isAvailable());
      if (!runner) {
        return { success: false, output: '', error: 'No AI runner available' };
      }
      return runner.run(prompt);
    },
    async postComment(taskId: string, text: string): Promise<void> {
      await provider.postComment(taskId, text);
    },
    async updateStatus(taskId: string, status: string): Promise<void> {
      await provider.updateStatus(taskId, status);
    },
    async getComments(taskId: string) {
      const comments = await provider.getComments(taskId);
      return comments.map((c) => ({ id: c.id, text: c.text, author: c.author }));
    },
    log: {
      info: (msg: string) => logger.info(`[hook] ${msg}`),
      warn: (msg: string) => logger.warn(`[hook] ${msg}`),
      error: (msg: string) => logger.error(`[hook] ${msg}`),
    },
  };
}

/**
 * Safely execute a hook function. If the hook throws, the error propagates
 * to the caller (which should abort the operation). If the hook returns a
 * modified context, that context is returned; otherwise the original is.
 */
export async function executeHook<T>(
  hooks: AidevHooks,
  hookName: keyof AidevHooks,
  context: T,
  vm: HookVM
): Promise<T> {
  const fn = hooks[hookName] as ((ctx: T, vm: HookVM) => Promise<T | void>) | undefined;
  if (!fn) return context;

  logger.debug(`Executing hook: ${hookName}`);
  const result = await fn(context, vm);
  return (result ?? context) as T;
}

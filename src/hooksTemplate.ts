/** Canonical list of all supported hook names, kept in sync with KNOWN_HOOKS in hooks.ts */
export const HOOK_NAMES: string[] = [
  'beforeRun',
  'afterRun',
  'beforeEachTask',
  'afterEachTask',
  'beforeResolveConflicts',
  'afterResolveConflicts',
  'beforeNonCodeTask',
  'afterNonCodeTask',
  'beforeThinkingTask',
  'afterThinkingTask',
  'beforeReviewTask',
  'afterReviewTask',
  'beforeComment',
  'afterComment',
];

export function generateFullHooksFile(): string {
  return `// aidev hooks — customize the AI task automation pipeline
//
// Each export below is an async (context, vm) hook. Return a new/updated context object to
// change prompts, subtasks, etc.; return nothing to keep the incoming context. Throw to abort
// the current step (whole run, single task, conflict resolution, etc., depending on the hook).
//
// vm: run AI (first available agent), postComment, updateStatus, getComments, log.info/warn/error
//
// .ts files are loaded via jiti — no TypeScript compiler or toolchain needed.

// ─── Context types (mirror aidev's internal shapes — tweak here for editor hints) ─

interface RunContext {
  config: Record<string, unknown>;
  filter: string;
  taskCount: number;
}

interface TaskContext {
  task: { id: string; name: string; description: string; status: string; url: string; tags: string[] };
  config: Record<string, unknown>;
  branchName: string;
  prompt: string;
}

interface ResolveConflictsContext {
  task: { id: string; name: string; description: string; status: string; url: string; tags: string[] };
  config: Record<string, unknown>;
  branchName: string;
  conflictFiles: string[];
  prompt: string;
}

interface NonCodeTaskContext {
  task: { id: string; name: string; description: string; status: string; url: string; tags: string[] };
  config: Record<string, unknown>;
  prompt: string;
}

interface ThinkingTaskContext {
  task: { id: string; name: string; description: string; status: string; url: string; tags: string[] };
  config: Record<string, unknown>;
  branchName: string;
  subtasks: Array<{ id: number; title: string; description: string; status: string }>;
}

interface ReviewTaskContext {
  task: { id: string; name: string; description: string; status: string; url: string; tags: string[] };
  config: Record<string, unknown>;
  branchName: string;
  threads: Array<{ id: string; body: string; resolved: boolean }>;
  prompt: string;
}

interface CommentContext {
  task: { id: string; name: string; description: string; status: string; url: string; tags: string[] };
  config: Record<string, unknown>;
  /** The comment text about to be (or already) posted */
  text: string;
}

interface HookVM {
  runAI(prompt: string): Promise<{ success: boolean; output: string; error: string }>;
  postComment(taskId: string, text: string): Promise<void>;
  updateStatus(taskId: string, status: string): Promise<void>;
  getComments(taskId: string): Promise<Array<{ id: string; text: string; author: string }>>;
  log: { info(msg: string): void; warn(msg: string): void; error(msg: string): void };
}

// ─── Hooks (fill in — ask an AI: "implement beforeEachTask to append X to the prompt") ─

/** Once before any task. AI idea: log counts, or throw if CI env var is missing. */
export async function beforeRun(_context: RunContext, _vm: HookVM): Promise<RunContext | void> {
  return;
}

/** After all tasks in this run. AI idea: post a summary comment or call an external webhook. */
export async function afterRun(_context: RunContext & { processed: number; skipped: number }, _vm: HookVM): Promise<void> {
  return;
}

/** Before each code task AI run. AI idea: append coding standards or repo-specific rules to context.prompt. */
export async function beforeEachTask(_context: TaskContext, _vm: HookVM): Promise<TaskContext | void> {
  return;
}

/** After a code task completes the success path (push + review). */
export async function afterEachTask(_context: TaskContext & { success: boolean }, _vm: HookVM): Promise<void> {
  return;
}

/** Before AI-driven merge conflict resolution. AI idea: tighten context.prompt for your stack. */
export async function beforeResolveConflicts(_context: ResolveConflictsContext, _vm: HookVM): Promise<ResolveConflictsContext | void> {
  return;
}

/** After conflict resolution; context.resolved is false when all runners failed. */
export async function afterResolveConflicts(_context: ResolveConflictsContext & { resolved: boolean }, _vm: HookVM): Promise<void> {
  return;
}

/** Before non-code task AI run. AI idea: format context.prompt for ticket-style replies. */
export async function beforeNonCodeTask(_context: NonCodeTaskContext, _vm: HookVM): Promise<NonCodeTaskContext | void> {
  return;
}

/** After non-code task; context.output is the agent response text posted to the ticket. */
export async function afterNonCodeTask(_context: NonCodeTaskContext & { success: boolean; output: string }, _vm: HookVM): Promise<void> {
  return;
}

/** After the plan exists, before subtasks run. AI idea: rewrite subtask descriptions for clarity. */
export async function beforeThinkingTask(_context: ThinkingTaskContext, _vm: HookVM): Promise<ThinkingTaskContext | void> {
  return;
}

/** After all thinking-task subtasks complete. AI idea: notify or archive artifacts. */
export async function afterThinkingTask(_context: ThinkingTaskContext & { success: boolean }, _vm: HookVM): Promise<void> {
  return;
}

/** Before a review task's unresolved threads are processed. AI idea: filter or prioritise threads. */
export async function beforeReviewTask(_context: ReviewTaskContext, _vm: HookVM): Promise<ReviewTaskContext | void> {
  return;
}

/** After a review task's threads have been processed. */
export async function afterReviewTask(_context: ReviewTaskContext & { success: boolean; resolvedCount: number }, _vm: HookVM): Promise<void> {
  return;
}

/** Before a comment is posted. Return modified context to change the text; throw to suppress. */
export async function beforeComment(_context: CommentContext, _vm: HookVM): Promise<CommentContext | void> {
  return;
}

/** After a comment has been posted. AI idea: append a signature or log the event. */
export async function afterComment(_context: CommentContext, _vm: HookVM): Promise<void> {
  return;
}
`;
}

// ─── Per-hook stub templates ─────────────────────────────────────────────────

interface HookStub {
  namedExport: string;
  objectMethod: string;
}

const HOOK_STUBS: Record<string, HookStub> = {
  beforeRun: {
    namedExport: `/** Once before any task. AI idea: log counts, or throw if CI env var is missing. */\nexport async function beforeRun(_context: RunContext, _vm: HookVM): Promise<RunContext | void> {\n  return;\n}\n`,
    objectMethod: `  /** Once before any task. AI idea: log counts, or throw if CI env var is missing. */\n  async beforeRun(_context: RunContext, _vm: HookVM): Promise<RunContext | void> {\n    return;\n  },\n`,
  },
  afterRun: {
    namedExport: `/** After all tasks in this run. AI idea: post a summary comment or call an external webhook. */\nexport async function afterRun(_context: RunContext & { processed: number; skipped: number }, _vm: HookVM): Promise<void> {\n  return;\n}\n`,
    objectMethod: `  /** After all tasks in this run. AI idea: post a summary comment or call an external webhook. */\n  async afterRun(_context: RunContext & { processed: number; skipped: number }, _vm: HookVM): Promise<void> {\n    return;\n  },\n`,
  },
  beforeEachTask: {
    namedExport: `/** Before each code task AI run. AI idea: append coding standards or repo-specific rules to context.prompt. */\nexport async function beforeEachTask(_context: TaskContext, _vm: HookVM): Promise<TaskContext | void> {\n  return;\n}\n`,
    objectMethod: `  /** Before each code task AI run. AI idea: append coding standards or repo-specific rules to context.prompt. */\n  async beforeEachTask(_context: TaskContext, _vm: HookVM): Promise<TaskContext | void> {\n    return;\n  },\n`,
  },
  afterEachTask: {
    namedExport: `/** After a code task completes the success path (push + review). */\nexport async function afterEachTask(_context: TaskContext & { success: boolean }, _vm: HookVM): Promise<void> {\n  return;\n}\n`,
    objectMethod: `  /** After a code task completes the success path (push + review). */\n  async afterEachTask(_context: TaskContext & { success: boolean }, _vm: HookVM): Promise<void> {\n    return;\n  },\n`,
  },
  beforeResolveConflicts: {
    namedExport: `/** Before AI-driven merge conflict resolution. AI idea: tighten context.prompt for your stack. */\nexport async function beforeResolveConflicts(_context: ResolveConflictsContext, _vm: HookVM): Promise<ResolveConflictsContext | void> {\n  return;\n}\n`,
    objectMethod: `  /** Before AI-driven merge conflict resolution. AI idea: tighten context.prompt for your stack. */\n  async beforeResolveConflicts(_context: ResolveConflictsContext, _vm: HookVM): Promise<ResolveConflictsContext | void> {\n    return;\n  },\n`,
  },
  afterResolveConflicts: {
    namedExport: `/** After conflict resolution; context.resolved is false when all runners failed. */\nexport async function afterResolveConflicts(_context: ResolveConflictsContext & { resolved: boolean }, _vm: HookVM): Promise<void> {\n  return;\n}\n`,
    objectMethod: `  /** After conflict resolution; context.resolved is false when all runners failed. */\n  async afterResolveConflicts(_context: ResolveConflictsContext & { resolved: boolean }, _vm: HookVM): Promise<void> {\n    return;\n  },\n`,
  },
  beforeNonCodeTask: {
    namedExport: `/** Before non-code task AI run. AI idea: format context.prompt for ticket-style replies. */\nexport async function beforeNonCodeTask(_context: NonCodeTaskContext, _vm: HookVM): Promise<NonCodeTaskContext | void> {\n  return;\n}\n`,
    objectMethod: `  /** Before non-code task AI run. AI idea: format context.prompt for ticket-style replies. */\n  async beforeNonCodeTask(_context: NonCodeTaskContext, _vm: HookVM): Promise<NonCodeTaskContext | void> {\n    return;\n  },\n`,
  },
  afterNonCodeTask: {
    namedExport: `/** After non-code task; context.output is the agent response text posted to the ticket. */\nexport async function afterNonCodeTask(_context: NonCodeTaskContext & { success: boolean; output: string }, _vm: HookVM): Promise<void> {\n  return;\n}\n`,
    objectMethod: `  /** After non-code task; context.output is the agent response text posted to the ticket. */\n  async afterNonCodeTask(_context: NonCodeTaskContext & { success: boolean; output: string }, _vm: HookVM): Promise<void> {\n    return;\n  },\n`,
  },
  beforeThinkingTask: {
    namedExport: `/** After the plan exists, before subtasks run. AI idea: rewrite subtask descriptions for clarity. */\nexport async function beforeThinkingTask(_context: ThinkingTaskContext, _vm: HookVM): Promise<ThinkingTaskContext | void> {\n  return;\n}\n`,
    objectMethod: `  /** After the plan exists, before subtasks run. AI idea: rewrite subtask descriptions for clarity. */\n  async beforeThinkingTask(_context: ThinkingTaskContext, _vm: HookVM): Promise<ThinkingTaskContext | void> {\n    return;\n  },\n`,
  },
  afterThinkingTask: {
    namedExport: `/** After all thinking-task subtasks complete. AI idea: notify or archive artifacts. */\nexport async function afterThinkingTask(_context: ThinkingTaskContext & { success: boolean }, _vm: HookVM): Promise<void> {\n  return;\n}\n`,
    objectMethod: `  /** After all thinking-task subtasks complete. AI idea: notify or archive artifacts. */\n  async afterThinkingTask(_context: ThinkingTaskContext & { success: boolean }, _vm: HookVM): Promise<void> {\n    return;\n  },\n`,
  },
  beforeReviewTask: {
    namedExport: `/** Before a review task's unresolved threads are processed. AI idea: filter or prioritise threads. */\nexport async function beforeReviewTask(_context: ReviewTaskContext, _vm: HookVM): Promise<ReviewTaskContext | void> {\n  return;\n}\n`,
    objectMethod: `  /** Before a review task's unresolved threads are processed. AI idea: filter or prioritise threads. */\n  async beforeReviewTask(_context: ReviewTaskContext, _vm: HookVM): Promise<ReviewTaskContext | void> {\n    return;\n  },\n`,
  },
  afterReviewTask: {
    namedExport: `/** After a review task's threads have been processed. */\nexport async function afterReviewTask(_context: ReviewTaskContext & { success: boolean; resolvedCount: number }, _vm: HookVM): Promise<void> {\n  return;\n}\n`,
    objectMethod: `  /** After a review task's threads have been processed. */\n  async afterReviewTask(_context: ReviewTaskContext & { success: boolean; resolvedCount: number }, _vm: HookVM): Promise<void> {\n    return;\n  },\n`,
  },
  beforeComment: {
    namedExport: `/** Before a comment is posted. Return modified context to change the text; throw to suppress. */\nexport async function beforeComment(_context: CommentContext, _vm: HookVM): Promise<CommentContext | void> {\n  return;\n}\n`,
    objectMethod: `  /** Before a comment is posted. Return modified context to change the text; throw to suppress. */\n  async beforeComment(_context: CommentContext, _vm: HookVM): Promise<CommentContext | void> {\n    return;\n  },\n`,
  },
  afterComment: {
    namedExport: `/** After a comment has been posted. AI idea: append a signature or log the event. */\nexport async function afterComment(_context: CommentContext, _vm: HookVM): Promise<void> {\n  return;\n}\n`,
    objectMethod: `  /** After a comment has been posted. AI idea: append a signature or log the event. */\n  async afterComment(_context: CommentContext, _vm: HookVM): Promise<void> {\n    return;\n  },\n`,
  },
};

/**
 * Scans an existing hooks file and appends stubs for any missing hook names.
 * Handles both named-export style (`export function hookName`) and
 * object-export style (`export default { hookName() {...} }`).
 * Returns the updated content and the list of hook names that were added.
 */
export function updateHooksFile(existing: string): { content: string; added: string[] } {
  const missing = HOOK_NAMES.filter((name) => !isHookPresent(existing, name));

  if (missing.length === 0) {
    return { content: existing, added: [] };
  }

  const style = detectExportStyle(existing);
  let content = existing;

  if (style === 'named') {
    const stubs = missing.map((name) => HOOK_STUBS[name]!.namedExport).join('\n');
    const separator = content.endsWith('\n') ? '\n' : '\n\n';
    content = content + separator + stubs;
  } else {
    // Object-export style: insert stubs before the last closing brace
    const stubs = missing.map((name) => HOOK_STUBS[name]!.objectMethod).join('\n');
    const lastBrace = content.lastIndexOf('}');
    if (lastBrace === -1) {
      content = content + '\n' + stubs;
    } else {
      content =
        content.slice(0, lastBrace) +
        '\n' + stubs +
        content.slice(lastBrace);
    }
  }

  return { content, added: missing };
}

function isHookPresent(content: string, name: string): boolean {
  // Named export: `export function hookName` or `export async function hookName` or `export const hookName`
  const namedPattern = new RegExp(`\\bexport\\s+(?:async\\s+)?function\\s+${name}\\b|\\bexport\\s+const\\s+${name}\\b`);
  if (namedPattern.test(content)) return true;

  // Object property or method shorthand: `hookName(` or `hookName:` or `hookName :`
  const objectPattern = new RegExp(`\\b${name}\\s*[:(]`);
  return objectPattern.test(content);
}

function detectExportStyle(content: string): 'named' | 'object' {
  if (/\bexport\s+(?:async\s+)?function\s+\w/.test(content)) return 'named';
  if (/\bexport\s+const\s+\w+\s*=\s*async/.test(content)) return 'named';
  return 'object';
}

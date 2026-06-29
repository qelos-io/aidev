# Hooks

Set `AIDEV_HOOKS_PATH` in `.env.aidev` to a path relative to the project directory or an absolute path. `aidev init` writes `.aidev/aidev.hooks.ts` and sets `AIDEV_HOOKS_PATH=.aidev/aidev.hooks.ts` by default.

The module should export an object (or `export default`) whose properties are optional async functions. Only known hook names are used; anything else is ignored. If a hook throws, the current operation stops. If a hook returns an object, it replaces the context for that step.

## Hook names

| Hook | When | Context notes |
|---|---|---|
| `beforeRun` / `afterRun` | Start / end of `aidev run` | `afterRun` includes `processed` and `skipped` counts |
| `beforeEachTask` / `afterEachTask` | Around each code task implementation | `prompt`, `branchName`, `task`; `afterEachTask` has `success` |
| `beforeResolveConflicts` / `afterResolveConflicts` | Merge conflict resolution with AI | `conflictFiles`, `prompt`; `afterResolveConflicts` has `resolved` |
| `beforeNonCodeTask` / `afterNonCodeTask` | Non-code tasks | `afterNonCodeTask` includes agent `output` |
| `beforeThinkingTask` / `afterThinkingTask` | Thinking-tag tasks (subtask plan) | `beforeThinkingTask` may adjust `subtasks` before steps run |
| `beforeReviewTask` / `afterReviewTask` | Review tasks with unresolved PR comments | `threads`, `prompt`, `branchName`; `afterReviewTask` has `success`, `resolvedCount` |

## Second argument: `vm`

Each hook receives `(context, vm)`. The `vm` object exposes:

- `runAI(prompt)` — runs the first available configured AI agent
- `postComment(taskId, text)`, `updateStatus(taskId, status)`, `getComments(taskId)` — task provider operations
- `log.info` / `log.warn` / `log.error` — prefixed hook logging

## TypeScript hooks

`.ts` hook files are loaded at runtime via [jiti](https://www.npmjs.com/package/jiti) — no TypeScript compiler or toolchain needed.

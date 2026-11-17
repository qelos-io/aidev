import type { Config, Task } from './types';

/**
 * Decide whether a task should run inside a git worktree.
 * Precedence: CLI flag (`--worktree` / `--no-worktree`), then the task's worktree tag
 * (case-insensitive), then the `AIDEV_WORKTREE` env setting.
 */
export function shouldUseWorktree(
  config: Pick<Config, 'useWorktree' | 'worktreeTag' | 'worktreeOverride'>,
  task?: Pick<Task, 'tags'> | null,
): boolean {
  if (config.worktreeOverride !== undefined) return config.worktreeOverride;
  const want = (config.worktreeTag || '').trim().toLowerCase();
  if (want && (task?.tags ?? []).some((t) => String(t).trim().toLowerCase() === want)) return true;
  return !!config.useWorktree;
}

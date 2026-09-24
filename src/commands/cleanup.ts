import { Config } from '../types';
import { TaskProvider } from '../providers';
import * as git from '../git';
import { logger } from '../logger';
import { readLastCleanupAt, writeLastCleanupAt, shouldRunWeeklyCleanup } from '../cleanupState';

export interface CleanupSummary {
  branchesDeleted: string[];
  stashesCleared: number;
}

/**
 * Deletes local branches whose leading `<taskId>/…` segment (see the
 * `${task.id}/${slugify(task.name)}` convention in run.ts) does not match any
 * currently active (non-closed) task, so finished/abandoned task branches
 * don't accumulate forever. Never touches remote branches — this is local
 * housekeeping only.
 */
export async function weeklyCleanupCommand(config: Config, provider: TaskProvider): Promise<CleanupSummary | null> {
  logger.info('Running weekly cleanup...');

  let activeTaskIds: Set<string>;
  try {
    // fetchBoardTasks covers all active statuses (open/pending/in progress/in
    // review); fetchTasks only returns open/pending for some providers, which
    // would wrongly delete branches for in-review and in-progress tasks.
    const activeTasks = provider.fetchBoardTasks
      ? await provider.fetchBoardTasks({ skipAttachments: true, omitDescription: true })
      : await provider.fetchTasks();
    activeTaskIds = new Set(activeTasks.map((t) => t.id));
  } catch (err) {
    logger.warn(
      `Weekly cleanup: failed to fetch active tasks (${err instanceof Error ? err.message : err}) — skipping to avoid deleting in-progress work`
    );
    return null;
  }

  // Move off any branch we might delete before pruning, and bring the base branch up to date.
  if (!git.fetchAndCheckout(config.gitRemote, config.githubBaseBranch)) {
    logger.error('Weekly cleanup: failed to checkout and update base branch — aborting cleanup');
    return null;
  }

  const branchesDeleted: string[] = [];
  for (const branch of git.listLocalBranches()) {
    if (branch === config.githubBaseBranch || git.isProtectedBranch(branch)) continue;

    const taskId = branch.split('/')[0];
    if (activeTaskIds.has(taskId)) continue;

    if (git.forceDeleteBranch(branch)) branchesDeleted.push(branch);
  }
  logger.info(`Weekly cleanup: removed ${branchesDeleted.length} stale branch(es)`);

  const stashesCleared = git.stashCount();
  if (stashesCleared > 0 && !git.clearStashes()) {
    logger.warn('Weekly cleanup: failed to clear stashes');
  } else if (stashesCleared > 0) {
    logger.info(`Weekly cleanup: cleared ${stashesCleared} stash(es)`);
  }

  logger.success('Weekly cleanup complete');
  return { branchesDeleted, stashesCleared };
}

/**
 * Runs the weekly cleanup at most once per week, on the first `aidev run`
 * that lands on a Monday. State lives in the gitignored `.aidev/last-cleanup.json`
 * so no separate OS-level cron entry is needed — this piggybacks on however
 * often the user already has `aidev run` scheduled.
 */
export async function maybeRunWeeklyCleanup(config: Config, provider: TaskProvider): Promise<void> {
  const lastCleanupAt = readLastCleanupAt();
  if (!shouldRunWeeklyCleanup(lastCleanupAt)) return;

  const result = await weeklyCleanupCommand(config, provider);
  if (result) writeLastCleanupAt(Date.now());
}

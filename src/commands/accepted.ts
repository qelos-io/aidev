import { Comment, Config } from '../types';
import { TaskProvider } from '../providers';
import { logger } from '../logger';
import {
  isGhInstalled,
  isGhAuthenticated,
  mergePullRequest,
  getPullRequestMergeability,
} from '../github';
import * as git from '../git';
import { getInReviewStatus } from './run';

const DONE_STATUS_CANDIDATES = ['done', 'closed', 'finish', 'success', 'prod'];

/**
 * Stable phrase embedded in the conflict comment so we can detect a previously
 * posted notice on later cron ticks and avoid spamming the ticket. Changing
 * this phrase will cause one duplicate notice on tickets that already received
 * a notice from a previous version.
 */
export const ACCEPTED_CONFLICT_MARKER = 'has merge conflicts and cannot be auto-merged';

/**
 * Comment posted on the task immediately before merging an accepted PR (so the
 * ticket records that aidev is performing the merge).
 */
export function buildAcceptedMergeComment(config: Config, branchName: string): string {
  return `${config.commentPrefix} Merging the accepted pull request for branch \`${branchName}\`.`;
}

/**
 * One-time notice posted when an accepted PR cannot be merged because of
 * conflicts. Phrased so {@link hasAlreadyNotifiedConflict} can detect it on
 * later runs.
 */
export function buildAcceptedConflictComment(
  config: Config,
  branchName: string,
  baseBranch: string,
): string {
  return (
    `${config.commentPrefix} Cannot merge accepted pull request for branch \`${branchName}\` — ` +
    `the PR ${ACCEPTED_CONFLICT_MARKER} with \`${baseBranch}\`. Resolve the conflicts ` +
    `(or retrigger the task to let aidev attempt resolution) before this can be merged.`
  );
}

export function hasAlreadyNotifiedConflict(
  comments: Comment[],
  commentPrefix: string,
): boolean {
  return comments.some(
    (c) => c.text.startsWith(commentPrefix) && c.text.includes(ACCEPTED_CONFLICT_MARKER),
  );
}

/**
 * Pick the configured done status, otherwise probe the board for one of the
 * common "done" names (done / closed / finish / success / prod). Returns null
 * when nothing matches and no override was given.
 */
export async function resolveDoneStatus(
  config: Config,
  provider: TaskProvider,
): Promise<string | null> {
  if (config.doneStatus) return config.doneStatus;
  if (!provider.fetchAvailableStatuses) return null;

  let statuses: string[];
  try {
    statuses = await provider.fetchAvailableStatuses();
  } catch (err) {
    logger.debug(
      `Could not fetch available statuses to auto-detect DONE_STATUS: ${err instanceof Error ? err.message : String(err)}`,
    );
    return null;
  }

  const byLower = new Map(statuses.map((s) => [s.toLowerCase(), s]));
  for (const candidate of DONE_STATUS_CANDIDATES) {
    const match = byLower.get(candidate);
    if (match) return match;
  }
  return null;
}

/**
 * Process "accepted" tasks: find tasks in review status with the accepted tag,
 * post a short merge notice on each ticket, merge their PRs via gh CLI (squash +
 * delete branch), update status to done, then checkout main and pull.
 */
export async function acceptedCommand(
  config: Config,
  provider: TaskProvider,
): Promise<void> {
  if (!config.acceptedTag) {
    logger.warn('ACCEPTED_TAG is not configured. Run "aidev init" to set it up.');
    return;
  }

  if (!isGhInstalled()) {
    logger.warn('gh CLI is not installed. Install it from https://cli.github.com/');
    return;
  }

  if (!isGhAuthenticated()) {
    logger.warn('gh CLI is not authenticated. Run "gh auth login" first.');
    return;
  }

  const reviewStatus = getInReviewStatus(config);
  logger.info(`Fetching tasks in "${reviewStatus}" status...`);

  const tasks = await provider.fetchTasksByStatus([reviewStatus]);
  const acceptedTag = config.acceptedTag.toLowerCase();
  const acceptedTasks = tasks.filter((t) =>
    t.tags.some((tag) => tag.toLowerCase() === acceptedTag)
  );

  if (acceptedTasks.length === 0) {
    logger.info('No accepted tasks found.');
    return;
  }

  logger.info(`Found ${acceptedTasks.length} accepted task(s)`);

  const doneStatus = await resolveDoneStatus(config, provider);
  if (!config.doneStatus) {
    if (doneStatus) {
      logger.info(`DONE_STATUS not configured — using detected status "${doneStatus}"`);
    } else {
      logger.warn(
        `DONE_STATUS not configured and no matching status (${DONE_STATUS_CANDIDATES.join(', ')}) found on the board — task status will not be updated after merge.`,
      );
    }
  }

  let merged = 0;
  for (const task of acceptedTasks) {
    const branchName = `${task.id}/${git.slugify(task.name)}`;
    logger.task(`[${task.id}] "${task.name}" — merging branch ${branchName}`);

    const mergeability = getPullRequestMergeability(branchName);
    if (mergeability === 'CONFLICTING') {
      let existingComments: Comment[] = [];
      try {
        existingComments = await provider.getComments(task.id);
      } catch (err) {
        logger.warn(
          `[${task.id}] Failed to fetch comments to check for prior conflict notice: ${err instanceof Error ? err.message : String(err)}`,
        );
      }

      if (hasAlreadyNotifiedConflict(existingComments, config.commentPrefix)) {
        logger.info(
          `[${task.id}] Skipping — PR has merge conflicts and the ticket was already notified.`,
        );
        continue;
      }

      try {
        await provider.postComment(
          task.id,
          buildAcceptedConflictComment(config, branchName, config.githubBaseBranch),
        );
        logger.warn(
          `[${task.id}] PR has merge conflicts with ${config.githubBaseBranch} — posted notice and skipping.`,
        );
      } catch (err) {
        logger.warn(
          `[${task.id}] Failed to post conflict notice: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      continue;
    }

    try {
      await provider.postComment(task.id, buildAcceptedMergeComment(config, branchName));
    } catch (err) {
      logger.warn(
        `[${task.id}] Failed to post merge notice: ${err instanceof Error ? err.message : String(err)}`,
      );
      continue;
    }

    const result = mergePullRequest(branchName);
    if (!result.success) {
      logger.error(`[${task.id}] Failed to merge PR: ${result.error}`);
      continue;
    }

    logger.success(`[${task.id}] PR merged successfully`);

    if (doneStatus) {
      try {
        await provider.updateStatus(task.id, doneStatus);
        logger.info(`[${task.id}] Status updated to "${doneStatus}"`);
      } catch (err) {
        logger.warn(`[${task.id}] Failed to update status: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    merged++;
  }

  if (merged > 0) {
    logger.info(`Checking out ${config.githubBaseBranch} and pulling latest...`);
    const ok = git.fetchAndCheckout(config.gitRemote, config.githubBaseBranch);
    if (!ok) {
      logger.error(`Failed to checkout ${config.githubBaseBranch}`);
    }
  }

  logger.success(`Done. Merged: ${merged}/${acceptedTasks.length}`);
}

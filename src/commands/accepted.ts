import { Config } from '../types';
import { TaskProvider } from '../providers';
import { logger } from '../logger';
import { isGhInstalled, isGhAuthenticated, mergePullRequest } from '../github';
import * as git from '../git';
import { getInReviewStatus } from './run';

/**
 * Comment posted on the task immediately before merging an accepted PR (so the
 * ticket records that aidev is performing the merge).
 */
export function buildAcceptedMergeComment(config: Config, branchName: string): string {
  return `${config.commentPrefix} Merging the accepted pull request for branch \`${branchName}\`.`;
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

  let merged = 0;
  for (const task of acceptedTasks) {
    const branchName = `${task.id}/${git.slugify(task.name)}`;
    logger.task(`[${task.id}] "${task.name}" — merging branch ${branchName}`);

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

    if (config.doneStatus) {
      try {
        await provider.updateStatus(task.id, config.doneStatus);
        logger.info(`[${task.id}] Status updated to "${config.doneStatus}"`);
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

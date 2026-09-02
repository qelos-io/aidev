import { Config, Task } from '../types';
import { TaskProvider } from '../providers';
import { AIRunner } from '../ai';
import { logger } from '../logger';
import {
  isGhInstalled,
  isGhAuthenticated,
  getPrNumberForBranch,
  fetchPrDiff,
  getPrHeadSha,
  postAgentPullRequestReview,
  PostAgentReviewResult,
} from '../github';
import * as git from '../git';
import { getInReviewStatus } from './run';
import { composeAgentReviewPrompt, parseAgentReviewResponse } from '../prompts/agentReview';
import type { AgentReviewComment } from '../prompts/agentReview';
import { resolveSkillContent } from '../skills';
import { collectSecrets, sanitizeTaskForSafeMode } from '../safeMode';

function applySafeMode(task: Task, context: string, config: Config): { task: Task; context: string } {
  if (!config.safeMode) return { task, context };
  const secrets = collectSecrets();
  const sanitized = sanitizeTaskForSafeMode(task, context, secrets);
  return { task: { ...task, ...sanitized.task }, context: sanitized.context };
}

function parseGithubRepo(githubRepo: string): { owner: string; repo: string } | null {
  const parts = githubRepo.split('/');
  if (parts.length !== 2 || !parts[0]?.trim() || !parts[1]?.trim()) return null;
  return { owner: parts[0].trim(), repo: parts[1].trim() };
}

function buildPrUrl(owner: string, repo: string, prNumber: number): string {
  return `https://github.com/${owner}/${repo}/pull/${prNumber}`;
}

/**
 * Comment posted on the task before the automated PR review starts so the user
 * can remove the agent-review tag if they want to skip this run.
 */
export function buildAgentReviewStartComment(config: Config, branchName: string): string {
  return (
    `${config.commentPrefix} Starting automated code review for pull request on branch \`${branchName}\`.`
  );
}

/** Comment posted after a successful automated review (including a clean review with zero findings). */
export function buildAgentReviewCompletionComment(
  config: Config,
  branchName: string,
  commentCount: number,
): string {
  if (commentCount === 0) {
    return (
      `${config.commentPrefix} Automated code review completed for branch \`${branchName}\` — no issues found.`
    );
  }
  return (
    `${config.commentPrefix} Automated code review completed for branch \`${branchName}\` — ` +
    `posted ${commentCount} comment(s) on the pull request.`
  );
}

/** Comment posted when automated review fails (AI, parse, or gh error). */
export function buildAgentReviewFailureComment(
  config: Config,
  branchName: string,
  reason: string,
): string {
  const trimmed = reason.trim() || 'no error message reported';
  return (
    `${config.commentPrefix} Automated code review failed for branch \`${branchName}\`.\n\n` +
    `Reason:\n\`\`\`\n${trimmed}\n\`\`\``
  );
}

function buildReviewSummary(config: Config, commentCount: number): string {
  if (commentCount === 0) {
    return `${config.commentPrefix} Automated review — no issues found.`;
  }
  return `${config.commentPrefix} Automated review — ${commentCount} issue(s) found.`;
}

export interface AgentReviewDeps {
  isGhInstalled: () => boolean;
  isGhAuthenticated: () => boolean;
  getPrNumberForBranch: (branch: string) => number | null;
  fetchPrDiff: (branch: string) => { diff: string; error: string };
  getPrHeadSha: (branch: string) => string | null;
  postAgentPullRequestReview: (options: {
    owner: string;
    repo: string;
    prNumber: number;
    headSha: string;
    comments: AgentReviewComment[];
    summary: string;
  }) => PostAgentReviewResult;
  resolveSkillContent: (skillName: string) => string | null;
}

const defaultAgentReviewDeps: AgentReviewDeps = {
  isGhInstalled,
  isGhAuthenticated,
  getPrNumberForBranch,
  fetchPrDiff,
  getPrHeadSha,
  postAgentPullRequestReview,
  resolveSkillContent,
};

/**
 * Process in-review tasks tagged for agent review: fetch the PR diff via gh,
 * run an AI review, post comments on GitHub, and remove the tag on success.
 */
export async function agentReviewCommand(
  config: Config,
  provider: TaskProvider,
  runners: AIRunner[],
  screenAvailable = true,
  deps: AgentReviewDeps = defaultAgentReviewDeps,
): Promise<void> {
  if (!config.agentReviewTag) {
    logger.warn('AGENT_REVIEW_TAG is not configured. Run "aidev init" to set it up.');
    return;
  }

  if (!config.githubRepo) {
    logger.warn('GITHUB_REPO is not configured — agent review requires owner/repo.');
    return;
  }

  const repoParts = parseGithubRepo(config.githubRepo);
  if (!repoParts) {
    logger.warn(`GITHUB_REPO must be owner/repo (got "${config.githubRepo}")`);
    return;
  }

  if (!deps.isGhInstalled()) {
    logger.warn('gh CLI is not installed. Install it from https://cli.github.com/');
    return;
  }

  if (!deps.isGhAuthenticated()) {
    logger.warn('gh CLI is not authenticated. Run "gh auth login" first.');
    return;
  }

  const reviewStatus = getInReviewStatus(config);
  logger.info(`Fetching tasks in "${reviewStatus}" status for agent review...`);

  const tasks = await provider.fetchTasksByStatus([reviewStatus]);
  const reviewTag = config.agentReviewTag.toLowerCase();
  const reviewTasks = tasks.filter((t) =>
    t.tags.some((tag) => tag.toLowerCase() === reviewTag),
  );

  if (reviewTasks.length === 0) {
    logger.info('No agent-review tasks found.');
    return;
  }

  logger.info(`Found ${reviewTasks.length} agent-review task(s)`);

  let reviewed = 0;
  for (const task of reviewTasks) {
    const branchName = `${task.id}/${git.slugify(task.name)}`;
    logger.task(`[${task.id}] "${task.name}" — agent review for branch ${branchName}`);

    const prNumber = deps.getPrNumberForBranch(branchName);
    if (prNumber === null) {
      logger.debug(`[${task.id}] No open pull request for branch ${branchName} — skipping`);
      continue;
    }

    const prUrl = buildPrUrl(repoParts.owner, repoParts.repo, prNumber);
    const { diff, error: diffError } = deps.fetchPrDiff(branchName);
    if (diffError) {
      logger.error(`[${task.id}] Failed to fetch PR diff: ${diffError}`);
      try {
        await provider.postComment(
          task.id,
          buildAgentReviewFailureComment(config, branchName, diffError),
        );
      } catch (err) {
        logger.warn(
          `[${task.id}] Failed to post diff-failure notice: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      continue;
    }

    try {
      await provider.postComment(task.id, buildAgentReviewStartComment(config, branchName));
    } catch (err) {
      logger.warn(
        `[${task.id}] Failed to post review-start notice: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    const { task: safeTask } = applySafeMode(task, '', config);
    const skillContent = deps.resolveSkillContent('aidev-review');
    let reviewPrompt = composeAgentReviewPrompt(safeTask, diff, prUrl, skillContent);

    if (!screenAvailable) {
      logger.info(`[${task.id}] Skipping agent review — screen not available`);
      continue;
    }

    let success = false;
    let agentOutput = '';
    let previousNotes = '';

    for (const runner of runners) {
      if (!runner.isAvailable()) continue;

      logger.info(`[${task.id}] Running ${runner.name} for agent review...`);
      const result = await runner.run(reviewPrompt, previousNotes || undefined);

      if (result.success) {
        success = true;
        agentOutput = result.output;
        break;
      }

      logger.warn(`[${task.id}] ${runner.name} failed — trying next runner`);
      previousNotes = `Previous runner (${runner.name}) output:\n${result.output}\nErrors:\n${result.error}`;
    }

    if (!success) {
      logger.error(`[${task.id}] All AI runners failed for agent review`);
      try {
        await provider.postComment(
          task.id,
          buildAgentReviewFailureComment(config, branchName, 'All configured AI runners failed.'),
        );
      } catch (err) {
        logger.warn(
          `[${task.id}] Failed to post AI-failure notice: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      continue;
    }

    const comments = parseAgentReviewResponse(agentOutput);
    if (comments === null) {
      logger.error(`[${task.id}] Failed to parse agent review output`);
      try {
        await provider.postComment(
          task.id,
          buildAgentReviewFailureComment(
            config,
            branchName,
            'AI output could not be parsed as a valid JSON review comment array.',
          ),
        );
      } catch (err) {
        logger.warn(
          `[${task.id}] Failed to post parse-failure notice: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      continue;
    }

    const headSha = deps.getPrHeadSha(branchName);
    if (!headSha) {
      logger.error(`[${task.id}] Failed to resolve PR head SHA for ${branchName}`);
      try {
        await provider.postComment(
          task.id,
          buildAgentReviewFailureComment(config, branchName, 'Could not resolve pull request head commit.'),
        );
      } catch (err) {
        logger.warn(
          `[${task.id}] Failed to post head-SHA failure notice: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      continue;
    }

    const ghResult = deps.postAgentPullRequestReview({
      owner: repoParts.owner,
      repo: repoParts.repo,
      prNumber,
      headSha,
      comments,
      summary: buildReviewSummary(config, comments.length),
    });

    if (!ghResult.success) {
      logger.error(`[${task.id}] Failed to post GitHub review: ${ghResult.error}`);
      try {
        await provider.postComment(
          task.id,
          buildAgentReviewFailureComment(config, branchName, ghResult.error),
        );
      } catch (err) {
        logger.warn(
          `[${task.id}] Failed to post gh-failure notice: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      continue;
    }

    logger.success(`[${task.id}] Agent review posted (${ghResult.commentsPosted} inline comment(s))`);

    if (provider.removeTag) {
      try {
        await provider.removeTag(task.id, config.agentReviewTag);
        logger.info(`[${task.id}] Removed agent review tag "${config.agentReviewTag}"`);
      } catch (err) {
        logger.warn(
          `[${task.id}] Failed to remove agent review tag: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    try {
      await provider.postComment(
        task.id,
        buildAgentReviewCompletionComment(config, branchName, ghResult.commentsPosted),
      );
    } catch (err) {
      logger.warn(
        `[${task.id}] Failed to post review-completion notice: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    reviewed++;
  }

  logger.success(`Done. Agent reviews completed: ${reviewed}/${reviewTasks.length}`);
}

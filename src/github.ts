import { spawnSync } from 'node:child_process';
import { commandExists, spawnCommand } from './platform';
import { logger } from './logger';
import type { AgentReviewComment } from './prompts/agentReview';

function gh(
  args: string[],
  input?: string
): { stdout: string; stderr: string; status: number } {
  const result = spawnCommand('gh', args, {
    encoding: 'utf8',
    timeout: 30_000,
    input,
  });
  return {
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    status: result.status ?? 1,
  };
}

function formatGhError(result: { stdout: string; stderr: string; status: number }): string {
  const stderr = result.stderr.trim();
  const stdout = result.stdout.trim();
  const combined = [stderr, stdout].filter(Boolean).join('\n').trim();
  return combined || `gh exited with status ${result.status}`;
}

function git(args: string[]): { stdout: string; stderr: string; status: number } {
  const result = spawnSync('git', args, {
    cwd: process.cwd(),
    encoding: 'utf8',
  });
  return {
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    status: result.status ?? 1,
  };
}

export function isGhInstalled(): boolean {
  return commandExists('gh');
}

export function isGhAuthenticated(): boolean {
  if (!isGhInstalled()) return false;
  const result = gh(['auth', 'status']);
  return result.status === 0;
}

export function getRemoteUrl(remote: string): string {
  const result = git(['remote', 'get-url', remote]);
  if (result.status !== 0) return '';
  return result.stdout.trim();
}

export function isGitHubRemote(remote: string): boolean {
  const url = getRemoteUrl(remote);
  return /github\.com/i.test(url);
}

export interface PullRequestResult {
  success: boolean;
  url: string;
  error: string;
}

export function createPullRequest(
  baseBranch: string,
  headBranch: string,
  title: string,
  body: string
): PullRequestResult {
  logger.debug(`Creating PR: ${headBranch} → ${baseBranch}`);
  const result = gh([
    'pr', 'create',
    '--base', baseBranch,
    '--head', headBranch,
    '--title', title,
    '--body', body,
  ]);

  if (result.status !== 0) {
    logger.warn(`gh pr create failed: ${result.stderr.trim()}`);
    return { success: false, url: '', error: result.stderr.trim() };
  }

  const url = result.stdout.trim();
  logger.info(`PR created: ${url}`);
  return { success: true, url, error: '' };
}

// ─── PR review thread operations ─────────────────────────────────────────────

export interface ReviewThread {
  id: string;
  path: string;
  line: number | null;
  comments: Array<{ body: string; author: string }>;
}

interface GhPrViewResult {
  number: number;
}

interface GhReviewCommentNode {
  body: string;
  author: { login: string } | null;
}

interface GhReviewThreadNode {
  id: string;
  isResolved: boolean;
  path: string;
  line: number | null;
  comments: { nodes: GhReviewCommentNode[] };
}

interface GhGraphQLReviewResponse {
  data: {
    repository: {
      pullRequest: {
        reviewThreads: { nodes: GhReviewThreadNode[] };
      };
    };
  };
}

export function getPrNumberForBranch(branch: string): number | null {
  const result = gh(['pr', 'view', branch, '--json', 'number']);
  if (result.status !== 0) return null;
  try {
    const parsed = JSON.parse(result.stdout) as GhPrViewResult;
    return parsed.number ?? null;
  } catch {
    return null;
  }
}

export function fetchUnresolvedReviewThreads(
  owner: string,
  repo: string,
  prNumber: number
): ReviewThread[] {
  const query = `query($owner: String!, $repo: String!, $prNumber: Int!) {
    repository(owner: $owner, name: $repo) {
      pullRequest(number: $prNumber) {
        reviewThreads(first: 100) {
          nodes {
            id
            isResolved
            path
            line
            comments(first: 50) {
              nodes {
                body
                author { login }
              }
            }
          }
        }
      }
    }
  }`;

  const result = gh([
    'api', 'graphql',
    '-f', `query=${query}`,
    '-F', `owner=${owner}`,
    '-F', `repo=${repo}`,
    '-F', `prNumber=${prNumber}`,
  ]);

  if (result.status !== 0) {
    logger.warn(`Failed to fetch review threads: ${result.stderr.trim()}`);
    return [];
  }

  try {
    const response = JSON.parse(result.stdout) as GhGraphQLReviewResponse;
    const threads = response.data.repository.pullRequest.reviewThreads.nodes;
    return threads
      .filter((t) => !t.isResolved)
      .map((t) => ({
        id: t.id,
        path: t.path,
        line: t.line,
        comments: t.comments.nodes.map((c) => ({
          body: c.body,
          author: c.author?.login ?? 'unknown',
        })),
      }));
  } catch (err) {
    logger.warn(`Failed to parse review threads: ${err}`);
    return [];
  }
}

export interface MergeResult {
  success: boolean;
  error: string;
}

export type PrMergeability = 'MERGEABLE' | 'CONFLICTING' | 'UNKNOWN';

/**
 * Returns the GitHub-reported mergeability of the PR for the given branch.
 * `UNKNOWN` covers both transient unknown states (GitHub still computing) and
 * the case where no PR is found / gh fails — callers must treat UNKNOWN as
 * "do not assume it can merge".
 */
export function getPullRequestMergeability(branch: string): PrMergeability {
  const result = gh(['pr', 'view', branch, '--json', 'mergeable']);
  if (result.status !== 0) return 'UNKNOWN';
  try {
    const parsed = JSON.parse(result.stdout) as { mergeable?: string };
    const value = (parsed.mergeable || '').toUpperCase();
    if (value === 'MERGEABLE') return 'MERGEABLE';
    if (value === 'CONFLICTING') return 'CONFLICTING';
    return 'UNKNOWN';
  } catch {
    return 'UNKNOWN';
  }
}

export function mergePullRequest(branch: string): MergeResult {
  logger.debug(`Merging PR for branch: ${branch} (squash + delete branch)`);
  const result = gh([
    'pr', 'merge', branch,
    '--squash',
    '--delete-branch',
  ]);

  if (result.status !== 0) {
    // gh writes user-facing failure text to either stderr (most cases) or
    // stdout (e.g. "Pull request is not mergeable: ..."). Combine both so
    // callers always get something descriptive instead of an empty string.
    const stderr = result.stderr.trim();
    const stdout = result.stdout.trim();
    const combined = [stderr, stdout].filter(Boolean).join('\n').trim();
    const error = combined || `gh pr merge exited with status ${result.status}`;
    return { success: false, error };
  }

  return { success: true, error: '' };
}

export function replyToReviewThread(threadId: string, body: string): boolean {
  const mutation = `mutation($threadId: ID!, $body: String!) {
    addPullRequestReviewThreadReply(input: { pullRequestReviewThreadId: $threadId, body: $body }) {
      comment { id }
    }
  }`;

  const result = gh([
    'api', 'graphql',
    '-f', `query=${mutation}`,
    '-F', `threadId=${threadId}`,
    '-F', `body=${body}`,
  ]);

  if (result.status !== 0) {
    logger.debug(`Failed to reply to thread ${threadId}: ${result.stderr.trim()}`);
    return false;
  }
  return true;
}

export function filterUnresolvedByNonAidev(
  threads: ReviewThread[],
  commentPrefix: string
): ReviewThread[] {
  return threads.filter((thread) => {
    if (thread.comments.length === 0) return true;
    const lastComment = thread.comments[thread.comments.length - 1];
    return !lastComment.body.startsWith(commentPrefix);
  });
}

export function resolveReviewThread(threadId: string): boolean {
  const mutation = `mutation($threadId: ID!) {
    resolveReviewThread(input: { threadId: $threadId }) {
      thread { isResolved }
    }
  }`;

  const result = gh([
    'api', 'graphql',
    '-f', `query=${mutation}`,
    '-F', `threadId=${threadId}`,
  ]);

  if (result.status !== 0) {
    logger.debug(`Failed to resolve thread ${threadId}: ${result.stderr.trim()}`);
    return false;
  }
  return true;
}

// ─── PR diff and agent review ─────────────────────────────────────────────────

export type { AgentReviewComment } from './prompts/agentReview';

export function fetchPrDiff(branch: string): { diff: string; error: string } {
  const result = gh(['pr', 'diff', branch]);
  if (result.status !== 0) {
    return { diff: '', error: formatGhError(result) };
  }
  return { diff: result.stdout, error: '' };
}

interface GhPrHeadResult {
  headRefOid: string;
}

export function getPrHeadSha(branch: string): string | null {
  const result = gh(['pr', 'view', branch, '--json', 'headRefOid']);
  if (result.status !== 0) return null;
  try {
    const parsed = JSON.parse(result.stdout) as GhPrHeadResult;
    return parsed.headRefOid ?? null;
  } catch {
    return null;
  }
}

export interface AgentReviewApiComment {
  path: string;
  line: number;
  body: string;
  side: 'RIGHT';
}

export interface AgentReviewPayload {
  commit_id: string;
  body: string;
  event: 'APPROVE' | 'COMMENT';
  comments?: AgentReviewApiComment[];
}

export function buildAgentReviewPayload(options: {
  headSha: string;
  comments: AgentReviewComment[];
  summary: string;
}): AgentReviewPayload {
  if (options.comments.length === 0) {
    return {
      commit_id: options.headSha,
      body: options.summary,
      event: 'APPROVE',
    };
  }

  return {
    commit_id: options.headSha,
    body: options.summary,
    event: 'COMMENT',
    comments: options.comments.map((comment) => ({
      path: comment.path,
      line: comment.line,
      body: comment.body,
      side: 'RIGHT',
    })),
  };
}

export interface PostAgentReviewResult {
  success: boolean;
  error: string;
  commentsPosted: number;
}

export function postAgentPullRequestReview(options: {
  owner: string;
  repo: string;
  prNumber: number;
  headSha: string;
  comments: AgentReviewComment[];
  summary: string;
}): PostAgentReviewResult {
  const payload = buildAgentReviewPayload({
    headSha: options.headSha,
    comments: options.comments,
    summary: options.summary,
  });

  const endpoint = `repos/${options.owner}/${options.repo}/pulls/${options.prNumber}/reviews`;
  const result = gh(['api', endpoint, '--input', '-'], JSON.stringify(payload));

  if (result.status !== 0) {
    return {
      success: false,
      error: formatGhError(result),
      commentsPosted: 0,
    };
  }

  return {
    success: true,
    error: '',
    commentsPosted: options.comments.length,
  };
}

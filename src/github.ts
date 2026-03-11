import { spawnSync } from 'node:child_process';
import { commandExists, spawnCommand } from './platform';
import { logger } from './logger';

function gh(args: string[]): { stdout: string; stderr: string; status: number } {
  const result = spawnCommand('gh', args, {
    encoding: 'utf8',
    timeout: 30_000,
  });
  return {
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    status: result.status ?? 1,
  };
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

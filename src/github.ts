import { spawnSync } from 'node:child_process';
import { commandExists } from './platform';
import { logger } from './logger';

function gh(args: string[]): { stdout: string; stderr: string; status: number } {
  const result = spawnSync('gh', args, {
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

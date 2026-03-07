import { spawnSync } from 'node:child_process';
import { logger } from './logger';

function git(args: string[], cwd?: string): { stdout: string; stderr: string; status: number } {
  const result = spawnSync('git', args, {
    cwd: cwd || process.cwd(),
    encoding: 'utf8',
  });
  return {
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    status: result.status ?? 1,
  };
}

export function remoteBranchExists(remote: string, branch: string): boolean {
  const result = git(['ls-remote', '--heads', remote, branch]);
  return result.status === 0 && result.stdout.trim().length > 0;
}

export function fetchAndCheckout(remote: string, baseBranch: string): boolean {
  logger.debug(`git fetch ${remote}`);
  const fetch = git(['fetch', remote]);
  if (fetch.status !== 0) {
    logger.error(`git fetch failed: ${fetch.stderr}`);
    return false;
  }

  logger.debug(`git checkout ${baseBranch}`);
  const checkout = git(['checkout', baseBranch]);
  if (checkout.status !== 0) {
    logger.error(`git checkout ${baseBranch} failed: ${checkout.stderr}`);
    return false;
  }

  logger.debug(`git pull ${remote} ${baseBranch}`);
  const pull = git(['pull', remote, baseBranch]);
  if (pull.status !== 0) {
    logger.error(`git pull failed: ${pull.stderr}`);
    return false;
  }

  return true;
}

export function fetchAndCheckoutBranch(remote: string, branch: string): boolean {
  logger.debug(`git fetch ${remote}`);
  const fetchResult = git(['fetch', remote]);
  if (fetchResult.status !== 0) {
    logger.error(`git fetch failed: ${fetchResult.stderr}`);
    return false;
  }

  logger.debug(`git checkout ${branch}`);
  const checkout = git(['checkout', branch]);
  if (checkout.status === 0) {
    logger.debug(`git pull ${remote} ${branch}`);
    const pull = git(['pull', remote, branch]);
    if (pull.status !== 0) {
      logger.warn(`git pull failed: ${pull.stderr} — continuing with local state`);
    }
    return true;
  }

  logger.debug(`git checkout --track ${remote}/${branch}`);
  const track = git(['checkout', '--track', `${remote}/${branch}`]);
  if (track.status !== 0) {
    logger.error(`git checkout --track failed: ${track.stderr}`);
    return false;
  }
  return true;
}

export function createBranch(branch: string): boolean {
  logger.debug(`git checkout -b ${branch}`);
  const result = git(['checkout', '-b', branch]);
  if (result.status !== 0) {
    logger.error(`git checkout -b ${branch} failed: ${result.stderr}`);
    return false;
  }
  return true;
}

export function hasChanges(): boolean {
  const result = git(['status', '--porcelain']);
  return result.status === 0 && result.stdout.trim().length > 0;
}

export function addAll(): boolean {
  const result = git(['add', '-A']);
  return result.status === 0;
}

export function commit(message: string): boolean {
  logger.debug(`git commit -m "${message}"`);
  const result = git(['commit', '-m', message]);
  if (result.status !== 0) {
    logger.error(`git commit failed: ${result.stderr}`);
    return false;
  }
  return true;
}

export function push(remote: string, branch: string): boolean {
  logger.debug(`git push ${remote} ${branch}`);
  const result = git(['push', remote, branch]);
  if (result.status !== 0) {
    logger.error(`git push failed: ${result.stderr}`);
    return false;
  }
  return true;
}

export function deleteBranch(branch: string): void {
  git(['checkout', '-']);
  git(['branch', '-D', branch]);
}

/** Returns the name of the first usable remote (prefers origin). */
export function detectRemote(): string | null {
  // Verify origin exists first
  const originCheck = git(['remote', 'get-url', 'origin']);
  if (originCheck.status === 0) return 'origin';

  // Fall back to first listed remote
  const list = git(['remote']);
  const first = list.stdout.trim().split('\n')[0]?.trim();
  return first || null;
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 50);
}

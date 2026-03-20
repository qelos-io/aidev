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

const PROTECTED_BRANCHES = new Set(['main', 'master', 'develop', 'production']);

export function isProtectedBranch(branch: string): boolean {
  return PROTECTED_BRANCHES.has(branch.toLowerCase());
}

export function getCurrentBranch(): string | null {
  const result = git(['rev-parse', '--abbrev-ref', 'HEAD']);
  if (result.status !== 0) return null;
  return result.stdout.trim() || null;
}

export function remoteBranchExists(remote: string, branch: string): boolean {
  const result = git(['ls-remote', '--heads', remote, branch]);
  return result.status === 0 && result.stdout.trim().length > 0;
}

export function stashChanges(): boolean {
  if (!hasChanges()) return true;
  logger.debug('git stash push -u -m aidev-autostash');
  const result = git(['stash', 'push', '-u', '-m', 'aidev-autostash']);
  if (result.status !== 0) {
    logger.warn(`git stash failed: ${result.stderr}`);
    return false;
  }
  return true;
}

export function fetchAndCheckout(remote: string, baseBranch: string): boolean {
  stashChanges();

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

  const localRev = git(['rev-parse', 'HEAD']);
  const remoteRev = git(['rev-parse', `${remote}/${baseBranch}`]);
  if (localRev.status === 0 && remoteRev.status === 0 &&
      localRev.stdout.trim() !== remoteRev.stdout.trim()) {
    logger.error(
      `Local ${baseBranch} is out of sync with ${remote}/${baseBranch} after pull — ` +
      'local branch may have diverged. Please resolve manually.'
    );
    return false;
  }

  return true;
}

export function fetchAndCheckoutBranch(remote: string, branch: string): boolean {
  stashChanges();

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

export function createBranch(branch: string, expectedBase?: string): boolean {
  if (expectedBase) {
    const current = getCurrentBranch();
    if (current !== expectedBase) {
      logger.error(
        `Cannot create branch "${branch}": expected to be on "${expectedBase}" but currently on "${current}"`
      );
      return false;
    }
  }
  logger.debug(`git checkout -b ${branch}`);
  const result = git(['checkout', '-b', branch]);
  if (result.status !== 0) {
    logger.error(`git checkout -b ${branch} failed: ${result.stderr}`);
    return false;
  }
  return true;
}

/**
 * Creates a new branch based on the latest remote base branch.
 * Stashes any local changes, fetches the remote, then branches directly
 * from the remote tracking ref (e.g. origin/main) — avoiding the need
 * to checkout or sync the local base branch.
 */
export function createBranchFromRemote(remote: string, baseBranch: string, branch: string): boolean {
  stashChanges();

  logger.debug(`git fetch ${remote}`);
  const fetchResult = git(['fetch', remote]);
  if (fetchResult.status !== 0) {
    logger.error(`git fetch failed: ${fetchResult.stderr}`);
    return false;
  }

  const startPoint = `${remote}/${baseBranch}`;
  logger.debug(`git checkout -b ${branch} ${startPoint}`);
  const result = git(['checkout', '-b', branch, startPoint]);
  if (result.status !== 0) {
    logger.error(`git checkout -b ${branch} ${startPoint} failed: ${result.stderr}`);
    return false;
  }
  return true;
}

export function hasChanges(): boolean {
  const result = git(['status', '--porcelain']);
  return result.status === 0 && result.stdout.trim().length > 0;
}

/**
 * Returns true if the current branch has commits ahead of the remote base branch.
 */
export function hasCommitsAhead(remote: string, baseBranch: string): boolean {
  const result = git(['rev-list', '--count', `${remote}/${baseBranch}..HEAD`]);
  if (result.status !== 0) return false;
  const count = parseInt(result.stdout.trim(), 10) || 0;
  return count > 0;
}

export function addAll(): boolean {
  const result = git(['add', '-A']);
  return result.status === 0;
}

export function commit(message: string, expectedBranch?: string): boolean {
  if (expectedBranch) {
    const current = getCurrentBranch();
    if (current !== expectedBranch) {
      logger.error(`Refusing to commit: expected branch "${expectedBranch}" but currently on "${current}"`);
      return false;
    }
    if (isProtectedBranch(current)) {
      logger.error(`Refusing to commit directly to protected branch "${current}"`);
      return false;
    }
  }
  logger.debug(`git commit -m "${message}"`);
  const result = git(['commit', '-m', message]);
  if (result.status !== 0) {
    logger.error(`git commit failed: ${result.stderr}`);
    return false;
  }
  return true;
}

export function push(remote: string, branch: string): boolean {
  const current = getCurrentBranch();
  if (current !== branch) {
    logger.error(`Refusing to push: current branch "${current}" does not match target branch "${branch}"`);
    return false;
  }
  if (isProtectedBranch(branch)) {
    logger.error(`Refusing to push directly to protected branch "${branch}"`);
    return false;
  }
  logger.debug(`git push ${remote} HEAD:refs/heads/${branch}`);
  const result = git(['push', remote, `HEAD:refs/heads/${branch}`]);
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

export interface ConflictCheckResult {
  clean: boolean;
  conflictFiles: string[];
  behindCommits: number;
}

/**
 * Checks whether the current branch can merge cleanly with the remote base
 * branch. Performs a trial merge and aborts it regardless of the outcome.
 */
export function checkConflictsWithBase(remote: string, baseBranch: string): ConflictCheckResult {
  const logResult = git(['rev-list', '--count', `HEAD..${remote}/${baseBranch}`]);
  const behindCommits = logResult.status === 0 ? parseInt(logResult.stdout.trim(), 10) || 0 : 0;

  if (behindCommits === 0) {
    return { clean: true, conflictFiles: [], behindCommits: 0 };
  }

  const merge = git(['merge', '--no-commit', '--no-ff', `${remote}/${baseBranch}`]);

  if (merge.status === 0) {
    git(['merge', '--abort']);
    return { clean: true, conflictFiles: [], behindCommits };
  }

  const diffResult = git(['diff', '--name-only', '--diff-filter=U']);
  const files = diffResult.stdout.trim().split('\n').filter(Boolean);

  git(['merge', '--abort']);
  return { clean: false, conflictFiles: files, behindCommits };
}

/**
 * Starts a real merge of the remote base branch into the current branch.
 * Returns true if the merge completed without conflicts.
 */
export function mergeBaseBranch(remote: string, baseBranch: string): boolean {
  const result = git(['merge', `${remote}/${baseBranch}`, '--no-edit']);
  return result.status === 0;
}

export function abortMerge(): void {
  git(['merge', '--abort']);
}

/**
 * Returns the content of files with conflict markers for AI resolution context.
 */
export function getConflictDetails(): string {
  const diffResult = git(['diff', '--name-only', '--diff-filter=U']);
  const files = diffResult.stdout.trim().split('\n').filter(Boolean);

  const details: string[] = [];
  for (const file of files) {
    const content = git(['show', `:2:${file}`]);
    const theirs = git(['show', `:3:${file}`]);
    details.push(
      `### ${file}\n\n` +
      `**Our version (task branch):**\n\`\`\`\n${content.stdout.slice(0, 3000)}\n\`\`\`\n\n` +
      `**Their version (base branch):**\n\`\`\`\n${theirs.stdout.slice(0, 3000)}\n\`\`\``
    );
  }
  return details.join('\n\n');
}

/** Completes a merge after conflicts have been manually resolved. */
export function commitMerge(message: string): boolean {
  const add = git(['add', '-A']);
  if (add.status !== 0) {
    logger.error(`git add failed during merge resolution: ${add.stderr}`);
    return false;
  }
  const result = git(['commit', '-m', message]);
  if (result.status !== 0) {
    logger.error(`git merge commit failed: ${result.stderr}`);
    return false;
  }
  return true;
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 50);
}

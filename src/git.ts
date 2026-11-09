import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, isAbsolute, posix, resolve } from 'node:path';
import { logger } from './logger';
import { LOCK_FILENAME } from './lockfile';
import { ACTIVE_TASK_FILENAME } from './activeTask';

// aidev writes these bookkeeping files into the repo's working directory
// (process.cwd()) while `aidev run` is active. They are not user changes and
// must not trip the dirty-working-tree check — otherwise every branch
// operation fails while a run is in progress (they're untracked for the
// duration of the run, since repos aren't required to .gitignore them).
const AIDEV_OWN_FILES = new Set([LOCK_FILENAME, ACTIVE_TASK_FILENAME]);

// Untracked files under this directory are aidev's own state (cleanup
// timestamps, sessions, caches, ...). Repos aren't required to gitignore them,
// and untracked files never block a branch checkout, so they must not make the
// working tree look dirty. Tracked-but-modified files there still count.
const AIDEV_STATE_DIR_PREFIX = '.aidev/';

interface GitOptions {
  env?: NodeJS.ProcessEnv;
  timeout?: number;
}

function git(args: string[], cwd?: string, opts?: GitOptions): { stdout: string; stderr: string; status: number } {
  const result = spawnSync('git', args, {
    cwd: cwd || process.cwd(),
    encoding: 'utf8',
    ...(opts?.env ? { env: opts.env } : {}),
    ...(opts?.timeout ? { timeout: opts.timeout } : {}),
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

const WINDOWS_RESERVED_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

/**
 * On Windows, deletes dirty paths whose basename is a reserved device name and
 * returns the remaining paths. Uses the `\\?\` prefix so the Win32 name
 * normalisation doesn't redirect the delete to the device. No-op elsewhere.
 */
function removeWindowsReservedFiles(paths: string[]): string[] {
  if (process.platform !== 'win32') return paths;
  const remaining: string[] = [];
  for (const path of paths) {
    const base = posix.basename(path.replace(/\\/g, '/'));
    if (!WINDOWS_RESERVED_NAME.test(base)) {
      remaining.push(path);
      continue;
    }
    try {
      const abs = resolve(process.cwd(), path);
      rmSync(`\\\\?\\${abs}`, { recursive: true, force: true });
      logger.warn(`Removed Windows-reserved file that git cannot stash: ${path}`);
    } catch (err) {
      logger.warn(`Failed to remove reserved file ${path}: ${err instanceof Error ? err.message : err}`);
      remaining.push(path);
    }
  }
  return remaining;
}

/**
 * Verifies the working tree is clean before a branch-switching operation.
 * Leftovers from failed tasks would otherwise block every later checkout, so
 * a dirty tree is stashed (including untracked files) and the stash entry is
 * dropped immediately — the changes are discarded and no stash accumulates.
 * aidev's own bookkeeping files are excluded. Returns false only if the
 * changes could not be removed.
 */
export function requireCleanWorkingTree(actionDescription: string): boolean {
  if (!hasChanges()) return true;

  const dirtyFiles = listWorkingTreeChanges();
  logger.warn(
    `Working tree has uncommitted changes before ${actionDescription} — discarding them:\n` +
    dirtyFiles.map((file) => `  ${file}`).join('\n')
  );

  // Windows reserved device names (e.g. `nul`, left by agents redirecting to
  // `> nul`) can't be added by git ("invalid path"), so stash would fail on
  // them forever. Delete them directly instead of stashing.
  const stashable = removeWindowsReservedFiles(dirtyFiles);
  if (stashable.length === 0) {
    return !hasChanges();
  }

  const countBefore = stashCount();
  const stash = git(['stash', 'push', '--include-untracked', '--', ...stashable]);
  if (stash.status !== 0) {
    logger.error(`Cannot ${actionDescription}: git stash failed: ${stash.stderr}`);
    return false;
  }

  // "No local changes to save" exits 0 without creating an entry; only drop ours.
  if (stashCount() > countBefore) {
    const drop = git(['stash', 'drop']);
    if (drop.status !== 0) {
      logger.warn(`git stash drop failed: ${drop.stderr}`);
    }
  }

  if (hasChanges()) {
    logger.error(`Cannot ${actionDescription}: working tree is still dirty after stash`);
    return false;
  }
  return true;
}

export function fetchAndCheckout(remote: string, baseBranch: string): boolean {
  if (!requireCleanWorkingTree('fetch and checkout base branch')) return false;

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
  if (!requireCleanWorkingTree(`fetch and checkout branch "${branch}"`)) return false;

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
 * Requires a clean working tree (fails fast otherwise — aidev never
 * stashes), fetches the remote, then branches directly from the remote
 * tracking ref (e.g. origin/main) — avoiding the need to checkout or
 * sync the local base branch.
 */
export function createBranchFromRemote(remote: string, baseBranch: string, branch: string): boolean {
  if (!requireCleanWorkingTree(`create branch "${branch}" from remote`)) return false;

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
    logger.warn(`git checkout -b ${branch} ${startPoint} failed: ${result.stderr} — trying existing branch`);
    return fetchAndCheckoutBranch(remote, branch);
  }
  return true;
}

export function hasChanges(): boolean {
  return listWorkingTreeChanges().length > 0;
}

/** Returns relative paths of files with uncommitted working-tree changes. */
export function listWorkingTreeChanges(): string[] {
  // -uall lists untracked files individually instead of collapsing a whole
  // untracked directory (e.g. `.aidev/`) into one entry.
  const result = git(['status', '--porcelain', '-uall']);
  if (result.status !== 0) return [];

  const paths: string[] = [];
  for (const line of result.stdout.split('\n').filter((entry) => entry.length > 0)) {
    const untracked = line.startsWith('??');
    const pathPart = line.slice(3);
    let path: string;
    if (pathPart.includes(' -> ')) {
      const destination = pathPart.split(' -> ').pop();
      path = destination ? destination.trim() : '';
    } else {
      path = pathPart.trim();
    }
    if (!path || AIDEV_OWN_FILES.has(path)) continue;
    // aidev's skills-source links are never user changes (and must not be
    // stashed/discarded — that would follow or delete the links).
    if (untracked && isAidevSkillsPath(path)) continue;
    if (untracked && path.startsWith(AIDEV_STATE_DIR_PREFIX)) continue;
    paths.push(path);
  }
  return paths;
}

/** Discards uncommitted working tree and untracked files on the current branch. */
export function discardWorkingChanges(): boolean {
  const reset = git(['reset', '--hard', 'HEAD']);
  if (reset.status !== 0) {
    logger.error(`git reset --hard failed: ${reset.stderr}`);
    return false;
  }

  const clean = git(['clean', '-fd']);
  if (clean.status !== 0) {
    logger.warn(`git clean -fd failed: ${clean.stderr}`);
    return false;
  }

  return true;
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

/**
 * Stages everything except aidev's skills-source links. The local exclude is
 * (re)written first so `git add -A` skips them, and anything that still got
 * staged (user already tracks such a path, or the exclude is bypassed) is
 * unstaged afterwards.
 */
export function addAll(): boolean {
  ensureLocalExclude();
  const result = git(['add', '-A']);
  if (result.status !== 0) return false;
  return unstageAidevSkills();
}

// ─── aidev-skills never-commit guard ─────────────────────────────────────────

/** Name of the link/dir aidev creates inside the repo to expose the skills source. */
export const AIDEV_SKILLS_LINK_NAME = 'aidev-skills';

/** True when any segment of the repo-relative path is the aidev-skills link name. */
export function isAidevSkillsPath(relativePath: string): boolean {
  return relativePath.split(/[\\/]+/).includes(AIDEV_SKILLS_LINK_NAME);
}

/**
 * Appends the aidev-skills pattern to `.git/info/exclude` (local only; the
 * user's .gitignore is untouched). Idempotent. A slash-less pattern matches at
 * any depth, for files, directories and symlinks alike.
 */
export function ensureLocalExclude(cwd?: string): boolean {
  const pathResult = git(['rev-parse', '--git-path', 'info/exclude'], cwd);
  if (pathResult.status !== 0) return false;
  const rel = pathResult.stdout.trim();
  if (!rel) return false;
  const excludePath = isAbsolute(rel) ? rel : resolve(cwd || process.cwd(), rel);

  try {
    const existing = existsSync(excludePath) ? readFileSync(excludePath, 'utf8') : '';
    const lines = existing.split(/\r?\n/).map((line) => line.trim());
    if (lines.includes(AIDEV_SKILLS_LINK_NAME)) return true;
    mkdirSync(dirname(excludePath), { recursive: true });
    const prefix = existing.length > 0 && !existing.endsWith('\n') ? '\n' : '';
    appendFileSync(excludePath, `${prefix}${AIDEV_SKILLS_LINK_NAME}\n`);
    return true;
  } catch (err) {
    logger.warn(`Could not update .git/info/exclude: ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
}

/** True when a symlink at `linkPath` (repo-relative, posix) with `target` points outside the repo. */
function symlinkEscapesRepo(linkPath: string, target: string): boolean {
  if (isAbsolute(target) || /^[a-zA-Z]:/.test(target) || target.startsWith('\\\\')) return true;
  const resolved = posix.normalize(posix.join(posix.dirname(linkPath), target.replace(/\\/g, '/')));
  return resolved === '..' || resolved.startsWith('../');
}

/**
 * Unstages (index only; working tree untouched) every staged path that is
 * under an `aidev-skills` name or is a newly staged symlink whose target is
 * outside the repo. Returns false only if unstaging failed.
 */
export function unstageAidevSkills(cwd?: string): boolean {
  const diff = git(['diff', '--cached', '--raw', '-z', '--no-renames'], cwd);
  if (diff.status !== 0) return true;

  // Entries: ":<oldmode> <newmode> <oldsha> <newsha> <status>\0<path>\0"
  const fields = diff.stdout.split('\0');
  const toUnstage: string[] = [];
  for (let i = 0; i + 1 < fields.length; i += 2) {
    const meta = fields[i].replace(/^:/, '').split(' ');
    const path = fields[i + 1];
    if (!path || meta.length < 5) continue;
    const [, newMode, , newSha] = meta;
    if (isAidevSkillsPath(path)) {
      toUnstage.push(path);
    } else if (newMode === '120000') {
      const blob = git(['cat-file', 'blob', newSha], cwd);
      if (blob.status === 0 && symlinkEscapesRepo(path, blob.stdout.trim())) {
        logger.warn(`Not committing symlink pointing outside the repo: ${path}`);
        toUnstage.push(path);
      }
    }
  }
  if (toUnstage.length === 0) return true;

  logger.debug(`git reset -q -- ${toUnstage.join(' ')}`);
  const reset = git(['--literal-pathspecs', 'reset', '-q', '--', ...toUnstage], cwd);
  if (reset.status !== 0) {
    logger.error(`Failed to unstage aidev-skills paths: ${reset.stderr}`);
    return false;
  }
  return true;
}

/** Returns paths under `prefix` that are present in the git index (tracked or staged). */
export function listIndexedPaths(prefix: string, cwd?: string): string[] {
  const result = git(['ls-files', '--', prefix], cwd);
  if (result.status !== 0) return [];
  return result.stdout.trim().split('\n').filter((entry) => entry.length > 0);
}

/** Indexed (tracked or staged) paths matching any of the given git pathspecs. */
export function listIndexedMatching(pathspecs: string[], cwd?: string): string[] {
  if (pathspecs.length === 0) return [];
  const result = git(['ls-files', '--', ...pathspecs], cwd);
  if (result.status !== 0) return [];
  return result.stdout.trim().split('\n').map((entry) => entry.trim()).filter((entry) => entry.length > 0);
}

/** Removes paths from the index only (`git rm --cached`), leaving working-tree files intact. */
export function removePathsFromIndex(relativePaths: string[], cwd?: string): boolean {
  if (relativePaths.length === 0) return true;
  logger.debug(`git rm --cached -r -f -- ${relativePaths.join(' ')}`);
  const result = git(['rm', '--cached', '-r', '-f', '--', ...relativePaths], cwd);
  if (result.status !== 0) {
    logger.error(`git rm --cached failed: ${result.stderr}`);
    return false;
  }
  return true;
}

/**
 * Discards working-tree changes to a single tracked file, restoring it to the
 * HEAD version (`git checkout -- <path>`). Used to clean aidev's own bookkeeping
 * files (e.g. `.aidev/last-cleanup.log`) that are tracked in legacy repos but
 * should be gitignored — restoring to HEAD keeps the working tree clean without
 * committing a `.gitignore`/`git rm --cached` fix on the base branch.
 */
export function restoreFile(relativePath: string, cwd?: string): boolean {
  logger.debug(`git checkout -- ${relativePath}`);
  const result = git(['checkout', '--', relativePath], cwd);
  if (result.status !== 0) {
    logger.warn(`git checkout -- ${relativePath} failed: ${result.stderr}`);
    return false;
  }
  return true;
}

export function addPath(relativePath: string, cwd?: string): boolean {
  const result = git(['add', '--', relativePath], cwd);
  return result.status === 0;
}

/** True when the index differs from HEAD for the given path (i.e. a commit would not be empty). */
export function hasStagedChanges(relativePath: string, cwd?: string): boolean {
  // `diff --cached --quiet` exits 1 when there are staged differences, 0 when none.
  const result = git(['diff', '--cached', '--quiet', '--', relativePath], cwd);
  return result.status !== 0;
}

/** Removes a path from the index and working tree. */
export function removePathFromIndexAndTree(relativePath: string, cwd?: string): boolean {
  logger.debug(`git rm -r -f -- ${relativePath}`);
  const result = git(['rm', '-r', '-f', '--', relativePath], cwd);
  if (result.status !== 0) {
    logger.error(`git rm failed: ${result.stderr}`);
    return false;
  }
  return true;
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
  // Last line of defence: whatever staged the files, never commit skills links.
  if (!unstageAidevSkills()) return false;
  logger.debug(`git commit -m "${message}"`);
  const result = git(['commit', '-m', message]);
  if (result.status !== 0) {
    // git reports e.g. "nothing to commit" and hook output on stdout, so include both.
    logger.error(`git commit failed: ${(result.stderr || result.stdout).trim()}`);
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

/** Returns the short names of all local branches. */
export function listLocalBranches(): string[] {
  const result = git(['branch', '--format=%(refname:short)']);
  if (result.status !== 0) return [];
  return result.stdout.split('\n').map((line) => line.trim()).filter(Boolean);
}

/** Force-deletes a local branch without touching the current checkout. Returns false on failure (e.g. branch is checked out). */
export function forceDeleteBranch(branch: string): boolean {
  const result = git(['branch', '-D', branch]);
  if (result.status !== 0) {
    logger.warn(`git branch -D ${branch} failed: ${result.stderr}`);
    return false;
  }
  return true;
}

/** Returns the number of stash entries. */
export function stashCount(): number {
  const result = git(['stash', 'list']);
  if (result.status !== 0) return 0;
  return result.stdout.split('\n').filter((line) => line.trim().length > 0).length;
}

/** Deletes all stash entries. */
export function clearStashes(): boolean {
  const result = git(['stash', 'clear']);
  if (result.status !== 0) {
    logger.error(`git stash clear failed: ${result.stderr}`);
    return false;
  }
  return true;
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
  ensureLocalExclude();
  const add = git(['add', '-A']);
  if (add.status !== 0) {
    logger.error(`git add failed during merge resolution: ${add.stderr}`);
    return false;
  }
  if (!unstageAidevSkills()) return false;
  const result = git(['commit', '-m', message]);
  if (result.status !== 0) {
    logger.error(`git merge commit failed: ${result.stderr}`);
    return false;
  }
  return true;
}

// ─── Helpers for aidev-owned clones (e.g. the skills cache) ──────────────────
// These all take an explicit directory and never touch process.cwd().

const NETWORK_TIMEOUT_MS = 120_000;

/** Never block on an interactive credential prompt. */
function noPromptOptions(): GitOptions {
  return { env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }, timeout: NETWORK_TIMEOUT_MS };
}

export interface GitCallResult {
  ok: boolean;
  stdout: string;
  stderr: string;
}

function toResult(r: { stdout: string; stderr: string; status: number }): GitCallResult {
  return { ok: r.status === 0, stdout: r.stdout, stderr: r.stderr.trim() };
}

/** `git clone -- <url> <dest>` (default branch). `--` stops a hostile URL being read as an option. */
export function cloneRepo(url: string, dest: string): GitCallResult {
  logger.debug(`git clone ${url} ${dest}`);
  return toResult(git(['clone', '--quiet', '--', url, dest], dirname(dest), noPromptOptions()));
}

/** Fetches a single branch into `refs/remotes/<remote>/<branch>` of the repo at `dir`. */
export function fetchBranchIn(dir: string, remote: string, branch: string): GitCallResult {
  logger.debug(`git fetch ${remote} ${branch} (in ${dir})`);
  return toResult(git(
    ['fetch', '--quiet', remote, `+refs/heads/${branch}:refs/remotes/${remote}/${branch}`],
    dir,
    noPromptOptions(),
  ));
}

/** Force-points local `branch` at `ref` and checks it out (`git checkout -f -B`). */
export function checkoutBranchForce(dir: string, branch: string, ref: string): GitCallResult {
  logger.debug(`git checkout -f -B ${branch} ${ref} (in ${dir})`);
  return toResult(git(['checkout', '--quiet', '-f', '-B', branch, ref], dir));
}

/** `git reset --hard <ref>` in `dir`. */
export function resetHardTo(dir: string, ref: string): GitCallResult {
  logger.debug(`git reset --hard ${ref} (in ${dir})`);
  return toResult(git(['reset', '--quiet', '--hard', ref], dir));
}

/** Current branch of the repo at `dir`, or null (detached / not a repo). */
export function currentBranchIn(dir: string): string | null {
  const r = git(['rev-parse', '--abbrev-ref', 'HEAD'], dir);
  if (r.status !== 0) return null;
  const name = r.stdout.trim();
  return name && name !== 'HEAD' ? name : null;
}

/**
 * Whether `branch` exists on the remote. `ok:false` means the remote could not
 * be reached (network/auth); `ok:true, exists:false` means it was reached but
 * has no such branch.
 */
export function remoteHasBranch(dir: string, remote: string, branch: string):
  { ok: boolean; exists: boolean; stderr: string } {
  const r = git(['ls-remote', '--heads', remote, `refs/heads/${branch}`], dir, noPromptOptions());
  if (r.status !== 0) return { ok: false, exists: false, stderr: r.stderr.trim() };
  return { ok: true, exists: r.stdout.trim().length > 0, stderr: '' };
}

/** Default (HEAD) branch of the remote, or null if it cannot be determined. */
export function remoteDefaultBranch(dir: string, remote: string): string | null {
  const r = git(['ls-remote', '--symref', remote, 'HEAD'], dir, noPromptOptions());
  if (r.status !== 0) return null;
  const match = r.stdout.match(/^ref:\s+refs\/heads\/(\S+)\s+HEAD/m);
  return match ? match[1] : null;
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 50);
}

/** `<id>/<slug>`, or just `<id>` when the title slugifies to nothing (e.g. non-English titles). */
export function buildBranchName(taskId: string, title: string): string {
  const slug = slugify(title);
  return slug ? `${taskId}/${slug}` : taskId;
}

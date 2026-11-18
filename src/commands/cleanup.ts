import * as fs from 'node:fs';
import * as path from 'node:path';
import * as readline from 'node:readline/promises';
import { readActiveTask } from '../activeTask';
import { Config } from '../types';
import { TaskProvider } from '../providers';
import * as git from '../git';
import { logger } from '../logger';
import { cleanupStatePath, cleanupStateRelPath, readLastCleanupAt, writeLastCleanupAt, shouldRunWeeklyCleanup } from '../cleanupState';

export interface CleanupSummary {
  branchesDeleted: string[];
  stashesCleared: number;
  worktreesRemoved: number;
}

/**
 * Deletes local branches whose leading `<taskId>/…` segment (see the
 * `${task.id}/${slugify(task.name)}` convention in run.ts) does not match any
 * currently active (non-closed) task, so finished/abandoned task branches
 * don't accumulate forever. Never touches remote branches — this is local
 * housekeeping only.
 */
async function fetchActiveTaskIds(provider: TaskProvider): Promise<Set<string>> {
  // fetchBoardTasks covers all active statuses (open/pending/in progress/in
  // review); fetchTasks only returns open/pending for some providers, which
  // would wrongly delete branches for in-review and in-progress tasks.
  const activeTasks = provider.fetchBoardTasks
    ? await provider.fetchBoardTasks({ skipAttachments: true, omitDescription: true })
    : await provider.fetchTasks();
  return new Set(activeTasks.map((t) => t.id));
}

function isStaleBranch(branch: string, baseBranch: string, activeTaskIds: Set<string>): boolean {
  if (branch === baseBranch || git.isProtectedBranch(branch)) return false;
  return !activeTaskIds.has(branch.split('/')[0]);
}

/** Worktrees with no activity for this long are removed. */
export const WORKTREE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export interface StaleWorktree {
  path: string;
  branch: string | null;
  reason: string;
}

/** Resolves symlinks / Windows 8.3 short names so paths from git and from the OS compare equal. */
function canonicalPath(p: string): string {
  const abs = path.resolve(p);
  let real = abs;
  try {
    real = fs.realpathSync.native(abs);
  } catch {
    /* path may not exist */
  }
  return process.platform === 'win32' || process.platform === 'darwin' ? real.toLowerCase() : real;
}

function isInside(parent: string, child: string): boolean {
  const rel = path.relative(canonicalPath(parent), canonicalPath(child));
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

/**
 * Latest modification time of a worktree: the root directory's mtime does not change when
 * nested files are edited, so also consider the worktree's HEAD and index files.
 */
function lastActivityMs(wtPath: string): number {
  let latest = 0;
  const consider = (p: string) => {
    try {
      latest = Math.max(latest, fs.statSync(p).mtimeMs);
    } catch {
      /* missing */
    }
  };
  consider(wtPath);
  const gitFile = path.join(wtPath, '.git');
  try {
    const m = /^gitdir:\s*(.+)$/m.exec(fs.readFileSync(gitFile, 'utf8'));
    if (m) {
      const gitDir = path.resolve(wtPath, m[1].trim());
      consider(path.join(gitDir, 'HEAD'));
      consider(path.join(gitDir, 'index'));
    }
  } catch {
    /* not a linked worktree file */
  }
  return latest;
}

/**
 * Worktrees under `.aidev/worktrees` that are safe to remove: branch gone or merged,
 * task no longer active, or no activity for 7 days — and in every case free of uncommitted
 * changes. The currently active task's worktree and locked worktrees are never returned.
 */
export function findStaleWorktrees(
  config: Config,
  activeTaskIds: Set<string>,
  now: number = Date.now(),
  cwd: string = process.cwd(),
): StaleWorktree[] {
  const dir = git.worktreesDir(cwd);
  const runningTask = readActiveTask(cwd);
  const branches = new Set(git.listLocalBranches());
  const stale: StaleWorktree[] = [];

  for (const wt of git.listWorktrees(cwd)) {
    if (!isInside(dir, wt.path) || wt.locked) continue;
    const taskId = wt.branch ? wt.branch.split('/')[0] : null;
    if (runningTask && taskId === runningTask) continue;

    if (!fs.existsSync(wt.path)) {
      stale.push({ path: wt.path, branch: wt.branch, reason: 'directory is missing' });
      continue;
    }

    let reason: string | null = null;
    if (wt.branch && !branches.has(wt.branch)) {
      reason = 'branch no longer exists';
    } else if (wt.branch && isStaleBranch(wt.branch, config.githubBaseBranch, activeTaskIds)) {
      reason = 'task is no longer active';
    } else if (
      wt.branch &&
      !git.isProtectedBranch(wt.branch) &&
      git.isBranchMerged(wt.branch, config.githubBaseBranch, cwd)
    ) {
      reason = 'branch is merged';
    } else if (now - lastActivityMs(wt.path) > WORKTREE_MAX_AGE_MS) {
      reason = 'no activity for over 7 days';
    }
    if (!reason) continue;

    // Never discard uncommitted work, whatever the reason (a deleted branch's worktree is
    // still skipped when dirty so the user can recover the edits).
    if (git.hasChanges(wt.path)) {
      logger.warn(`Weekly cleanup: keeping worktree ${wt.path} (${reason}) — it has uncommitted changes`);
      continue;
    }
    stale.push({ path: wt.path, branch: wt.branch, reason });
  }
  return stale;
}

/** Directories under `.aidev/worktrees` that git does not list as worktrees. */
export function findOrphanWorktreeDirs(cwd: string = process.cwd()): string[] {
  const dir = git.worktreesDir(cwd);
  if (!fs.existsSync(dir)) return [];
  const known = git.listWorktrees(cwd).map((w) => w.path);
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => path.join(dir, e.name))
    .filter((p) => !known.some((k) => git.samePath(k, p)));
}

/** Removes stale worktrees, prunes git's registry, then deletes orphan directories. Returns how many were removed. */
function removeStaleWorktrees(config: Config, activeTaskIds: Set<string>): number {
  let removed = 0;
  for (const wt of findStaleWorktrees(config, activeTaskIds)) {
    logger.info(`Weekly cleanup: removing worktree ${wt.path} (${wt.reason})`);
    if (git.removeWorktree(wt.path, true)) removed++;
  }
  git.pruneWorktrees();
  for (const orphan of findOrphanWorktreeDirs()) {
    try {
      fs.rmSync(orphan, { recursive: true, force: true });
      removed++;
    } catch (err) {
      logger.warn(`Weekly cleanup: could not delete orphan worktree dir ${orphan}: ${err instanceof Error ? err.message : err}`);
    }
  }
  return removed;
}

export async function weeklyCleanupCommand(config: Config, provider: TaskProvider): Promise<CleanupSummary | null> {
  logger.info('Running weekly cleanup...');

  let activeTaskIds: Set<string>;
  try {
    activeTaskIds = await fetchActiveTaskIds(provider);
  } catch (err) {
    logger.warn(
      `Weekly cleanup: failed to fetch active tasks (${err instanceof Error ? err.message : err}) — skipping to avoid deleting in-progress work`
    );
    return null;
  }

  // `.aidev/last-cleanup.log` is written to the working tree after a successful run (see
  // maybeRunWeeklyCleanup below) but is never committed. It's named `.log` rather than `.json`
  // so it's covered by the near-universal `*.log` .gitignore rule even in repos `aidev init`'d
  // before this file existed, but a repo could still lack any `*.log` rule, in which case it
  // lingers as an untracked file that trips the clean-working-tree check below on every
  // subsequent cleanup, permanently blocking cleanup from ever running again. It's aidev's own
  // bookkeeping (never user data, and safely regenerated on the next successful run), so drop it
  // before the check if it's untracked rather than commit a .gitignore fix here, which would
  // leave the base branch with an unpushed local commit and trip fetchAndCheckout's local/remote
  // divergence check below.
  //
  // The same self-heal applies when the file is *tracked* (committed before the .gitignore rule)
  // but *modified* — a previous writeLastCleanupAt updated the timestamp, dirtying the working
  // tree. Restoring it to HEAD (rather than removing it) clears the modification without staging
  // a deletion that would itself trip requireCleanWorkingTree. The committed timestamp then
  // serves as the baseline; cleanup still runs weekly on Mondays (see shouldRunWeeklyCleanup).
  const statePath = cleanupStatePath();
  const stateRelPath = cleanupStateRelPath();
  if (fs.existsSync(statePath)) {
    if (git.listIndexedPaths(stateRelPath).length === 0) {
      fs.rmSync(statePath, { force: true });
    } else {
      git.restoreFile(stateRelPath);
    }
  }

  // Move off any branch we might delete before pruning, and bring the base branch up to date.
  if (!git.fetchAndCheckout(config.gitRemote, config.githubBaseBranch)) {
    logger.error('Weekly cleanup: failed to checkout and update base branch — aborting cleanup');
    return null;
  }

  // Worktrees go first: git refuses to delete a branch that is checked out in a worktree.
  const worktreesRemoved = removeStaleWorktrees(config, activeTaskIds);
  logger.info(`Weekly cleanup: removed ${worktreesRemoved} stale worktree(s)`);

  const branchesDeleted: string[] = [];
  for (const branch of git.listLocalBranches()) {
    if (!isStaleBranch(branch, config.githubBaseBranch, activeTaskIds)) continue;

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
  return { branchesDeleted, stashesCleared, worktreesRemoved };
}

export interface CleanCommandOptions {
  dryRun?: boolean;
  yes?: boolean;
}

/**
 * `aidev clean`: manual entry point for the weekly cleanup. Describes what will
 * happen, then asks for y/N approval (skipped with --yes). --dry-run only prints
 * the plan and changes nothing.
 */
export async function cleanCommand(config: Config, provider: TaskProvider, opts: CleanCommandOptions = {}): Promise<void> {
  let activeTaskIds: Set<string>;
  try {
    activeTaskIds = await fetchActiveTaskIds(provider);
  } catch (err) {
    logger.error(
      `Failed to fetch active tasks (${err instanceof Error ? err.message : err}) — aborting to avoid deleting in-progress work`
    );
    process.exitCode = 1;
    return;
  }

  const base = config.githubBaseBranch;
  const staleBranches = git.listLocalBranches().filter((b) => isStaleBranch(b, base, activeTaskIds));
  const stashes = git.stashCount();

  console.log('aidev clean will:');
  console.log(`  - fetch and check out "${base}" from "${config.gitRemote}" (updating it to match the remote)`);
  if (staleBranches.length > 0) {
    console.log(`  - force-delete ${staleBranches.length} local branch(es) not belonging to an active task:`);
    for (const b of staleBranches) console.log(`      ${b}`);
  } else {
    console.log('  - delete no local branches (none are stale)');
  }
  const staleWorktrees = findStaleWorktrees(config, activeTaskIds);
  const orphanDirs = findOrphanWorktreeDirs();
  if (staleWorktrees.length + orphanDirs.length > 0) {
    console.log(`  - remove ${staleWorktrees.length + orphanDirs.length} stale git worktree(s) under ${git.WORKTREES_REL_DIR}:`);
    for (const w of staleWorktrees) console.log(`      ${w.path} (${w.reason})`);
    for (const o of orphanDirs) console.log(`      ${o} (not registered with git)`);
  } else {
    console.log('  - remove no git worktrees (none are stale)');
  }
  console.log(stashes > 0 ? `  - clear ${stashes} git stash(es)` : '  - clear no stashes (none found)');
  console.log('Remote branches are never touched.');

  if (opts.dryRun) {
    logger.info('Dry run — no changes made.');
    return;
  }

  if (!opts.yes) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    let answer = '';
    try {
      answer = await rl.question('Proceed? [y/N] ');
    } finally {
      rl.close();
    }
    if (!['y', 'yes'].includes(answer.trim().toLowerCase())) {
      logger.info('Aborted — no changes made.');
      return;
    }
  }

  const result = await weeklyCleanupCommand(config, provider);
  if (!result) {
    process.exitCode = 1;
    return;
  }
  writeLastCleanupAt(Date.now());
  const stateRelPath = cleanupStateRelPath();
  if (git.listIndexedPaths(stateRelPath).length > 0) git.restoreFile(stateRelPath);
}

/**
 * Runs the weekly cleanup at most once per week, on the first `aidev run`
 * that lands on a Monday. State lives in the gitignored `.aidev/last-cleanup.log`
 * so no separate OS-level cron entry is needed — this piggybacks on however
 * often the user already has `aidev run` scheduled.
 */
export async function maybeRunWeeklyCleanup(config: Config, provider: TaskProvider): Promise<void> {
  const lastCleanupAt = readLastCleanupAt();
  if (!shouldRunWeeklyCleanup(lastCleanupAt)) return;

  const result = await weeklyCleanupCommand(config, provider);
  if (result) {
    writeLastCleanupAt(Date.now());
    // If the state file is tracked (legacy repo committed it before the .gitignore rule),
    // the write above dirtied the working tree and would block subsequent task processing
    // in this run (createBranchFromRemote → requireCleanWorkingTree). Restore to HEAD so
    // the tree is clean; the committed timestamp serves as the baseline for next week.
    const stateRelPath = cleanupStateRelPath();
    if (git.listIndexedPaths(stateRelPath).length > 0) {
      git.restoreFile(stateRelPath);
    }
  }
}

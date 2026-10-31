import * as fs from 'node:fs';
import * as path from 'node:path';
import * as git from './git';

/**
 * Gitignored file recording when the weekly cleanup last ran, so cron ticks
 * (which fire every few minutes with no OS-level weekly schedule) know whether
 * one is due. Uses a `.log` extension (rather than `.json`) because `*.log` is
 * already covered by virtually every project's .gitignore, so a repo `aidev
 * init`'d before this rule existed still has the file ignored — avoiding it
 * lingering as an untracked file that dirties the working tree.
 */
export function cleanupStateRelPath(): string {
  return path.join('.aidev', 'last-cleanup.log');
}

export function cleanupStatePath(cwd = process.cwd()): string {
  return path.join(cwd, cleanupStateRelPath());
}

export function readLastCleanupAt(cwd = process.cwd()): number | null {
  const file = cleanupStatePath(cwd);
  if (!fs.existsSync(file)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return typeof parsed.lastCleanupAt === 'number' ? parsed.lastCleanupAt : null;
  } catch {
    return null;
  }
}

export function writeLastCleanupAt(timestamp: number, cwd = process.cwd()): void {
  const file = cleanupStatePath(cwd);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ lastCleanupAt: timestamp }, null, 2), 'utf8');
}

/**
 * Weekly cleanup is due on the first `aidev run` tick of the week that lands
 * on a Monday (local time) — i.e. Monday morning, given aidev is typically
 * cron-scheduled every few minutes around the clock. `lastCleanupAt === null`
 * (never run before) counts as due so a fresh checkout starts the cadence on
 * its first Monday. The 6-day floor (instead of 7) tolerates schedule drift
 * without re-triggering more than once on the same Monday.
 */
export function shouldRunWeeklyCleanup(lastCleanupAt: number | null, now: Date = new Date()): boolean {
  if (now.getDay() !== 1) return false;
  if (lastCleanupAt === null) return true;
  const sixDaysMs = 6 * 24 * 60 * 60 * 1000;
  return now.getTime() - lastCleanupAt >= sixDaysMs;
}

/**
 * Older aidev versions kept the cleanup timestamp in `.aidev/last-cleanup.json`,
 * which many repos never gitignored. Left untracked it gets swept into task
 * commits by `git add -A`; left tracked-but-modified (or deleted in the
 * worktree / staged for deletion) it dirties the tree and blocks branch
 * creation. Heal it at the start of a run: delete it when untracked, restore
 * it to HEAD when still indexed. The current state lives in
 * `.aidev/last-cleanup.log`, so nothing of value is lost.
 *
 * Path is forward-slash form so git pathspecs work on Windows (`path.join`
 * would produce backslashes).
 */
export const LEGACY_CLEANUP_STATE_RELPATH = '.aidev/last-cleanup.json';

export function healLegacyCleanupState(cwd = process.cwd()): void {
  const file = path.join(cwd, ...LEGACY_CLEANUP_STATE_RELPATH.split('/'));
  // Prefer HEAD over the index: after `git rm` the path is gone from the index
  // (`D ` staged deletion) but still present in HEAD, and that dirty state is
  // exactly what was blocking createBranchFromRemote in aidev.log.
  if (git.pathExistsInHead(LEGACY_CLEANUP_STATE_RELPATH, cwd)) {
    git.restoreFile(LEGACY_CLEANUP_STATE_RELPATH, cwd);
    return;
  }
  // Never committed (or already removed from the tree) — drop any stray
  // working-tree copy so `git add -A` cannot re-commit it.
  if (fs.existsSync(file)) fs.rmSync(file, { force: true });
}

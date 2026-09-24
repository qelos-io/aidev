import * as fs from 'node:fs';
import * as path from 'node:path';

/** Gitignored file recording when the weekly cleanup last ran, so cron ticks (which fire every few minutes with no OS-level weekly schedule) know whether one is due. */
export function cleanupStateRelPath(): string {
  return path.join('.aidev', 'last-cleanup.json');
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

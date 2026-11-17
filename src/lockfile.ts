import * as fs from 'node:fs';
import * as path from 'node:path';

export const LOCK_FILENAME = '.aidev.lock';

export function lockfilePath(cwd: string): string {
  return path.join(cwd, LOCK_FILENAME);
}

/** Returns true if the given PID corresponds to a running process. */
export function isProcessAlive(pid: number): boolean {
  // pid 0 / negative values would signal a process group, not a single process.
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM: the process exists but we may not signal it → alive.
    // ESRCH (and anything else): no such process → dead.
    return (err as NodeJS.ErrnoException)?.code === 'EPERM';
  }
}

/**
 * Read the PID stored in the lock file.
 * Returns null if the file does not exist or its content is not a valid integer.
 */
export function readLock(cwd: string): number | null {
  const p = lockfilePath(cwd);
  if (!fs.existsSync(p)) return null;
  const raw = fs.readFileSync(p, 'utf8').trim();
  const pid = parseInt(raw, 10);
  return isNaN(pid) ? null : pid;
}

/** Alias of {@link readLock}: the PID recorded in the lock file, or null. */
export function readLockPid(cwd: string): number | null {
  return readLock(cwd);
}

/**
 * Try to acquire the lock for `cwd`.
 * Returns true on success, false if another live process already holds it.
 */
export function acquireLock(cwd: string): boolean {
  const existing = readLock(cwd);
  if (existing !== null && isProcessAlive(existing)) {
    return false;
  }
  // Write our PID (overwriting stale lock if present)
  fs.writeFileSync(lockfilePath(cwd), String(process.pid), 'utf8');
  return true;
}

/** Remove the lock file for `cwd`. Safe to call even if file is absent. */
export function releaseLock(cwd: string): void {
  try {
    fs.unlinkSync(lockfilePath(cwd));
  } catch {
    // already removed or never existed
  }
}

/**
 * Stop the process that holds the lock for `cwd`.
 * Returns 'killed' | 'not-running' | 'no-lock'.
 */
export type StopResult = 'killed' | 'not-running' | 'no-lock';

export function stopProcess(cwd: string): StopResult {
  const pid = readLock(cwd);
  if (pid === null) return 'no-lock';
  if (!isProcessAlive(pid)) {
    releaseLock(cwd);
    return 'not-running';
  }
  process.kill(pid, 'SIGTERM');
  releaseLock(cwd);
  return 'killed';
}

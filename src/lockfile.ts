import * as fs from 'node:fs';
import * as path from 'node:path';
import { logger } from './logger';

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
  let raw: string;
  try {
    raw = fs.readFileSync(p, 'utf8').trim();
  } catch {
    return null; // absent (or removed concurrently)
  }
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
  // Atomic create (`wx` = O_EXCL): only one process can ever create the file. On EEXIST
  // we inspect the owner; a stale lock is removed and creation retried once.
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      fs.writeFileSync(lockfilePath(cwd), String(process.pid), { encoding: 'utf8', flag: 'wx' });
      return true;
    } catch (err) {
      if ((err as NodeJS.ErrnoException)?.code !== 'EEXIST') throw err;
    }
    const existing = readLock(cwd);
    if (existing !== null && isProcessAlive(existing)) return false;
    if (attempt === 1) return false;
    logger.warn(
      existing !== null
        ? `Removing stale ${LOCK_FILENAME} (PID ${existing} is not running).`
        : `Removing stale ${LOCK_FILENAME} (no valid PID recorded).`
    );
    // Re-check right before removing so we don't delete a lock another process just
    // took over from the same stale one.
    if (readLock(cwd) === existing) releaseLock(cwd);
  }
  return false;
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

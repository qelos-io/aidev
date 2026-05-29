import * as fs from 'node:fs';
import * as path from 'node:path';
import { isProcessAlive, readLock } from './lockfile';

export const ACTIVE_TASK_FILENAME = '.aidev.active';

export function activeTaskPath(cwd: string): string {
  return path.join(cwd, ACTIVE_TASK_FILENAME);
}

export function writeActiveTask(cwd: string, taskId: string): void {
  fs.writeFileSync(activeTaskPath(cwd), taskId.trim(), 'utf8');
}

export function readActiveTaskFile(cwd: string): string | null {
  const p = activeTaskPath(cwd);
  if (!fs.existsSync(p)) return null;
  const raw = fs.readFileSync(p, 'utf8').trim();
  return raw.length > 0 ? raw : null;
}

export function clearActiveTask(cwd: string): void {
  try {
    fs.unlinkSync(activeTaskPath(cwd));
  } catch {
    // already removed or never existed
  }
}

/**
 * Task id currently being implemented by a live `aidev run` in `cwd`, if any.
 * Returns null when no lock is held, the holder is dead, or no task file exists.
 */
export function readActiveTask(cwd: string): string | null {
  const pid = readLock(cwd);
  if (pid === null || !isProcessAlive(pid)) {
    clearActiveTask(cwd);
    return null;
  }
  return readActiveTaskFile(cwd);
}

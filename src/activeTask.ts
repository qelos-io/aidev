import * as fs from 'node:fs';
import * as path from 'node:path';
import { isProcessAlive, readLock } from './lockfile';

export const ACTIVE_TASK_FILENAME = '.aidev.active';

export function activeTaskPath(cwd: string): string {
  return path.join(cwd, ACTIVE_TASK_FILENAME);
}

/**
 * Parse the file content. Format: `<taskId>\n<pid>`. Legacy files hold only
 * the task id (single line), in which case pid is null.
 */
function parseActiveFile(raw: string): { taskId: string | null; pid: number | null } {
  const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
  if (lines.length === 0) return { taskId: null, pid: null };
  if (lines.length >= 2) {
    const last = lines[lines.length - 1];
    if (/^\d+$/.test(last)) {
      const taskId = lines.slice(0, -1).join('\n');
      return { taskId, pid: parseInt(last, 10) };
    }
  }
  return { taskId: lines.join('\n'), pid: null };
}

function readActiveFileRaw(cwd: string): { taskId: string | null; pid: number | null } {
  try {
    return parseActiveFile(fs.readFileSync(activeTaskPath(cwd), 'utf8'));
  } catch {
    return { taskId: null, pid: null };
  }
}

/** Record the active task id together with the owning process id. */
export function writeActiveTask(cwd: string, taskId: string, pid: number = process.pid): void {
  fs.writeFileSync(activeTaskPath(cwd), `${taskId.trim()}\n${pid}`, 'utf8');
}

export function readActiveTaskFile(cwd: string): string | null {
  return readActiveFileRaw(cwd).taskId;
}

/** PID recorded in the active file, or null (absent file, or legacy id-only file). */
export function readActivePid(cwd: string): number | null {
  return readActiveFileRaw(cwd).pid;
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

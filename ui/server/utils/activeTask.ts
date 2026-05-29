import * as path from 'node:path';
import { createRequire } from 'node:module';
import { getActiveRun } from './currentRun';

/**
 * Task id currently being worked in this working tree, if known.
 * Prefers the UI-spawned single-task execute/run child, then `.aidev.active`
 * while the lockfile is held by a live `aidev run` process.
 */
export function resolveActiveTaskId(cwd: string, dist: string): string | null {
  const uiRun = getActiveRun();
  if (uiRun?.taskId) return uiRun.taskId;

  const req = createRequire(path.join(cwd, 'package.json'));
  const lockMod = req(path.join(dist, 'lockfile')) as {
    readLock: (dir: string) => number | null;
    isProcessAlive: (pid: number) => boolean;
  };
  const activeMod = req(path.join(dist, 'activeTask')) as {
    readActiveTaskFile: (dir: string) => string | null;
    clearActiveTask: (dir: string) => void;
  };

  const pid = lockMod.readLock(cwd);
  if (pid === null || !lockMod.isProcessAlive(pid)) {
    activeMod.clearActiveTask(cwd);
    return null;
  }
  return activeMod.readActiveTaskFile(cwd);
}

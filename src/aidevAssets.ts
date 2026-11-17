import * as fs from 'node:fs';
import * as path from 'node:path';
import { sanitizePathSegment } from './providers/assets';

export { secretsFileRelPath } from './safeMode';

export function assetsRootRelPath(): string {
  return path.join('.aidev', 'assets');
}

export function taskAssetsRelPath(taskId: string): string {
  return path.join('.aidev', 'assets', sanitizePathSegment(taskId));
}

export function taskAssetsDir(taskId: string, cwd = process.cwd()): string {
  return path.join(cwd, taskAssetsRelPath(taskId));
}

/** Snapshot of a failed attempt's uncommitted changes, kept in the gitignored task assets folder. */
export const UNCOMMITTED_DIFF_FILENAME = 'uncommitted.diff';

export function uncommittedDiffPath(taskId: string, cwd = process.cwd()): string {
  return path.join(taskAssetsDir(taskId, cwd), UNCOMMITTED_DIFF_FILENAME);
}

/** Writes the diff; returns its absolute path, or null if empty or the write failed (never throws). */
export function writeUncommittedDiff(taskId: string, diff: Buffer | string, cwd = process.cwd()): string | null {
  if (diff.length === 0) return null;
  const file = uncommittedDiffPath(taskId, cwd);
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, diff);
    return file;
  } catch {
    return null;
  }
}

/** Absolute path of the saved diff if one exists and is non-empty, else null. */
export function readUncommittedDiffPath(taskId: string, cwd = process.cwd()): string | null {
  const file = uncommittedDiffPath(taskId, cwd);
  try {
    const stat = fs.statSync(file);
    return stat.isFile() && stat.size > 0 ? file : null;
  } catch {
    return null;
  }
}

/** Removes the saved diff (e.g. after it was re-applied). Best-effort. */
export function removeUncommittedDiff(taskId: string, cwd = process.cwd()): void {
  try {
    fs.rmSync(uncommittedDiffPath(taskId, cwd), { force: true });
  } catch {
    // best-effort
  }
}

export function listTaskAssetFiles(taskId: string, cwd = process.cwd()): string[] {
  const taskDir = taskAssetsDir(taskId, cwd);
  if (!fs.existsSync(taskDir)) return [];

  const stat = fs.statSync(taskDir);
  if (!stat.isDirectory()) return [];

  return collectTaskAssetFiles(taskDir, cwd).sort();
}

export function getExistingAssetDirs(taskId: string, cwd = process.cwd()): string[] {
  const dirs: string[] = [];
  const rootDir = path.join(cwd, assetsRootRelPath());
  if (fs.existsSync(rootDir) && fs.statSync(rootDir).isDirectory()) {
    dirs.push(rootDir);
  }

  const taskDir = taskAssetsDir(taskId, cwd);
  if (fs.existsSync(taskDir) && fs.statSync(taskDir).isDirectory()) {
    dirs.push(taskDir);
  }

  return dirs;
}

function collectTaskAssetFiles(currentDir: string, cwd: string): string[] {
  const results: string[] = [];

  for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
    if (entry.name === 'secrets') continue;

    const fullPath = path.join(currentDir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectTaskAssetFiles(fullPath, cwd));
    } else if (entry.isFile()) {
      results.push(toRelativeAssetPath(cwd, fullPath));
    }
  }

  return results;
}

function toRelativeAssetPath(cwd: string, filePath: string): string {
  return path.relative(cwd, filePath).split(path.sep).join('/');
}

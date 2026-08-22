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

import * as fs from 'node:fs';
import * as path from 'node:path';

export const isWindows = process.platform === 'win32';

/**
 * Finds the full path of a binary by searching PATH (and PATHEXT on Windows).
 * Returns the resolved path, or null if not found.
 * Uses only Node.js fs — no `which` / `where` subprocess.
 */
export function findBin(name: string): string | null {
  const dirs = (process.env.PATH ?? '').split(path.delimiter).filter(Boolean);
  const exts = isWindows
    ? (process.env.PATHEXT ?? '.EXE;.CMD;.BAT;.COM').split(';').map((e) => e.toLowerCase())
    : [''];

  for (const dir of dirs) {
    for (const ext of exts) {
      const full = path.join(dir, name + ext);
      try {
        fs.accessSync(full, fs.constants.F_OK);
        return full;
      } catch {
        // not here — keep searching
      }
    }
  }
  return null;
}

export function commandExists(name: string): boolean {
  return findBin(name) !== null;
}

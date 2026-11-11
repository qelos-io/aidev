import { defineEventHandler } from 'h3';
import * as fs from 'node:fs';
import * as path from 'node:path';

// Programs each CLI-based assistant needs on PATH. Mirrors each runner's isAvailable()
// in src/ai/*.ts (kept local so the dashboard doesn't pull the CLI's sources into its build).
const BINS: Record<string, string[]> = {
  claude: ['claude'],
  cursor: ['agent'],
  codex: ['codex'],
  opencode: ['opencode'],
  devin: ['devin'],
  antigravity: ['agy', 'antigravity'],
};

function onPath(name: string): boolean {
  const isWin = process.platform === 'win32';
  const exts = isWin ? (process.env.PATHEXT ?? '.EXE;.CMD;.BAT;.COM').split(';') : [''];
  for (const dir of (process.env.PATH ?? '').split(path.delimiter).filter(Boolean)) {
    for (const ext of exts) {
      try {
        fs.accessSync(path.join(dir, name + ext.toLowerCase()), fs.constants.F_OK);
        return true;
      } catch {
        // not in this directory
      }
    }
  }
  return false;
}

export default defineEventHandler(() => ({
  agents: Object.entries(BINS).map(([id, bins]) => ({ id, installed: bins.some(onPath) })),
}));

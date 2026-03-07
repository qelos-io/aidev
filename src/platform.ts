import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';

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

/**
 * Returns false when the machine's display is asleep or the screen is locked,
 * meaning GUI-dependent AI agents (Cursor, Windsurf, Claude) cannot operate.
 * Falls back to true (assume available) when detection is inconclusive.
 */
export function isScreenAvailable(): boolean {
  if (process.platform === 'darwin') return isDarwinScreenAvailable();
  if (process.platform === 'linux') return isLinuxScreenAvailable();
  return true;
}

function isDarwinScreenAvailable(): boolean {
  if (isDarwinDisplayAsleep()) return false;
  if (isDarwinScreenLocked()) return false;
  return true;
}

function isDarwinDisplayAsleep(): boolean {
  // IODisplayWrangler tracks display power on Intel Macs
  // CurrentPowerState: 4 = on, < 4 = display sleeping/dimmed/off
  const wrangler = spawnSync('ioreg', ['-n', 'IODisplayWrangler', '-r', '-d', '1', '-w', '0'], {
    encoding: 'utf8',
    timeout: 5000,
  });
  if (wrangler.status === 0 && wrangler.stdout) {
    const match = wrangler.stdout.match(/"CurrentPowerState"\s*=\s*(\d+)/);
    if (match) return parseInt(match[1], 10) < 4;
  }

  // AppleBacklightDisplay covers Apple Silicon Macs
  const backlight = spawnSync('ioreg', ['-r', '-d', '1', '-c', 'AppleBacklightDisplay', '-w', '0'], {
    encoding: 'utf8',
    timeout: 5000,
  });
  if (backlight.status === 0 && backlight.stdout) {
    const match = backlight.stdout.match(/"CurrentPowerState"\s*=\s*(\d+)/);
    if (match) return parseInt(match[1], 10) < 4;
  }

  return false;
}

function isDarwinScreenLocked(): boolean {
  // IOConsoleUsers on the Root node contains CGSSessionScreenIsLocked
  const result = spawnSync('ioreg', ['-n', 'Root', '-d1', '-w', '0'], {
    encoding: 'utf8',
    timeout: 5000,
  });
  if (result.status === 0 && result.stdout) {
    return /CGSSessionScreenIsLocked[^=]*=\s*(<true>|Yes|1\b)/i.test(result.stdout);
  }
  return false;
}

function isLinuxScreenAvailable(): boolean {
  const result = spawnSync('loginctl', ['show-session', 'auto', '--property=LockedHint'], {
    encoding: 'utf8',
    timeout: 5000,
  });
  if (result.status === 0 && result.stdout) {
    return !result.stdout.includes('LockedHint=yes');
  }
  return true;
}

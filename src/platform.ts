import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import type { SpawnSyncOptionsWithStringEncoding, SpawnSyncReturns } from 'node:child_process';

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

  if (isWindows) {
    try {
      const result = spawnSync('where.exe', [name], {
        encoding: 'utf8',
        timeout: 5000,
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      if (result.status === 0 && result.stdout) {
        const firstLine = result.stdout.trim().split(/\r?\n/)[0]?.trim();
        if (firstLine) return firstLine;
      }
    } catch { /* ignore */ }
  }

  return null;
}

export function commandExists(name: string): boolean {
  return findBin(name) !== null;
}

/**
 * Detects whether a resolved binary path is a Windows .cmd/.bat shim and
 * returns adjusted spawn arguments that route through cmd.exe.
 * Returns null when no adjustment is needed.
 */
export function resolveWindowsCmd(
  resolvedPath: string | null,
  args: string[]
): { bin: string; args: string[] } | null {
  if (!resolvedPath || !/\.(cmd|bat)$/i.test(resolvedPath)) return null;
  const comspec = process.env.ComSpec || 'cmd.exe';
  return { bin: comspec, args: ['/c', resolvedPath, ...args] };
}

/**
 * Cross-platform `spawnSync` wrapper.
 * On Windows, .cmd/.bat shims (common for npm-installed CLIs like cursor,
 * claude, windsurf) cannot be spawned directly — Node.js only resolves .exe
 * and .com via CreateProcessW.  This helper detects .cmd/.bat and routes
 * them through cmd.exe /c so they execute correctly without shell: true
 * (which triggers DEP0190 and mishandles arguments containing spaces or
 * shell metacharacters).
 */
export function spawnCommand(
  command: string,
  args: string[],
  options: SpawnSyncOptionsWithStringEncoding
): SpawnSyncReturns<string> {
  if (!isWindows) {
    return spawnSync(command, args, options);
  }

  const resolved = findBin(command);
  const winCmd = resolveWindowsCmd(resolved, args);
  if (winCmd) {
    return spawnSync(winCmd.bin, winCmd.args, options);
  }

  return spawnSync(resolved ?? command, args, options);
}

let _shellEnvCache: NodeJS.ProcessEnv | undefined;

/**
 * Returns the user's full login-shell environment merged with process.env.
 * process.env always wins on conflicts, so we never lose what we already have.
 * Falls back to process.env if the shell can't be invoked (e.g. Windows).
 * Result is cached after the first call.
 */
export function getUserShellEnv(): NodeJS.ProcessEnv {
  if (isWindows) return process.env;
  if (_shellEnvCache !== undefined) return _shellEnvCache;

  const shell = process.env.SHELL ?? '/bin/sh';
  try {
    const result = spawnSync(shell, ['-l', '-c', 'env -0'], {
      encoding: 'utf8',
      timeout: 5000,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    if (result.status === 0 && result.stdout) {
      const shellEnv: NodeJS.ProcessEnv = {};
      for (const entry of result.stdout.split('\0')) {
        const idx = entry.indexOf('=');
        if (idx > 0) shellEnv[entry.slice(0, idx)] = entry.slice(idx + 1);
      }
      // process.env wins: never lose what we already have, but pick up extras
      _shellEnvCache = { ...shellEnv, ...process.env };
      return _shellEnvCache;
    }
  } catch { /* fall through */ }

  _shellEnvCache = process.env;
  return process.env;
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

import * as platform from './platform';
import { logger } from './logger';

interface Deps {
  commandExists: (name: string) => boolean;
  spawnCommand: typeof platform.spawnCommand;
}

const defaultDeps: Deps = {
  commandExists: (n) => platform.commandExists(n),
  spawnCommand: (c, a, o) => platform.spawnCommand(c, a, o),
};
let deps: Deps = defaultDeps;

/** Test hook: replace the process/PATH helpers. Pass null to restore defaults. */
export function setBetterMcpDeps(d: Partial<Deps> | null): void {
  deps = d ? { ...defaultDeps, ...d } : defaultDeps;
  cached = undefined;
}

export const BETTER_MCP_PACKAGE = '@qelos/better-mcp';

export interface BetterMcpLauncher {
  command: string;
  /** Args placed before the `-c <config>` flag. */
  args: string[];
}

function run(command: string, args: string[], timeout: number) {
  try {
    return deps.spawnCommand(command, args, { encoding: 'utf8', timeout, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch {
    return null;
  }
}

/** Latest published version on npm, or null when the registry can't be reached. */
export function getLatestBetterMcpVersion(): string | null {
  const res = run('npm', ['view', BETTER_MCP_PACKAGE, 'version'], 20000);
  if (!res || res.status !== 0) return null;
  const v = (res.stdout || '').trim().split(/\r?\n/).pop()?.trim();
  return v && /^\d+\.\d+\.\d+/.test(v) ? v : null;
}

/** Globally installed version, or null when not installed. */
export function getInstalledBetterMcpVersion(): string | null {
  const res = run('npm', ['ls', '-g', BETTER_MCP_PACKAGE, '--depth=0', '--json'], 20000);
  if (!res || !res.stdout) return null;
  try {
    const parsed = JSON.parse(res.stdout) as { dependencies?: Record<string, { version?: string }> };
    return parsed.dependencies?.[BETTER_MCP_PACKAGE]?.version ?? null;
  } catch {
    return null;
  }
}

function installLatest(): boolean {
  logger.info(`Installing ${BETTER_MCP_PACKAGE}@latest globally…`);
  const res = run('npm', ['install', '-g', `${BETTER_MCP_PACKAGE}@latest`], 180000);
  if (!res || res.status !== 0) {
    logger.warn(`npm install -g ${BETTER_MCP_PACKAGE}@latest failed${res?.stderr ? `: ${res.stderr.trim()}` : ''}`);
    return false;
  }
  return true;
}

/** True when version `a` is strictly newer than `b` (numeric major.minor.patch compare). */
export function isNewerVersion(a: string, b: string): boolean {
  const parse = (v: string) => v.split(/[-+]/)[0].split('.').map((n) => parseInt(n, 10) || 0);
  const pa = parse(a);
  const pb = parse(b);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d > 0;
  }
  return false;
}

let cached: BetterMcpLauncher | null | undefined;

/** Clears the per-process ensureBetterMcp cache (for tests). */
export function resetBetterMcpCache(): void {
  cached = undefined;
}

/**
 * Makes sure the latest better-mcp is available via node. Installs it globally
 * when missing or known to be outdated; if that fails, falls back to an existing
 * install or to `npx -y @qelos/better-mcp@latest`. Returns null when node tooling
 * is unusable. The result is cached for the process so the blocking npm version
 * checks run at most once.
 */
export function ensureBetterMcp(): BetterMcpLauncher | null {
  if (cached !== undefined) return cached;
  cached = resolveBetterMcp();
  return cached;
}

function resolveBetterMcp(): BetterMcpLauncher | null {
  if (!deps.commandExists('npm')) {
    logger.warn('BETTER_MCP is enabled but npm was not found on PATH.');
    return null;
  }

  const hasBin = deps.commandExists('better-mcp');
  let needsInstall = !hasBin;
  if (hasBin) {
    // Reinstall only when both versions are known and the registry is strictly newer.
    // Unknown installed version (non-npm install, other prefix) or an unreachable
    // registry (offline) leaves the existing binary alone.
    const installed = getInstalledBetterMcpVersion();
    if (installed) {
      const latest = getLatestBetterMcpVersion();
      needsInstall = !!latest && isNewerVersion(latest, installed);
    }
  }

  let usable = hasBin;
  if (needsInstall) usable = installLatest() || hasBin;

  if (usable && deps.commandExists('better-mcp')) return { command: 'better-mcp', args: [] };
  if (deps.commandExists('npx')) {
    logger.warn('Falling back to npx for better-mcp.');
    return { command: 'npx', args: ['-y', `${BETTER_MCP_PACKAGE}@latest`] };
  }
  return null;
}

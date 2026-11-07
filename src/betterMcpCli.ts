import { commandExists, spawnCommand } from './platform';
import { logger } from './logger';

export const BETTER_MCP_PACKAGE = '@qelos/better-mcp';

export interface BetterMcpLauncher {
  command: string;
  /** Args placed before the `-c <config>` flag. */
  args: string[];
}

function run(command: string, args: string[], timeout: number) {
  try {
    return spawnCommand(command, args, { encoding: 'utf8', timeout, stdio: ['ignore', 'pipe', 'pipe'] });
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

/**
 * Makes sure the latest better-mcp is available via node. Installs it globally
 * when missing or outdated; if that fails, falls back to an existing install or
 * to `npx -y @qelos/better-mcp@latest`. Returns null when node tooling is unusable.
 */
export function ensureBetterMcp(): BetterMcpLauncher | null {
  if (!commandExists('npm')) {
    logger.warn('BETTER_MCP is enabled but npm was not found on PATH.');
    return null;
  }

  const hasBin = commandExists('better-mcp');
  const installed = hasBin ? getInstalledBetterMcpVersion() : null;
  const latest = getLatestBetterMcpVersion();

  let usable = hasBin;
  if (!hasBin || (latest && installed !== latest)) {
    if (installLatest()) usable = true;
    else if (!hasBin) usable = false;
  }

  if (usable && commandExists('better-mcp')) return { command: 'better-mcp', args: [] };
  if (commandExists('npx')) {
    logger.warn('Falling back to npx for better-mcp.');
    return { command: 'npx', args: ['-y', `${BETTER_MCP_PACKAGE}@latest`] };
  }
  return null;
}

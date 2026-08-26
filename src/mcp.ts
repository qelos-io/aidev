import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { Config, AgentName } from './types';
import { resolveEnvPath } from './config';
import { logger } from './logger';
import { commandExists, isWindows } from './platform';

export interface McpServerDef {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  url?: string;
  type?: string;
  headers?: Record<string, string>;
  enabled?: boolean;
}

export type McpServers = Record<string, McpServerDef>;

export interface McpState {
  /** Absolute path the generic mcp.json was read from. */
  sourcePath: string;
  /** Effective servers handed to every agent (already better-mcp-wrapped if enabled). */
  servers: McpServers;
  betterMcp: boolean;
  /** Absolute path passed to `claude --mcp-config`. */
  claudeConfigPath: string;
  /** Project-relative paths materialized this run. */
  written: string[];
}

const BETTER_MCP_IMAGE = 'ghcr.io/qelos/better-mcp:latest';

// Patterns aidev-managed MCP files must be covered by. Mirrors the
// GITIGNORE_RULES shape in src/commands/init.ts: [pattern, existing-match regex].
export const MCP_GITIGNORE_RULES: Array<[string, RegExp]> = [
  ['.aidev/mcp/', /^\/?\.aidev\/mcp\/?$/m],
  ['.aidev/better-mcp.json', /^\/?\.aidev\/better-mcp\.json$/m],
  ['.cursor/mcp.json', /^\/?\.cursor\/mcp\.json$/m],
  ['.agents/mcp_config.json', /^\/?\.agents\/mcp_config\.json$/m],
  ['.devin/config.json', /^\/?\.devin\/config\.json$/m],
  ['.codex/config.toml', /^\/?\.codex\/config\.toml$/m],
  ['opencode.json', /^\/?opencode\.json$/m],
  ['*.aidev-backup', /^\*\.aidev-backup$/m],
];

/**
 * Ensures .gitignore covers every MCP-managed file pattern. Self-contained
 * (does not depend on src/commands/init.ts) so this module and init.ts can
 * import from each other's rule lists without a circular require. init.ts
 * merges MCP_GITIGNORE_RULES into its own ensureGitignore() for `aidev init`;
 * this is the equivalent applied by materializeMcp() on every run.
 */
export function ensureMcpGitignore(dir = process.cwd()): void {
  const gitignorePath = path.join(dir, '.gitignore');
  const existing = fs.existsSync(gitignorePath) ? fs.readFileSync(gitignorePath, 'utf8') : '';

  const missing = MCP_GITIGNORE_RULES
    .filter(([, regex]) => !regex.test(existing))
    .map(([pattern]) => pattern);
  if (missing.length === 0) return;

  const addition = (existing.endsWith('\n') || existing === '' ? '' : '\n') + missing.join('\n') + '\n';
  fs.writeFileSync(gitignorePath, existing + addition, 'utf8');
  logger.info(`.gitignore — added: ${missing.join(', ')}`);
}

let mcpState: McpState | null = null;

/** The state materialized by the most recent materializeMcp() call in this process, or null. */
export function getMcpState(): McpState | null {
  return mcpState;
}

/** Test seam — lets runner tests simulate an active/inactive MCP state without touching disk. */
export function setMcpState(state: McpState | null): void {
  mcpState = state;
}

/** Resolves MCP_JSON_PATH, or auto-discovers .agents/mcp.json then .aidev/mcp.json. Null when none apply. */
export function resolveMcpJsonPath(config: Config, cwd = process.cwd()): string | null {
  const raw = (config.mcpJsonPath || '').trim();
  if (raw) return resolveEnvPath(raw, cwd);

  const candidates = [path.join(cwd, '.agents', 'mcp.json'), path.join(cwd, '.aidev', 'mcp.json')];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

/** Reads and parses a generic mcp.json ({"mcpServers": {...}}). Throws a clear Error on bad JSON. */
export function readMcpServers(absPath: string): McpServers {
  if (!fs.existsSync(absPath)) {
    throw new Error(`MCP config not found: ${absPath}`);
  }
  const raw = fs.readFileSync(absPath, 'utf8');
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to parse MCP config at ${absPath}: ${message}`);
  }
  const servers = (parsed as { mcpServers?: unknown })?.mcpServers;
  if (!servers || typeof servers !== 'object' || Array.isArray(servers)) {
    throw new Error(`MCP config at ${absPath} must contain an "mcpServers" object`);
  }
  return servers as McpServers;
}

/**
 * Merges `servers` into a user-authored better-mcp base config, preserving any
 * other keys (notably `middleware`) and forcing `namespace: true`.
 */
export function buildBetterMcpConfig(base: unknown, servers: McpServers): Record<string, unknown> {
  const baseObj = base && typeof base === 'object' ? (base as Record<string, unknown>) : {};
  return { ...baseObj, mcpServers: servers, namespace: true };
}

/**
 * Converts an absolute path to a Docker-mountable path (POSIX-ish on Windows).
 * `windows` defaults to the real platform check but is overridable so tests
 * can exercise the Windows branch on any host.
 */
export function toDockerMountPath(absPath: string, windows = isWindows): string {
  if (!windows) return absPath;
  const match = /^([A-Za-z]):\\(.*)$/.exec(absPath);
  if (!match) return absPath.replace(/\\/g, '/');
  const drive = match[1].toLowerCase();
  const rest = match[2].replace(/\\/g, '/');
  return `/${drive}/${rest}`;
}

/** The single-entry server map every agent gets when better-mcp mode is active. */
export function betterMcpProxyServers(betterMcpConfigAbsPath: string): McpServers {
  const mountPath = toDockerMountPath(betterMcpConfigAbsPath);
  return {
    'better-mcp': {
      command: 'docker',
      args: ['run', '--rm', '-i', '-v', `${mountPath}:/app/mcp.json:ro`, BETTER_MCP_IMAGE],
    },
  };
}

/** {"mcpServers": {...}} — used by claude, cursor, antigravity. */
export function toStandardJson(servers: McpServers): string {
  return JSON.stringify({ mcpServers: servers }, null, 2) + '\n';
}

/** .devin/config.json — {"mcpServers": {...}, "permissions": {...}}. */
export function toDevinJson(servers: McpServers, existing?: unknown): string {
  const existingObj = existing && typeof existing === 'object' ? (existing as Record<string, unknown>) : {};
  const permissions = (existingObj.permissions as object) ?? { allow: [], deny: [], ask: [] };
  return JSON.stringify({ ...existingObj, mcpServers: servers, permissions }, null, 2) + '\n';
}

/**
 * opencode.json — renames mcpServers -> mcp, collapses command+args into a
 * single array, and infers local vs remote from the presence of `url`.
 * Preserves every other top-level key from an existing file (e.g. $schema).
 */
export function toOpencodeJson(servers: McpServers, existing?: unknown): string {
  const existingObj = existing && typeof existing === 'object' ? (existing as Record<string, unknown>) : {};
  const mcp: Record<string, unknown> = {};
  for (const [name, def] of Object.entries(servers)) {
    if (def.url) {
      mcp[name] = { type: 'remote', url: def.url, enabled: def.enabled ?? true };
    } else {
      mcp[name] = {
        type: 'local',
        command: [def.command, ...(def.args ?? [])].filter(Boolean),
        ...(def.env ? { environment: def.env } : {}),
        enabled: def.enabled ?? true,
      };
    }
  }
  const out: Record<string, unknown> = {
    $schema: 'https://opencode.ai/config.json',
    ...existingObj,
    mcp,
  };
  return JSON.stringify(out, null, 2) + '\n';
}

function tomlString(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function tomlStringArray(values: string[]): string {
  return `[${values.map(tomlString).join(', ')}]`;
}

function tomlInlineTable(obj: Record<string, string>): string {
  const entries = Object.entries(obj).map(([k, v]) => `${tomlString(k)} = ${tomlString(v)}`);
  return `{ ${entries.join(', ')} }`;
}

/**
 * .codex/config.toml — [mcp_servers.<name>] tables, scoped to the project
 * (codex layers .codex/config.toml found walking up to the project root on
 * top of ~/.codex/config.toml; this requires the directory to be trusted).
 * Table keys are always quoted so server names with dots/spaces/hyphens stay
 * valid TOML. `env` values are written literally, same as every other agent.
 */
export function toCodexToml(servers: McpServers): string {
  const blocks: string[] = [];
  for (const [name, def] of Object.entries(servers)) {
    const lines = [`[mcp_servers.${tomlString(name)}]`];
    if (def.url) {
      lines.push(`url = ${tomlString(def.url)}`);
    } else if (def.command) {
      lines.push(`command = ${tomlString(def.command)}`);
      if (def.args?.length) lines.push(`args = ${tomlStringArray(def.args)}`);
    }
    if (def.env && Object.keys(def.env).length > 0) {
      lines.push(`env = ${tomlInlineTable(def.env)}`);
    }
    blocks.push(lines.join('\n'));
  }
  return blocks.join('\n\n') + (blocks.length ? '\n' : '');
}

function readJsonIfExists(absPath: string): unknown {
  if (!fs.existsSync(absPath)) return undefined;
  try {
    return JSON.parse(fs.readFileSync(absPath, 'utf8'));
  } catch {
    return undefined;
  }
}

function sha256(content: string): string {
  return crypto.createHash('sha256').update(content).digest('hex');
}

function manifestPath(cwd: string): string {
  return path.join(cwd, '.aidev', 'mcp', 'manifest.json');
}

/** relPath -> sha256 of the content aidev itself last wrote there. */
function readManifest(cwd: string): Record<string, string> {
  const p = manifestPath(cwd);
  if (!fs.existsSync(p)) return {};
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return {};
  }
}

function writeManifest(cwd: string, manifest: Record<string, string>): void {
  const p = manifestPath(cwd);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
}

/**
 * Writes an aidev-managed file, backing up any pre-existing content ONCE as
 * `<name>.aidev-backup` — but only when that content wasn't itself written by
 * aidev on a previous run (tracked via `manifest`), so re-running never backs
 * up aidev's own prior output as if it were a hand-authored file.
 */
function writeFile(cwd: string, relPath: string, content: string, manifest: Record<string, string>): void {
  const absPath = path.join(cwd, relPath);
  if (fs.existsSync(absPath)) {
    const current = sha256(fs.readFileSync(absPath, 'utf8'));
    if (manifest[relPath] !== current) {
      const backupPath = `${absPath}.aidev-backup`;
      if (!fs.existsSync(backupPath)) {
        fs.copyFileSync(absPath, backupPath);
        logger.warn(`${relPath} was not written by aidev — backed up to ${relPath}.aidev-backup before overwriting.`);
      }
    }
  }
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  fs.writeFileSync(absPath, content, 'utf8');
  manifest[relPath] = sha256(content);
}

const CONTAINER_SAFE_COMMANDS = new Set(['node', 'npx']);

function warnIfNotContainerSafe(servers: McpServers): void {
  for (const [name, def] of Object.entries(servers)) {
    if (def.command && !CONTAINER_SAFE_COMMANDS.has(def.command)) {
      logger.warn(
        `MCP server "${name}" uses command "${def.command}", which is not guaranteed to exist inside ` +
        `the better-mcp Docker image (only node/npx are). It may fail to start.`,
      );
    }
  }
}

/**
 * Resolves the generic mcp.json, applies better-mcp wrapping if configured,
 * writes the per-agent convention files for every agent in config.agents, and
 * ensures they're gitignored. Returns null when no mcp.json applies. Idempotent.
 */
export function materializeMcp(config: Config, cwd = process.cwd()): McpState | null {
  const sourcePath = resolveMcpJsonPath(config, cwd);
  if (!sourcePath) return (mcpState = null);

  const rawServers = readMcpServers(sourcePath);
  const claudeConfigPath = path.join(cwd, '.aidev', 'mcp', 'claude.json');
  const written: string[] = [];
  const manifest = readManifest(cwd);

  let effectiveServers = rawServers;
  const betterMcp = !!config.betterMcp;

  if (betterMcp) {
    if (!commandExists('docker')) {
      logger.warn('BETTER_MCP is enabled but docker was not found on PATH — falling back to raw MCP servers.');
    } else {
      warnIfNotContainerSafe(rawServers);
      const betterMcpConfigRel = config.betterMcpConfigPath || path.join('.aidev', 'better-mcp.json');
      const betterMcpConfigAbs = resolveEnvPath(betterMcpConfigRel, cwd);
      const existingBase = readJsonIfExists(betterMcpConfigAbs);
      const merged = buildBetterMcpConfig(existingBase, rawServers);
      fs.mkdirSync(path.dirname(betterMcpConfigAbs), { recursive: true });
      fs.writeFileSync(betterMcpConfigAbs, JSON.stringify(merged, null, 2) + '\n', 'utf8');
      written.push(path.relative(cwd, betterMcpConfigAbs));
      effectiveServers = betterMcpProxyServers(betterMcpConfigAbs);
    }
  }

  const agents = new Set<AgentName>(config.agents);

  if (agents.has('claude')) {
    writeFile(cwd, path.join('.aidev', 'mcp', 'claude.json'), toStandardJson(effectiveServers), manifest);
    written.push(path.join('.aidev', 'mcp', 'claude.json'));
  }
  if (agents.has('cursor')) {
    writeFile(cwd, path.join('.cursor', 'mcp.json'), toStandardJson(effectiveServers), manifest);
    written.push(path.join('.cursor', 'mcp.json'));
  }
  if (agents.has('antigravity')) {
    writeFile(cwd, path.join('.agents', 'mcp_config.json'), toStandardJson(effectiveServers), manifest);
    written.push(path.join('.agents', 'mcp_config.json'));
  }
  if (agents.has('devin')) {
    const existing = readJsonIfExists(path.join(cwd, '.devin', 'config.json'));
    writeFile(cwd, path.join('.devin', 'config.json'), toDevinJson(effectiveServers, existing), manifest);
    written.push(path.join('.devin', 'config.json'));
  }
  if (agents.has('opencode')) {
    const existing = readJsonIfExists(path.join(cwd, 'opencode.json'));
    writeFile(cwd, 'opencode.json', toOpencodeJson(effectiveServers, existing), manifest);
    written.push('opencode.json');
  }
  if (agents.has('codex')) {
    writeFile(cwd, path.join('.codex', 'config.toml'), toCodexToml(effectiveServers), manifest);
    written.push(path.join('.codex', 'config.toml'));
  }
  if (agents.has('aider')) {
    logger.debug('aider has no MCP support — skipping MCP injection for this agent.');
  }

  writeManifest(cwd, manifest);
  ensureMcpGitignore(cwd);

  mcpState = { sourcePath, servers: effectiveServers, betterMcp, claudeConfigPath, written };
  logger.info(`MCP config from ${sourcePath} — materialized: ${written.join(', ') || '(none)'}`);
  return mcpState;
}

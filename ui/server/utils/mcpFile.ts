import { createError } from 'h3';
import { createRequire } from 'node:module';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { readEnvFile } from './envFile';

// Mirrors src/mcp.ts:McpServerDef — re-declared so Nitro doesn't import out of dist's d.ts.
export interface UiMcpServerDef {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  url?: string;
  type?: string;
  headers?: Record<string, string>;
  enabled?: boolean;
}

export type UiMcpServers = Record<string, UiMcpServerDef>;

export interface McpFileResult {
  path: string;
  exists: boolean;
  servers: UiMcpServers;
  betterMcp: boolean;
  betterMcpConfigPath: string;
}

interface McpModule {
  resolveMcpJsonPath: (config: { mcpJsonPath: string }, cwd?: string) => string | null;
  readMcpServers: (absPath: string) => UiMcpServers;
}

function getDistDir(): string {
  const pkgDir = process.env.AIDEV_PACKAGE_DIR;
  if (!pkgDir) {
    throw createError({ statusCode: 500, statusMessage: 'AIDEV_PACKAGE_DIR not set' });
  }
  const dist = path.join(pkgDir, 'dist');
  if (!fs.existsSync(dist)) {
    throw createError({
      statusCode: 503,
      statusMessage:
        `aidev build artifacts not found at ${dist}. ` +
        `Run \`npm run build\` in the aidev repo before using the dashboard.`,
    });
  }
  return dist;
}

function loadMcpModule(): McpModule {
  const pkgDir = process.env.AIDEV_PACKAGE_DIR as string;
  const dist = getDistDir();
  // Same createRequire bridge used by provider.ts / config/test.post.ts — resolves
  // the installed aidev package's compiled dist so the UI and CLI never drift.
  const req = createRequire(path.join(pkgDir, 'package.json'));
  return req(path.join(dist, 'mcp')) as McpModule;
}

function betterMcpFromRaw(values: Record<string, string>): boolean {
  return ['true', '1', 'yes'].includes((values.BETTER_MCP || '').trim().toLowerCase());
}

/** Reads the resolved mcp.json (MCP_JSON_PATH or auto-discovered) plus the better-mcp flags from .env.aidev. */
export function readMcpFile(cwd: string): McpFileResult {
  const env = readEnvFile(cwd);
  const mcp = loadMcpModule();

  const mcpJsonPath = env.values.MCP_JSON_PATH || '';
  const betterMcp = betterMcpFromRaw(env.values);
  const betterMcpConfigPath = env.values.BETTER_MCP_CONFIG_PATH || '';

  const resolved = mcp.resolveMcpJsonPath({ mcpJsonPath }, cwd);
  const filePath = resolved ?? path.join(cwd, '.aidev', 'mcp.json');
  if (!resolved || !fs.existsSync(resolved)) {
    return { path: filePath, exists: false, servers: {}, betterMcp, betterMcpConfigPath };
  }

  const servers = mcp.readMcpServers(resolved);
  return { path: filePath, exists: true, servers, betterMcp, betterMcpConfigPath };
}

/** Writes `servers` to the resolved mcp.json path, creating parent directories as needed. */
export function writeMcpFile(cwd: string, servers: UiMcpServers): McpFileResult {
  const env = readEnvFile(cwd);
  const mcp = loadMcpModule();
  const mcpJsonPath = env.values.MCP_JSON_PATH || '';

  const resolved = mcp.resolveMcpJsonPath({ mcpJsonPath }, cwd) ?? path.join(cwd, '.aidev', 'mcp.json');
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  fs.writeFileSync(resolved, JSON.stringify({ mcpServers: servers }, null, 2) + '\n', 'utf8');

  return readMcpFile(cwd);
}

export function assertMcpServersShape(value: unknown): asserts value is UiMcpServers {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw createError({ statusCode: 400, statusMessage: 'Body must be { servers: Record<string, McpServerDef> }' });
  }
  for (const [name, def] of Object.entries(value as Record<string, unknown>)) {
    if (!def || typeof def !== 'object' || Array.isArray(def)) {
      throw createError({ statusCode: 400, statusMessage: `Server "${name}" must be an object` });
    }
  }
}

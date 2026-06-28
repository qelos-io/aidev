import * as fs from 'node:fs';
import * as path from 'node:path';
import * as readline from 'node:readline/promises';
import chalk from 'chalk';
import { logger } from './logger';
import { commandExists } from './platform';

const CLAUDE_SETTINGS_LOCAL = '.claude/settings.local.json';
const CLAUDE_SETTINGS_PROJECT = '.claude/settings.json';

const REQUIRED_CLAUDE_PERMISSIONS: readonly string[] = [
  'Bash(git:*)',
  'Bash(npm:*)',
  'Bash(npx:*)',
  'Bash(node:*)',
  'Bash(python:*)',
  'Bash(tsc:*)',
];

interface ClaudeSettings {
  permissions?: {
    allow?: string[];
    deny?: string[];
  };
  [key: string]: unknown;
}

/**
 * Returns true if `existing` permission covers `required`.
 * e.g. "Bash(npm:*)" covers "Bash(npm install:*)" because the command
 * prefix "npm" is a word-boundary prefix of "npm install".
 */
export function permissionCovers(existing: string, required: string): boolean {
  if (existing === required) return true;

  const existingMatch = existing.match(/^(\w+)\((.+)\)$/);
  const requiredMatch = required.match(/^(\w+)\((.+)\)$/);

  if (!existingMatch || !requiredMatch) return existing === required;

  const [, existingTool, existingPattern] = existingMatch;
  const [, requiredTool, requiredPattern] = requiredMatch;

  if (existingTool !== requiredTool) return false;
  if (existingPattern === '*') return true;

  const existingCmd = existingPattern.replace(/:?\*$/, '');
  const requiredCmd = requiredPattern.replace(/:?\*$/, '');

  if (existingCmd === requiredCmd) return true;
  if (requiredCmd.startsWith(existingCmd + ' ')) return true;

  return false;
}

export function readClaudeSettings(dir: string): ClaudeSettings {
  const files = [
    path.join(dir, CLAUDE_SETTINGS_PROJECT),
    path.join(dir, CLAUDE_SETTINGS_LOCAL),
  ];

  const merged: ClaudeSettings = {};
  for (const file of files) {
    if (!fs.existsSync(file)) continue;
    try {
      const data = JSON.parse(fs.readFileSync(file, 'utf8')) as ClaudeSettings;
      if (data.permissions?.allow) {
        if (!merged.permissions) merged.permissions = {};
        if (!merged.permissions.allow) merged.permissions.allow = [];
        merged.permissions.allow.push(...data.permissions.allow);
      }
    } catch {
      // skip unreadable files
    }
  }
  return merged;
}

export function getMissingPermissions(
  required: readonly string[],
  allowed: string[]
): string[] {
  return required.filter(
    (req) => !allowed.some((existing) => permissionCovers(existing, req))
  );
}

function readLocalSettings(dir: string): ClaudeSettings {
  const filePath = path.join(dir, CLAUDE_SETTINGS_LOCAL);
  if (!fs.existsSync(filePath)) return {};
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8')) as ClaudeSettings;
  } catch {
    return {};
  }
}

function writeLocalSettings(dir: string, settings: ClaudeSettings): void {
  const filePath = path.join(dir, CLAUDE_SETTINGS_LOCAL);
  const dirPath = path.dirname(filePath);
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
  fs.writeFileSync(filePath, JSON.stringify(settings, null, 2) + '\n', 'utf8');
}

// ── Claude ────────────────────────────────────────────────────────────────

async function validateClaudePermissions(
  rl: readline.Interface,
  dir: string
): Promise<void> {
  if (!commandExists('claude')) {
    logger.warn('Claude CLI not found — skipping permission check.');
    return;
  }

  const merged = readClaudeSettings(dir);
  const allowed = merged.permissions?.allow ?? [];
  const missing = getMissingPermissions(REQUIRED_CLAUDE_PERMISSIONS, allowed);

  if (missing.length === 0) {
    logger.info('Claude: all required permissions are configured.');
    return;
  }

  console.log(`\n  ${chalk.yellow('Claude is missing required tool permissions:')}`);
  missing.forEach((p) => console.log(`    ${chalk.dim('•')} ${p}`));

  const raw = await rl.question(
    `\n  Add them to ${chalk.cyan(CLAUDE_SETTINGS_LOCAL)}? ${chalk.dim('[Y/n]')}: `
  );

  if (raw.trim().toLowerCase() === 'n') {
    logger.warn('Skipped Claude permission setup — Claude may prompt for approval during tasks.');
    return;
  }

  const local = readLocalSettings(dir);
  if (!local.permissions) local.permissions = {};
  if (!local.permissions.allow) local.permissions.allow = [];
  local.permissions.allow.push(...missing);

  writeLocalSettings(dir, local);
  logger.success(`Added ${missing.length} permission(s) to ${CLAUDE_SETTINGS_LOCAL}`);
}

// ── Cursor ────────────────────────────────────────────────────────────────

async function validateCursorPermissions(
  _rl: readline.Interface,
  _dir: string
): Promise<void> {
  if (!commandExists('agent')) {
    logger.warn(
      'Cursor Agent CLI (agent) not found — install it from Cursor settings ' +
      'or ensure it is on your PATH.'
    );
    return;
  }

  logger.info('Cursor: agent CLI found (uses --trust flag, no additional permissions needed).');
}

// ── Antigravity ────────────────────────────────────────────────────────────

async function validateAntigravityPermissions(
  _rl: readline.Interface,
  _dir: string
): Promise<void> {
  if (!commandExists('agy') && !commandExists('antigravity')) {
    logger.warn(
      'Antigravity CLI (agy or antigravity) not found — install from ' +
      'antigravity.google/download or ensure it is on your PATH.'
    );
    return;
  }

  logger.info('Antigravity: CLI found (no additional permissions needed).');
}

// ── Anthropic Agent SDK ────────────────────────────────────────────────────

async function validateAnthropicSdkPermissions(
  _rl: readline.Interface,
  _dir: string
): Promise<void> {
  let sdkInstalled = true;
  try {
    require.resolve('@anthropic-ai/claude-agent-sdk');
  } catch {
    sdkInstalled = false;
  }

  if (!sdkInstalled) {
    logger.warn(
      'Anthropic Agent SDK not found — install with: npm install @anthropic-ai/claude-agent-sdk'
    );
  }

  const tokens = (process.env.ANTHROPIC_API_KEY || '')
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);

  if (tokens.length === 0) {
    logger.warn(
      'anthropic-sdk: no ANTHROPIC_API_KEY configured — set one (or a comma-separated pool) in .env.aidev.'
    );
    return;
  }

  if (sdkInstalled) {
    logger.info(
      `anthropic-sdk: SDK installed, ${tokens.length} API key${tokens.length === 1 ? '' : 's'} configured.`
    );
  }
}

// ── Codex ──────────────────────────────────────────────────────────────────

async function validateCodexPermissions(
  _rl: readline.Interface,
  _dir: string
): Promise<void> {
  if (!commandExists('codex')) {
    logger.warn(
      'Codex CLI not found — install with: npm install -g @openai/codex. ' +
      'Set OPENAI_API_KEY or run codex login.'
    );
    return;
  }

  logger.info('Codex: CLI found (codex exec, no additional permissions needed).');
}

// ── OpenCode ─────────────────────────────────────────────────────────────────

async function validateOpencodePermissions(
  _rl: readline.Interface,
  _dir: string
): Promise<void> {
  if (!commandExists('opencode')) {
    logger.warn(
      'OpenCode CLI not found — install with: npm install -g opencode-ai. ' +
      'Set OPENCODE_CONFIG_DIR to use a custom config directory.'
    );
    return;
  }

  logger.info('OpenCode: CLI found (opencode run, no additional permissions needed).');
}

// ── Public API ────────────────────────────────────────────────────────────

export async function validateAgentPermissions(
  agents: string[],
  rl: readline.Interface,
  dir = process.cwd()
): Promise<void> {
  for (const agent of agents) {
    if (agent === 'claude') {
      await validateClaudePermissions(rl, dir);
    } else if (agent === 'cursor') {
      await validateCursorPermissions(rl, dir);
    } else if (agent === 'antigravity') {
      await validateAntigravityPermissions(rl, dir);
    } else if (agent === 'codex') {
      await validateCodexPermissions(rl, dir);
    } else if (agent === 'opencode') {
      await validateOpencodePermissions(rl, dir);
    } else if (agent === 'anthropic-sdk') {
      await validateAnthropicSdkPermissions(rl, dir);
    }
  }
}

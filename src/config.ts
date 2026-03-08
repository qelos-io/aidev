import * as dotenv from 'dotenv';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { spawnSync } from 'node:child_process';
import { Config, AgentName } from './types';
import { detectRemote } from './git';

export function mergeNullDelimited(stdout: string): void {
  for (const entry of stdout.split('\0')) {
    const eq = entry.indexOf('=');
    if (eq === -1) continue;
    const key = entry.slice(0, eq);
    const val = entry.slice(eq + 1);
    if (key && !(key in process.env)) {
      process.env[key] = val;
    }
  }
}

// profiles: list of rc file paths to source (injectable for tests; defaults to platform standard files)
export function sourceShellProfile(profiles?: string[]): void {
  const platform = process.platform;

  if (platform === 'darwin' || platform === 'linux') {
    const shell = platform === 'darwin' ? 'zsh' : (process.env.SHELL || 'bash');
    const defaultProfiles =
      platform === 'darwin'
        ? ['~/.zprofile', '~/.zshrc']
        : ['~/.profile', '~/.bash_profile', '~/.bashrc'];
    const paths = profiles ?? defaultProfiles;
    // Pass paths as positional args — no shell interpolation of path strings
    const script = 'for f in "$@"; do source "$f" 2>/dev/null; done; env -0';
    const result = spawnSync(shell, ['-c', script, '--', ...paths], {
      encoding: 'utf8',
      env: process.env,
    });
    if (result.status === 0 && result.stdout) mergeNullDelimited(result.stdout);
    return;
  }

  if (platform === 'win32') {
    // Read user-level env vars from the registry via PowerShell
    const ps =
      '[System.Environment]::GetEnvironmentVariables("User").GetEnumerator() | ' +
      'ForEach-Object { [System.Text.Encoding]::UTF8.GetBytes($_.Key + "=" + $_.Value + [char]0) | ' +
      '[System.Console]::OpenStandardOutput().Write($_, 0, $_.Length) }';
    const result = spawnSync('powershell', ['-NoProfile', '-Command', ps], {
      encoding: 'buffer',
      env: process.env,
    });
    if (result.status === 0 && result.stdout) mergeNullDelimited(result.stdout.toString('utf8'));
  }
}

/**
 * Merges env vars from a global extend file and a local project file into
 * process.env.  Priority order (highest → lowest):
 *   1. process.env (already-set shell variables — never overwritten)
 *   2. local .env.aidev values
 *   3. AIDEV_ENV_EXTEND file values (global base)
 *
 * `envExtend` can be supplied explicitly (e.g. from process.env.AIDEV_ENV_EXTEND
 * set by sourceShellProfile) OR discovered inside the local file itself.
 */
/**
 * Resolves a path that may be absolute, `~/…`, or relative.
 * Relative paths are resolved against `relativeBase` (the directory of the
 * local env file, or CWD when the path comes from the shell environment).
 */
export function resolveEnvPath(rawPath: string, relativeBase: string): string {
  if (rawPath.startsWith('~/') || rawPath === '~') {
    return path.join(os.homedir(), rawPath.slice(2));
  }
  if (path.isAbsolute(rawPath)) return rawPath;
  return path.resolve(relativeBase, rawPath);
}

export function applyEnvFiles(localPath: string | undefined, envExtend?: string): void {
  const localVars: Record<string, string> =
    localPath && fs.existsSync(localPath)
      ? dotenv.parse(fs.readFileSync(localPath, 'utf8'))
      : {};

  // Extend path: caller-supplied wins, then local file's own AIDEV_ENV_EXTEND entry
  const rawExtend = envExtend || localVars['AIDEV_ENV_EXTEND'] || '';
  // Relative paths in local file resolve against the local file's directory;
  // paths from shell env resolve against CWD.
  const extendBase = localPath ? path.dirname(localPath) : process.cwd();
  const extendPath = rawExtend ? resolveEnvPath(rawExtend, extendBase) : '';

  const extendVars: Record<string, string> =
    extendPath && fs.existsSync(extendPath)
      ? dotenv.parse(fs.readFileSync(extendPath, 'utf8'))
      : {};

  // local overrides extend; neither overrides already-set process.env values
  const merged = { ...extendVars, ...localVars };
  for (const [key, val] of Object.entries(merged)) {
    if (!(key in process.env)) {
      process.env[key] = val;
    }
  }
}

export function loadConfig(customEnvPath?: string): Config {
  sourceShellProfile();

  const envPath = customEnvPath
    ? path.resolve(customEnvPath)
    : path.join(process.cwd(), '.env.aidev');

  if (customEnvPath && !fs.existsSync(envPath)) {
    throw new Error(`Env file not found: ${envPath}`);
  }

  applyEnvFiles(
    fs.existsSync(envPath) ? envPath : undefined,
    process.env.AIDEV_ENV_EXTEND
  );

  const provider = (process.env.PROVIDER || 'clickup').toLowerCase();

  const required =
    provider === 'jira'
      ? ['JIRA_BASE_URL', 'JIRA_EMAIL', 'JIRA_API_TOKEN', 'JIRA_PROJECT']
      : ['CLICKUP_API_KEY', 'CLICKUP_TEAM_ID', 'CLICKUP_TAG'];
  for (const key of required) {
    if (!process.env[key]) {
      throw new Error(`Missing required config: ${key}. Run 'aidev init' to create .env.aidev`);
    }
  }

  const validAgents: AgentName[] = ['claude', 'cursor', 'windsurf'];
  const agentsRaw = process.env.AGENTS || 'claude,cursor';
  const agents = agentsRaw
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean) as AgentName[];
  const invalid = agents.filter((a) => !validAgents.includes(a));
  if (invalid.length) {
    throw new Error(`Invalid agent(s): ${invalid.join(', ')}. Valid: ${validAgents.join(', ')}`);
  }
  if (agents.length === 0) {
    throw new Error(`AGENTS must contain at least one agent. Valid: ${validAgents.join(', ')}`);
  }

  const devNotesMode = (process.env.DEV_NOTES_MODE || 'smart') as Config['devNotesMode'];
  if (!['smart', 'always'].includes(devNotesMode)) {
    throw new Error(`Invalid DEV_NOTES_MODE: ${devNotesMode}. Must be smart or always`);
  }

  const triggerWord = process.env.AIDEV_TRIGGER_WORD || 'aidev-continue';
  const thinkingTag = process.env.THINKING_TAG || '';
  const nonCodeTag = process.env.NON_CODE_TAG || '';

  return {
    provider,
    clickupApiKey: process.env.CLICKUP_API_KEY || '',
    clickupTeamId: process.env.CLICKUP_TEAM_ID || '',
    clickupTag: process.env.CLICKUP_TAG || '',
    clickupPendingStatus: process.env.CLICKUP_PENDING_STATUS || 'pending',
    clickupInReviewStatus: process.env.CLICKUP_IN_REVIEW_STATUS || 'review',
    nonCodeTag,
    nonCodeClickupTeamId: process.env.NON_CODE_CLICKUP_TEAM_ID || '',
    nonCodeJiraProject: process.env.NON_CODE_JIRA_PROJECT || '',
    jiraBaseUrl: process.env.JIRA_BASE_URL || '',
    jiraEmail: process.env.JIRA_EMAIL || '',
    jiraApiToken: process.env.JIRA_API_TOKEN || '',
    jiraProject: process.env.JIRA_PROJECT || '',
    jiraLabel: process.env.JIRA_LABEL || '',
    jiraPendingStatus: process.env.JIRA_PENDING_STATUS || 'To Do',
    jiraInReviewStatus: process.env.JIRA_IN_REVIEW_STATUS || 'In Review',
    assigneeTag: process.env.ASSIGNEE_TAG || '',
    gitRemote: process.env.GIT_REMOTE || detectRemote() || 'origin',
    githubBaseBranch: process.env.GITHUB_BASE_BRANCH || 'main',
    githubRepo: process.env.GITHUB_REPO || '',
    agents,
    devNotesMode,
    triggerWord,
    thinkingTag,
  };
}

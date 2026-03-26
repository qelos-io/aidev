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

  const folderName = path.basename(process.cwd());

  const required =
    provider === 'local'
      ? []
      : provider === 'jira'
        ? ['JIRA_BASE_URL', 'JIRA_EMAIL', 'JIRA_API_TOKEN', 'JIRA_PROJECT']
        : provider === 'linear'
          ? ['LINEAR_API_KEY', 'LINEAR_TEAM_ID']
          : provider === 'monday'
            ? ['MONDAY_API_TOKEN', 'MONDAY_BOARD_ID', 'MONDAY_STATUS_COLUMN_ID']
            : provider === 'notion'
              ? ['NOTION_API_KEY', 'NOTION_DATABASE_ID']
              : provider === 'trello'
                ? ['TRELLO_API_KEY', 'TRELLO_TOKEN', 'TRELLO_BOARD_ID']
                : ['CLICKUP_API_KEY', 'CLICKUP_TEAM_ID'];
  for (const key of required) {
    if (!process.env[key]) {
      throw new Error(`Missing required config: ${key}. Run 'aidev init' to create .env.aidev`);
    }
  }

  const validAgents: AgentName[] = ['antigravity', 'claude', 'codex', 'cursor', 'windsurf'];
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
  const commentPrefix = process.env.AIDEV_COMMENT_PREFIX || '[aidev]';
  const nonCodeTag = process.env.NON_CODE_TAG || `${folderName}-other`;
  const hooksPath = process.env.AIDEV_HOOKS_PATH || '';

  return {
    provider,
    clickupApiKey: process.env.CLICKUP_API_KEY || '',
    clickupTeamId: process.env.CLICKUP_TEAM_ID || '',
    clickupTag: process.env.CLICKUP_TAG || folderName,
    clickupPendingStatus: process.env.CLICKUP_PENDING_STATUS || 'pending',
    clickupOpenStatus: process.env.CLICKUP_OPEN_STATUS || 'open',
    clickupInReviewStatus: process.env.CLICKUP_IN_REVIEW_STATUS || 'review',
    nonCodeTag,
    nonCodeClickupTeamId: process.env.NON_CODE_CLICKUP_TEAM_ID || '',
    nonCodeJiraProject: process.env.NON_CODE_JIRA_PROJECT || '',
    nonCodeLinearTeamId: process.env.NON_CODE_LINEAR_TEAM_ID || '',
    jiraBaseUrl: process.env.JIRA_BASE_URL || '',
    jiraEmail: process.env.JIRA_EMAIL || '',
    jiraApiToken: process.env.JIRA_API_TOKEN || '',
    jiraProject: process.env.JIRA_PROJECT || '',
    jiraLabel: process.env.JIRA_LABEL || folderName,
    jiraPendingStatus: process.env.JIRA_PENDING_STATUS || 'To Do',
    jiraInReviewStatus: process.env.JIRA_IN_REVIEW_STATUS || 'In Review',
    linearApiKey: process.env.LINEAR_API_KEY || '',
    linearTeamId: process.env.LINEAR_TEAM_ID || '',
    linearLabel: process.env.LINEAR_LABEL || folderName,
    linearPendingStatus: process.env.LINEAR_PENDING_STATUS || 'Backlog',
    linearInReviewStatus: process.env.LINEAR_IN_REVIEW_STATUS || 'In Review',
    mondayApiToken: process.env.MONDAY_API_TOKEN || '',
    mondayBoardId: process.env.MONDAY_BOARD_ID || '',
    mondayStatusColumnId: process.env.MONDAY_STATUS_COLUMN_ID || 'status',
    mondayGroupId: process.env.MONDAY_GROUP_ID || '',
    notionApiKey: process.env.NOTION_API_KEY || '',
    notionDatabaseId: process.env.NOTION_DATABASE_ID || '',
    notionStatusProperty: process.env.NOTION_STATUS_PROPERTY || 'Status',
    notionPendingStatus: process.env.NOTION_PENDING_STATUS || 'pending',
    notionInReviewStatus: process.env.NOTION_IN_REVIEW_STATUS || 'review',
    trelloApiKey: process.env.TRELLO_API_KEY || '',
    trelloToken: process.env.TRELLO_TOKEN || '',
    trelloBoardId: process.env.TRELLO_BOARD_ID || '',
    trelloLabel: process.env.TRELLO_LABEL || folderName,
    trelloOpenList: process.env.TRELLO_OPEN_LIST || 'To Do',
    trelloPendingList: process.env.TRELLO_PENDING_LIST || 'Blocked',
    trelloInProgressList: process.env.TRELLO_IN_PROGRESS_LIST || 'Doing',
    trelloInReviewList: process.env.TRELLO_IN_REVIEW_LIST || 'In Review',
    trelloOpenStatus: process.env.TRELLO_OPEN_STATUS || 'open',
    trelloPendingStatus: process.env.TRELLO_PENDING_STATUS || 'pending',
    trelloInReviewStatus: process.env.TRELLO_IN_REVIEW_STATUS || 'review',
    clickupListId: process.env.CLICKUP_LIST_ID || '',
    assigneeTag: process.env.ASSIGNEE_TAG || '',
    gitRemote: process.env.GIT_REMOTE || detectRemote() || 'origin',
    githubBaseBranch: process.env.GITHUB_BASE_BRANCH || 'main',
    githubRepo: process.env.GITHUB_REPO || '',
    agents,
    devNotesMode,
    triggerWord,
    thinkingTag,
    commentPrefix,
    hooksPath,
  };
}

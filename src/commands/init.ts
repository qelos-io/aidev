import * as fs from 'node:fs';
import * as path from 'node:path';
import * as readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import * as dotenv from 'dotenv';
import { logger } from '../logger';
import { detectRemote } from '../git';
import { validateAgentPermissions } from '../permissions';
import { scheduleSetCommand } from './schedule';
import { isGhInstalled, isGhAuthenticated, isGitHubRemote } from '../github';
import { commandExists, isWindows } from '../platform';
import { generateFullHooksFile } from '../hooksTemplate';
import chalk from 'chalk';

const VALID_AGENTS = ['antigravity', 'anthropic-sdk', 'claude', 'codex', 'cursor', 'devin', 'opencode'] as const;

const DEFAULT_CLAUDE_MODEL = 'opusplan';
const DEFAULT_ANTHROPIC_MODEL = 'claude-opus-4-6';

// Patterns we want guaranteed in .gitignore.
// Each entry: [pattern to write, regex that matches equivalent existing lines]
const GITIGNORE_RULES: Array<[string, RegExp]> = [
  ['.env.*',   /^\.env[\.\*]/m],
  ['*.log',    /^\*\.log/m],
  ['*.aidev.instructions.md', /^\*\.aidev\.instructions\.md/m],
  ['*.aidev.task.json',       /^\*\.aidev\.task\.json/m],
  ['aidev.tasks.json',        /^aidev\.tasks\.json/m],
  ['.aidev/assets/',          /^\/?\.aidev\/assets\/?$/m],
];

/**
 * Returns the Windows Cursor Agent CLI init message when on Windows, cursor is
 * in the agent list, and the agent CLI is not installed. Otherwise null.
 * Exported for tests; platform can be passed to avoid real platform checks.
 */
export function getWindowsCursorInitMessage(
  agents: string,
  platform?: { isWindows: boolean; commandExists: (cmd: string) => boolean }
): string | null {
  const win = platform?.isWindows ?? isWindows;
  const exists = platform?.commandExists ?? commandExists;
  if (!win) return null;
  const list = agents.split(',').map((a) => a.trim());
  if (!list.includes('cursor') || exists('agent')) return null;
  return (
    chalk.bold('  Windows: Cursor Agent CLI') +
    '\n' +
    chalk.dim('  ─────────────────────────────────────────────────') +
    '\n' +
    `  Cursor runner requires the ${chalk.cyan('agent')} CLI. Install in PowerShell:` +
    '\n' +
    chalk.cyan("    irm 'https://cursor.com/install?win32=true' | iex") +
    '\n' +
    `  Then run ${chalk.cyan('agent --version')} to confirm.`
  );
}

export function ensureGitignore(dir = process.cwd()): void {
  const gitignorePath = path.join(dir, '.gitignore');
  const existing = fs.existsSync(gitignorePath)
    ? fs.readFileSync(gitignorePath, 'utf8')
    : '';
  const normalized = normalizeGitignore(existing);

  const missing = GITIGNORE_RULES
    .filter(([, regex]) => !regex.test(normalized))
    .map(([pattern]) => pattern);

  if (normalized === existing && missing.length === 0) return;

  const addition = missing.length === 0
    ? ''
    : (normalized.endsWith('\n') || normalized === '' ? '' : '\n') + missing.join('\n') + '\n';
  fs.writeFileSync(gitignorePath, normalized + addition, 'utf8');

  if (dir === process.cwd()) {
    if (missing.length > 0) {
      logger.info(`.gitignore — added: ${missing.join(', ')}`);
    } else {
      logger.info('.gitignore — updated legacy aidev ignore rules');
    }
  }
}

function normalizeGitignore(content: string): string {
  if (!content) return content;

  const normalizedLines: string[] = [];
  let hasAssetsRule = false;

  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === '.aidev/' || trimmed === '/.aidev/') {
      if (!hasAssetsRule) {
        normalizedLines.push('.aidev/assets/');
        hasAssetsRule = true;
      }
      continue;
    }

    if (trimmed === '.aidev/assets/' || trimmed === '/.aidev/assets/') {
      if (!hasAssetsRule) {
        normalizedLines.push('.aidev/assets/');
        hasAssetsRule = true;
      }
      continue;
    }

    normalizedLines.push(line);
  }

  const normalized = normalizedLines.join('\n');
  return content.endsWith('\n') && !normalized.endsWith('\n') ? `${normalized}\n` : normalized;
}

interface ClickUpMember {
  id: number;
  username: string;
  email: string;
}

export interface Answers {
  provider: 'clickup' | 'jira' | 'linear' | 'local' | 'monday' | 'trello';
  // ClickUp
  clickupApiKey: string;
  clickupTeamId: string;
  clickupTag: string;
  clickupPendingStatus: string;
  clickupInReviewStatus: string;
  // Jira
  jiraBaseUrl: string;
  jiraEmail: string;
  jiraApiToken: string;
  jiraProject: string;
  jiraLabel: string;
  jiraPendingStatus: string;
  jiraInReviewStatus: string;
  // Linear
  linearApiKey: string;
  linearTeamId: string;
  linearLabel: string;
  linearPendingStatus: string;
  linearInReviewStatus: string;
  // Monday
  mondayApiToken: string;
  mondayBoardId: string;
  mondayStatusColumnId: string;
  mondayGroupId: string;
  // Trello
  trelloApiKey: string;
  trelloToken: string;
  trelloBoardId: string;
  trelloLabel: string;
  trelloOpenList: string;
  trelloPendingList: string;
  trelloInProgressList: string;
  trelloInReviewList: string;
  trelloOpenStatus: string;
  trelloPendingStatus: string;
  trelloInReviewStatus: string;
  // Non-code tasks
  nonCodeTag: string;
  nonCodeClickupTeamId: string;
  nonCodeJiraProject: string;
  nonCodeLinearTeamId: string;
  // Shared
  assigneeTag: string;
  gitRemote: string;
  githubBaseBranch: string;
  githubRepo: string;
  agents: string;
  // Claude CLI runner (when agent list includes 'claude')
  claudeModel: string;
  // Anthropic SDK runner (when agent list includes 'anthropic-sdk')
  anthropicApiKey: string;
  anthropicBaseUrl: string;
  anthropicModel: string;
  devNotesMode: string;
  triggerWord: string;
  thinkingTag: string;
  planningTag: string;
  commentPrefix: string;
  aidevEnvExtend: string;
  acceptedTag: string;
  doneStatus: string;
  safeMode: boolean;
}

function dim(s: string) {
  return chalk.dim(s);
}

function hint(s: string) {
  return chalk.dim(`(${s})`);
}

async function ask(
  rl: readline.Interface,
  question: string,
  defaultVal = '',
  required = false
): Promise<string> {
  const suffix = defaultVal ? chalk.dim(` [${defaultVal}]`) : '';
  while (true) {
    const raw = await rl.question(`  ${question}${suffix}: `);
    const val = raw.trim() || defaultVal;
    if (required && !val) {
      console.log(chalk.yellow(`  This field is required.`));
      continue;
    }
    return val;
  }
}

async function choose(
  rl: readline.Interface,
  question: string,
  options: string[],
  defaultVal: string
): Promise<string> {
  const opts = options
    .map((o) => (o === defaultVal ? chalk.cyan(o) : o))
    .join(chalk.dim(' | '));
  while (true) {
    const raw = await rl.question(`  ${question} ${dim(`[${opts}]`)}: `);
    const val = raw.trim() || defaultVal;
    if (!options.includes(val)) {
      console.log(chalk.yellow(`  Choose one of: ${options.join(', ')}`));
      continue;
    }
    return val;
  }
}

async function pickAgents(rl: readline.Interface, defaultAgents = ''): Promise<string> {
  const available = [...VALID_AGENTS];

  console.log(`\n  Available agents:`);
  available.forEach((a, i) => console.log(`    ${chalk.cyan(String(i + 1))}. ${a}`));

  console.log(
    `\n  Enter agents ${hint('numbers or names, comma-separated — first = primary, rest = fallback')}`
  );

  const defaultDisplay = defaultAgents || available.join(',');
  while (true) {
    const raw = await rl.question(`  Agents in order ${dim(`[${defaultDisplay}]`)}: `);

    if (!raw.trim()) return defaultDisplay;

    const parts = raw.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
    const resolved = parts.map((p) => {
      const idx = parseInt(p, 10);
      if (!isNaN(idx) && idx >= 1 && idx <= available.length) return available[idx - 1];
      return p;
    });

    const invalid = resolved.filter((r) => !available.includes(r as typeof available[number]));
    if (invalid.length) {
      console.log(chalk.yellow(`  Unknown agent(s): ${invalid.join(', ')}. Valid: ${available.join(', ')}`));
      continue;
    }

    const unique = [...new Set(resolved)];
    if (unique.length !== resolved.length) {
      console.log(chalk.yellow(`  Duplicate agents removed: ${unique.join(', ')}`));
    }
    return unique.join(',');
  }
}

async function fetchCurrentUser(apiKey: string): Promise<ClickUpMember | null> {
  try {
    const res = await fetch('https://api.clickup.com/api/v2/user', {
      headers: { Authorization: apiKey },
    });
    if (!res.ok) return null;
    const data = await res.json() as { user: ClickUpMember };
    return data.user;
  } catch {
    return null;
  }
}

async function pickAssignee(rl: readline.Interface, apiKey: string, existingDefault = ''): Promise<string> {
  process.stdout.write(`  ${chalk.dim('Fetching current user...')}\r`);
  const user = await fetchCurrentUser(apiKey);
  process.stdout.write('                              \r');

  if (!user) {
    return ask(rl, `Assignee tag ${hint('optional — could not fetch user')}`, existingDefault);
  }

  const fetched = user.username && user.username !== 'null'
    ? `${user.username} <${user.email}>`
    : user.email;
  return ask(rl, `Assignee tag`, existingDefault || fetched);
}

function section(title: string) {
  console.log('\n' + chalk.bold.underline(title));
}

/** Wraps value in double quotes if it contains spaces or special chars. */
export function envVal(val: string): string {
  return /[\s#"']/.test(val) ? `"${val.replace(/"/g, '\\"')}"` : val;
}

function line(key: string, val: string): string | null {
  return val ? `${key}=${envVal(val)}` : null;
}

export function renderEnv(a: Answers): string {
  const providerLines =
    a.provider === 'local'
      ? [
          `PROVIDER=local`,
          `# Tasks are stored locally in .aidev/tasks/ folders`,
        ]
      : a.provider === 'jira'
        ? [
            `PROVIDER=jira`,
            line('JIRA_BASE_URL', a.jiraBaseUrl),
            line('JIRA_EMAIL', a.jiraEmail),
            line('JIRA_API_TOKEN', a.jiraApiToken),
            line('JIRA_PROJECT', a.jiraProject),
            line('JIRA_LABEL', a.jiraLabel),
            `JIRA_PENDING_STATUS=${envVal(a.jiraPendingStatus)}`,
            `JIRA_IN_REVIEW_STATUS=${envVal(a.jiraInReviewStatus)}`,
          ]
        : a.provider === 'linear'
          ? [
              `PROVIDER=linear`,
              line('LINEAR_API_KEY', a.linearApiKey),
              line('LINEAR_TEAM_ID', a.linearTeamId),
              line('LINEAR_LABEL', a.linearLabel),
              `LINEAR_PENDING_STATUS=${envVal(a.linearPendingStatus)}`,
              `LINEAR_IN_REVIEW_STATUS=${envVal(a.linearInReviewStatus)}`,
            ]
          : a.provider === 'monday'
            ? [
                `PROVIDER=monday`,
                line('MONDAY_API_TOKEN', a.mondayApiToken),
                line('MONDAY_BOARD_ID', a.mondayBoardId),
                line('MONDAY_STATUS_COLUMN_ID', a.mondayStatusColumnId),
                line('MONDAY_GROUP_ID', a.mondayGroupId),
                `CLICKUP_PENDING_STATUS=${envVal(a.clickupPendingStatus)}`,
                `CLICKUP_IN_REVIEW_STATUS=${envVal(a.clickupInReviewStatus)}`,
              ]
            : a.provider === 'trello'
              ? [
                  `PROVIDER=trello`,
                  line('TRELLO_API_KEY', a.trelloApiKey),
                  line('TRELLO_TOKEN', a.trelloToken),
                  line('TRELLO_BOARD_ID', a.trelloBoardId),
                  line('TRELLO_LABEL', a.trelloLabel),
                  `TRELLO_OPEN_LIST=${envVal(a.trelloOpenList)}`,
                  `TRELLO_PENDING_LIST=${envVal(a.trelloPendingList)}`,
                  `TRELLO_IN_PROGRESS_LIST=${envVal(a.trelloInProgressList)}`,
                  `TRELLO_IN_REVIEW_LIST=${envVal(a.trelloInReviewList)}`,
                  line('TRELLO_OPEN_STATUS', a.trelloOpenStatus),
                  line('TRELLO_PENDING_STATUS', a.trelloPendingStatus),
                  line('TRELLO_IN_REVIEW_STATUS', a.trelloInReviewStatus),
                ]
              : [
                  `PROVIDER=clickup`,
                  line('CLICKUP_API_KEY', a.clickupApiKey),
                  line('CLICKUP_TEAM_ID', a.clickupTeamId),
                  line('CLICKUP_TAG', a.clickupTag),
                  `CLICKUP_PENDING_STATUS=${envVal(a.clickupPendingStatus)}`,
                  `CLICKUP_IN_REVIEW_STATUS=${envVal(a.clickupInReviewStatus)}`,
                ];

  const lines = [
    a.aidevEnvExtend
      ? `# Global env base — values here are overridden by entries below`
      : null,
    line('AIDEV_ENV_EXTEND', a.aidevEnvExtend),
    a.aidevEnvExtend ? `` : null,
    ...providerLines,
    ``,
    line('ASSIGNEE_TAG', a.assigneeTag),
    `GIT_REMOTE=${envVal(a.gitRemote)}`,
    `GITHUB_BASE_BRANCH=${envVal(a.githubBaseBranch)}`,
    line('GITHUB_REPO', a.githubRepo),
    ``,
    `# Agents to use, in fallback order (comma-separated: antigravity, anthropic-sdk, claude, codex, cursor, devin, opencode)`,
    `AGENTS=${a.agents}`,
    ``,
    ...(a.agents.split(',').map((s) => s.trim()).includes('claude')
      ? [
          `# Claude CLI runner — model passed to \`claude --model\`.`,
          `# Default \`opusplan\` routes plan→opus, code→sonnet (saves tokens vs. opus-only).`,
          `CLAUDE_MODEL=${envVal(a.claudeModel || DEFAULT_CLAUDE_MODEL)}`,
          ``,
        ]
      : []),
    ...(a.agents.split(',').map((s) => s.trim()).includes('anthropic-sdk')
      ? [
          `# Anthropic Agent SDK runner — drives Claude in-process via @anthropic-ai/claude-agent-sdk.`,
          `# ANTHROPIC_API_KEY accepts a comma-separated pool of tokens; the runner rotates round-robin.`,
          `ANTHROPIC_API_KEY=${envVal(a.anthropicApiKey)}`,
          a.anthropicBaseUrl
            ? `ANTHROPIC_BASE_URL=${envVal(a.anthropicBaseUrl)}`
            : `# ANTHROPIC_BASE_URL=https://api.anthropic.com`,
          `ANTHROPIC_MODEL=${envVal(a.anthropicModel || DEFAULT_ANTHROPIC_MODEL)}`,
          ``,
        ]
      : []),
    `# DEV_NOTES_MODE: smart (only ask when unclear) | always (ask before every task)`,
    `DEV_NOTES_MODE=${a.devNotesMode}`,
    ``,
    `# AIDEV_SAFE_MODE: redact secrets from task prompts (default: true). Secret values found in .env files`,
    `# are replaced with a reference to .aidev/assets/secrets/task-<id>.secrets (git-ignored).`,
    `AIDEV_SAFE_MODE=${a.safeMode ? 'true' : 'false'}`,
    ``,
    `# AIDEV_TRIGGER_WORD: comment containing this word re-triggers task processing (default: aidev-continue)`,
    `AIDEV_TRIGGER_WORD=${envVal(a.triggerWord)}`,
    ``,
    `# AIDEV_COMMENT_PREFIX: prefix for aidev comments; $PROJECT_NAME expands to the project folder name (default: [aidev-$PROJECT_NAME])`,
    a.commentPrefix !== '[aidev-$PROJECT_NAME]' ? `AIDEV_COMMENT_PREFIX=${envVal(a.commentPrefix)}` : `# AIDEV_COMMENT_PREFIX=${envVal(a.commentPrefix)}`,
    ``,
    `# THINKING_TAG: tasks with this tag are analyzed and broken into sub-tasks before execution`,
    line('THINKING_TAG', a.thinkingTag),
    ``,
    `# PLANNING_TAG: tasks with this tag are split into self-contained sub-tickets pushed back to the provider`,
    line('PLANNING_TAG', a.planningTag),
    ``,
    `# NON_CODE_TAG: tasks with this tag run without git branching (no checkout/commit/push)`,
    line('NON_CODE_TAG', a.nonCodeTag),
    line('NON_CODE_CLICKUP_TEAM_ID', a.nonCodeClickupTeamId),
    line('NON_CODE_JIRA_PROJECT', a.nonCodeJiraProject),
    line('NON_CODE_LINEAR_TEAM_ID', a.nonCodeLinearTeamId),
    ``,
    `# CONSULT_TAG: pending tasks with this tag receive a perspective reply (no git); default: <folder>-consult`,
    `# CONSULTED_TAG: stats marker applied after consultation; default: <folder>-consulted`,
    ``,
    `# AIDEV_HOOKS_PATH: path to hooks file (.ts or .js) for customizing the AI pipeline`,
    `AIDEV_HOOKS_PATH=.aidev/aidev.hooks.ts`,
    ``,
    `# ACCEPTED_TAG: tasks in review with this tag are auto-merged (squash + delete branch)`,
    line('ACCEPTED_TAG', a.acceptedTag),
    `# DONE_STATUS: status to set after auto-merging an accepted PR`,
    a.doneStatus ? `DONE_STATUS=${envVal(a.doneStatus)}` : `# DONE_STATUS=done`,
    ``,
  ];
  return lines.filter((l) => l !== null).join('\n');
}

export function printGhSuggestion(remote: string): void {
  if (!isGitHubRemote(remote)) return;

  if (!isGhInstalled()) {
    console.log(chalk.bold('  GitHub CLI (gh)'));
    console.log(chalk.dim('  ─────────────────────────────────────────────────'));
    console.log(`  This repo is on GitHub. Install the ${chalk.cyan('gh')} CLI to`);
    console.log(`  automatically create Pull Requests after pushing branches.`);
    console.log(`    ${chalk.cyan('https://cli.github.com/')}`);
    console.log(`  After installing, run: ${chalk.cyan('gh auth login')}`);
    console.log();
    return;
  }

  if (!isGhAuthenticated()) {
    console.log(chalk.bold('  GitHub CLI (gh)'));
    console.log(chalk.dim('  ─────────────────────────────────────────────────'));
    console.log(`  ${chalk.cyan('gh')} is installed but not authenticated.`);
    console.log(`  Run ${chalk.cyan('gh auth login')} to enable automatic PR creation.`);
    console.log();
    return;
  }

  console.log(chalk.bold('  GitHub CLI (gh)'));
  console.log(chalk.dim('  ─────────────────────────────────────────────────'));
  console.log(`  ${chalk.green('✓')} ${chalk.cyan('gh')} is installed and authenticated.`);
  console.log(`  PRs will be created automatically after pushing branches.`);
  console.log();
}

export function ensureHooksBoilerplate(dir = process.cwd()): void {
  const aidevDir = path.join(dir, '.aidev');
  const hooksPath = path.join(aidevDir, 'aidev.hooks.ts');

  if (fs.existsSync(hooksPath)) return;

  if (!fs.existsSync(aidevDir)) {
    fs.mkdirSync(aidevDir, { recursive: true });
  }

  fs.writeFileSync(hooksPath, generateFullHooksFile(), 'utf8');
  if (dir === process.cwd()) {
    logger.info('Created .aidev/aidev.hooks.ts — customize hooks to modify the AI pipeline');
  }
}

export async function initCommand(): Promise<void> {
  const dest = path.join(process.cwd(), '.env.aidev');

  let existing: Record<string, string> = {};
  if (fs.existsSync(dest)) {
    const rl0 = readline.createInterface({ input, output });
    const overwrite = await rl0.question(
      chalk.yellow('.env.aidev already exists. Reconfigure? ') + dim('[y/N] ')
    );
    rl0.close();
    if (overwrite.trim().toLowerCase() !== 'y') {
      logger.info('Keeping existing .env.aidev.');
      ensureHooksBoilerplate();
      return;
    }
    existing = dotenv.parse(fs.readFileSync(dest, 'utf8'));
    console.log();
  }

  console.log(chalk.bold('\naidev setup') + dim(' — press Enter to accept defaults\n'));

  const rl = readline.createInterface({ input, output });

  try {
    // ── Global env extend ─────────────────────────────────────
    section('Global env file (optional)');
    console.log(
      chalk.dim(
        `  Set AIDEV_ENV_EXTEND to share common config (API keys, agents, etc.) across\n` +
        `  multiple projects. Each project's .env.aidev overrides values from the global file.`
      )
    );
    const aidevEnvExtend = await ask(
      rl,
      `Path to global env file ${hint('e.g. ~/.aidev.global — leave blank to skip')}`,
      existing.AIDEV_ENV_EXTEND || process.env.AIDEV_ENV_EXTEND || ''
    );

    // ── Provider ─────────────────────────────────────────────
    section('Task provider');
    const provider = await choose(rl, 'Which task provider do you use?', ['clickup', 'jira', 'linear', 'local', 'monday', 'trello'], existing.PROVIDER || 'clickup') as Answers['provider'];

    // Provider-specific config
    const globalEnvHint = hint('leave blank to use global env var');
    const folderName = path.basename(process.cwd());

    let clickupApiKey = '';
    let clickupTeamId = '';
    let clickupTag = '';
    let clickupPendingStatus = 'pending';
    let clickupInReviewStatus = 'review';

    let jiraBaseUrl = '';
    let jiraEmail = '';
    let jiraApiToken = '';
    let jiraProject = '';
    let jiraLabel = '';
    let jiraPendingStatus = 'To Do';
    let jiraInReviewStatus = 'In Review';

    let linearApiKey = '';
    let linearTeamId = '';
    let linearLabel = '';
    let linearPendingStatus = 'Backlog';
    let linearInReviewStatus = 'In Review';

    let mondayApiToken = '';
    let mondayBoardId = '';
    let mondayStatusColumnId = 'status';
    let mondayGroupId = '';

    let trelloApiKey = '';
    let trelloToken = '';
    let trelloBoardId = '';
    let trelloLabel = '';
    let trelloOpenList = 'To Do';
    let trelloPendingList = 'Blocked';
    let trelloInProgressList = 'Doing';
    let trelloInReviewList = 'In Review';
    let trelloOpenStatus = '';
    let trelloPendingStatus = '';
    let trelloInReviewStatus = '';

    if (provider === 'local') {
      // ── Local ──────────────────────────────────────────────
      section('Local task folders');
      const { ensureTaskFolders } = await import('../providers/local');
      ensureTaskFolders();
      console.log(chalk.dim('  Created .aidev/tasks/ with status folders: open, pending, progress, review, done'));
      console.log(chalk.dim('  Add markdown task files to .aidev/tasks/open/ to get started.'));
    } else if (provider === 'jira') {
      // ── Jira ─────────────────────────────────────────────
      section('Jira');
      jiraBaseUrl = await ask(
        rl,
        `Jira base URL ${hint('e.g. https://mycompany.atlassian.net')}`,
        existing.JIRA_BASE_URL || '',
        true
      );
      jiraEmail = await ask(rl, `Jira email ${globalEnvHint}`, existing.JIRA_EMAIL || '', true);
      jiraApiToken = await ask(rl, `Jira API token ${globalEnvHint}`, existing.JIRA_API_TOKEN || '', true);
      jiraProject = await ask(
        rl,
        `Project key ${hint('e.g. PROJ')}`,
        existing.JIRA_PROJECT || '',
        true
      );
      jiraLabel = await ask(
        rl,
        `Label to filter issues ${hint('issues with this label will be picked up')}`,
        existing.JIRA_LABEL || folderName
      );
      jiraPendingStatus = await ask(rl, 'Pending status name', existing.JIRA_PENDING_STATUS || 'To Do');
      jiraInReviewStatus = await ask(rl, 'In-review status name', existing.JIRA_IN_REVIEW_STATUS || 'In Review');
    } else if (provider === 'linear') {
      section('Linear');
      linearApiKey = await ask(rl, `API key ${globalEnvHint}`, existing.LINEAR_API_KEY || '', true);
      linearTeamId = await ask(
        rl,
        `Team ID ${hint('UUID from Linear workspace settings')}`,
        existing.LINEAR_TEAM_ID || '',
        true
      );
      linearLabel = await ask(
        rl,
        `Label to filter issues ${hint('issues with this label will be picked up')}`,
        existing.LINEAR_LABEL || folderName
      );
      linearPendingStatus = await ask(rl, 'Pending status name', existing.LINEAR_PENDING_STATUS || 'Pending');
      linearInReviewStatus = await ask(rl, 'In-review status name', existing.LINEAR_IN_REVIEW_STATUS || 'In Review');
    } else if (provider === 'monday') {
      section('Monday.com');
      mondayApiToken = await ask(
        rl,
        `API token ${globalEnvHint}`,
        existing.MONDAY_API_TOKEN || '',
        true
      );
      mondayBoardId = await ask(
        rl,
        `Board ID ${hint('numeric board ID')}`,
        existing.MONDAY_BOARD_ID || '',
        true
      );
      mondayStatusColumnId = await ask(
        rl,
        `Status column ID ${hint('e.g. status — find in board columns')}`,
        existing.MONDAY_STATUS_COLUMN_ID || 'status',
        true
      );
      mondayGroupId = await ask(
        rl,
        `Group ID ${hint('for create_task, e.g. topics — leave blank for default')}`,
        existing.MONDAY_GROUP_ID || ''
      );
      clickupPendingStatus = await ask(rl, 'Pending status label', existing.CLICKUP_PENDING_STATUS || 'Working on it');
      clickupInReviewStatus = await ask(rl, 'In-review status label', existing.CLICKUP_IN_REVIEW_STATUS || 'Done');
    } else if (provider === 'trello') {
      section('Trello');
      console.log(
        chalk.dim(
          `  Get an API key and token from https://trello.com/power-ups/admin\n` +
          `  (or https://trello.com/app-key for legacy keys).`
        )
      );
      trelloApiKey = await ask(rl, `API key ${globalEnvHint}`, existing.TRELLO_API_KEY || '', true);
      trelloToken = await ask(rl, `API token ${globalEnvHint}`, existing.TRELLO_TOKEN || '', true);
      trelloBoardId = await ask(
        rl,
        `Board ID ${hint('short ID from the board URL')}`,
        existing.TRELLO_BOARD_ID || '',
        true
      );
      trelloLabel = await ask(
        rl,
        `Label to filter cards ${hint('cards with this label will be picked up — * for all assigned cards')}`,
        existing.TRELLO_LABEL || folderName
      );
      trelloOpenList = await ask(rl, 'Open list name', existing.TRELLO_OPEN_LIST || 'To Do');
      trelloPendingList = await ask(rl, 'Pending list name', existing.TRELLO_PENDING_LIST || 'Blocked');
      trelloInProgressList = await ask(rl, 'In-progress list name', existing.TRELLO_IN_PROGRESS_LIST || 'Doing');
      trelloInReviewList = await ask(rl, 'In-review list name', existing.TRELLO_IN_REVIEW_LIST || 'In Review');
      // Semantic status names are rarely customized — preserve any existing values silently
      trelloOpenStatus = existing.TRELLO_OPEN_STATUS || '';
      trelloPendingStatus = existing.TRELLO_PENDING_STATUS || '';
      trelloInReviewStatus = existing.TRELLO_IN_REVIEW_STATUS || '';
    } else {
      // ── ClickUp ──────────────────────────────────────────────
      section('ClickUp');
      clickupApiKey = await ask(rl, `API key ${globalEnvHint}`, existing.CLICKUP_API_KEY || '');
      clickupTeamId = await ask(rl, `Team / workspace ID ${globalEnvHint}`, existing.CLICKUP_TEAM_ID || '');
      clickupTag = await ask(
        rl,
        `Tag to filter tasks ${hint('tasks with this tag will be picked up')}`,
        existing.CLICKUP_TAG || folderName
      );
      clickupPendingStatus = await ask(rl, 'Pending status name', existing.CLICKUP_PENDING_STATUS || 'pending');
      clickupInReviewStatus = await ask(rl, 'In-review status name', existing.CLICKUP_IN_REVIEW_STATUS || 'review');
    }

    // ── Git / GitHub ─────────────────────────────────────────
    section('Git & GitHub');
    const detectedRemote = detectRemote() ?? 'origin';
    const gitRemote = await ask(rl, 'Git remote', existing.GIT_REMOTE || detectedRemote);
    const githubBaseBranch = await ask(rl, 'Base branch', existing.GITHUB_BASE_BRANCH || 'main');
    const githubRepo = await ask(
      rl,
      `GitHub repo ${hint('owner/repo — used for PR links, optional')}`,
      existing.GITHUB_REPO || ''
    );

    // ── AI agents ────────────────────────────────────────────
    section('AI agents');
    const agents = await pickAgents(rl, existing.AGENTS || '');

    // ── Claude CLI model ────────────────────────────────────
    let claudeModel = '';
    const agentList = agents.split(',').map((s) => s.trim());
    if (agentList.includes('claude')) {
      section('Claude CLI');
      console.log(
        chalk.dim(
          `  Model passed to \`claude --model\`. Default \`opusplan\` routes plan→opus,\n` +
          `  code→sonnet — saves tokens vs. running opus end-to-end.`
        )
      );
      claudeModel = await ask(
        rl,
        `CLAUDE_MODEL`,
        existing.CLAUDE_MODEL || DEFAULT_CLAUDE_MODEL
      );
    }

    // ── Anthropic Agent SDK ─────────────────────────────────
    let anthropicApiKey = '';
    let anthropicBaseUrl = '';
    let anthropicModel = '';
    if (agentList.includes('anthropic-sdk')) {
      section('Anthropic Agent SDK');
      console.log(
        chalk.dim(
          `  Drives Claude in-process via @anthropic-ai/claude-agent-sdk.\n` +
          `  ANTHROPIC_API_KEY accepts a single key or a comma-separated pool — the runner rotates round-robin.`
        )
      );
      anthropicApiKey = await ask(
        rl,
        `ANTHROPIC_API_KEY ${hint('comma-separated for multiple keys')}`,
        existing.ANTHROPIC_API_KEY || '',
        true
      );
      anthropicBaseUrl = await ask(
        rl,
        `ANTHROPIC_BASE_URL ${hint('optional — leave blank for default')}`,
        existing.ANTHROPIC_BASE_URL || ''
      );
      anthropicModel = await ask(
        rl,
        `ANTHROPIC_MODEL`,
        existing.ANTHROPIC_MODEL || DEFAULT_ANTHROPIC_MODEL
      );
    }

    // ── Validate agent permissions ──────────────────────────
    section('Agent permissions');
    await validateAgentPermissions(agentList, rl);

    const devNotesMode = await choose(
      rl,
      `Dev notes mode ${hint('smart = ask AI if unclear, always = ask before every task')}`,
      ['smart', 'always'],
      existing.DEV_NOTES_MODE || 'smart'
    );

    // ── Safe mode ────────────────────────────────────────────
    section('Safe mode');
    console.log(
      chalk.dim(
        `  When enabled, secret values from .env / .env.aidev that appear in task prompts\n` +
        `  are redacted and stored in .aidev/assets/secrets/ (git-ignored). Agents are\n` +
        `  nudged to pipe values via the terminal instead of reading the secrets file.`
      )
    );
    const existingSafeMode = (existing.AIDEV_SAFE_MODE || '').trim().toLowerCase();
    const safeModeDefault = !['false', '0', 'no'].includes(existingSafeMode) ? 'yes' : 'no';
    const safeModeAnswer = await choose(
      rl,
      `Redact secrets from AI prompts ${hint('default: yes')}`,
      ['yes', 'no'],
      safeModeDefault
    );
    const safeMode = safeModeAnswer === 'yes';

    // ── Trigger word ─────────────────────────────────────────
    section('Trigger word');
    const triggerWord = await ask(
      rl,
      `Trigger word ${hint('comment containing this re-triggers a skipped task')}`,
      existing.AIDEV_TRIGGER_WORD || 'aidev-continue'
    );

    // ── Comment prefix ──────────────────────────────────────
    section('Comment prefix');
    const commentPrefix = await ask(
      rl,
      `Comment prefix ${hint('prefix for aidev comments; $PROJECT_NAME = folder name')}`,
      existing.AIDEV_COMMENT_PREFIX || '[aidev-$PROJECT_NAME]'
    );

    // ── Thinking tag ────────────────────────────────────────
    section('Thinking tasks');
    const thinkingTag = await ask(
      rl,
      `Thinking tag ${hint('tasks with this tag are broken into sub-tasks before execution')}`,
      existing.THINKING_TAG || 'thinking'
    );

    // ── Planning tag ────────────────────────────────────────
    section('Planning tasks');
    const planningTag = await ask(
      rl,
      `Planning tag ${hint('tasks with this tag are split into self-contained sub-tickets pushed back to the provider')}`,
      existing.PLANNING_TAG || 'planning'
    );

    // ── Non-code tasks ──────────────────────────────────────
    section('Non-code tasks');
    console.log(
      chalk.dim(
        `  Tasks with the non-code tag are executed without git branching — no checkout,\n` +
        `  commit, or push. Useful for research, docs, or tasks that don't produce PRs.`
      )
    );
    const nonCodeTag = await ask(
      rl,
      `Non-code tag ${hint('leave blank to use default: ' + folderName + '-other')}`,
      existing.NON_CODE_TAG || `${folderName}-other`
    );

    let nonCodeClickupTeamId = '';
    let nonCodeJiraProject = '';
    let nonCodeLinearTeamId = '';

    if (nonCodeTag && provider !== 'local' && provider !== 'monday') {
      if (provider === 'clickup') {
        nonCodeClickupTeamId = await ask(
          rl,
          `Non-code ClickUp team ID ${hint('leave blank to use same team')}`,
          existing.NON_CODE_CLICKUP_TEAM_ID || ''
        );
      } else if (provider === 'jira') {
        nonCodeJiraProject = await ask(
          rl,
          `Non-code Jira project ${hint('leave blank to use same project')}`,
          existing.NON_CODE_JIRA_PROJECT || ''
        );
      } else if (provider === 'linear') {
        nonCodeLinearTeamId = await ask(
          rl,
          `Non-code Linear team ID ${hint('leave blank to use same team')}`,
          existing.NON_CODE_LINEAR_TEAM_ID || ''
        );
      }
    }

    // ── Accepted (auto-merge) — prompts only when gh is installed ─────────────
    let acceptedTag = existing.ACCEPTED_TAG || '';
    let doneStatus = existing.DONE_STATUS || '';

    if (isGhInstalled()) {
      section('Auto-merge accepted PRs');
      console.log(
        chalk.dim(
          `  Tasks in review with the accepted tag will be auto-merged via gh CLI\n` +
          `  (squash + delete branch) and moved to a "done" status.`
        )
      );
      acceptedTag = await ask(
        rl,
        `Accepted tag ${hint('tag marking a reviewed PR as approved')}`,
        existing.ACCEPTED_TAG || 'accepted'
      );
      if (acceptedTag) {
        doneStatus = await ask(
          rl,
          `Done status ${hint('leave blank to auto-detect from board statuses')}`,
          existing.DONE_STATUS || ''
        );
      } else {
        doneStatus = '';
      }
    }

    // ── Assignee ─────────────────────────────────────────────
    section('Assignee');
    const effectiveClickUpApiKey = clickupApiKey || process.env.CLICKUP_API_KEY || '';
    let assigneeTag: string;

    if (provider === 'clickup' && effectiveClickUpApiKey) {
      assigneeTag = await pickAssignee(rl, effectiveClickUpApiKey, existing.ASSIGNEE_TAG || '');
    } else if (provider === 'local') {
      assigneeTag = await ask(
        rl,
        `Assignee name ${hint('your name, used in session comments')}`,
        existing.ASSIGNEE_TAG || ''
      );
    } else {
      assigneeTag = await ask(
        rl,
        `Assignee tag ${hint('optional')}`,
        existing.ASSIGNEE_TAG || ''
      );
    }

    const answers: Answers = {
      provider,
      aidevEnvExtend,
      clickupApiKey,
      clickupTeamId,
      clickupTag,
      clickupPendingStatus,
      clickupInReviewStatus,
      jiraBaseUrl,
      jiraEmail,
      jiraApiToken,
      jiraProject,
      jiraLabel,
      jiraPendingStatus,
      jiraInReviewStatus,
      linearApiKey,
      linearTeamId,
      linearLabel,
      linearPendingStatus,
      linearInReviewStatus,
      mondayApiToken,
      mondayBoardId,
      mondayStatusColumnId,
      mondayGroupId,
      trelloApiKey,
      trelloToken,
      trelloBoardId,
      trelloLabel,
      trelloOpenList,
      trelloPendingList,
      trelloInProgressList,
      trelloInReviewList,
      trelloOpenStatus,
      trelloPendingStatus,
      trelloInReviewStatus,
      nonCodeTag,
      nonCodeClickupTeamId,
      nonCodeJiraProject,
      nonCodeLinearTeamId,
      assigneeTag,
      gitRemote,
      githubBaseBranch,
      githubRepo,
      agents,
      claudeModel,
      anthropicApiKey,
      anthropicBaseUrl,
      anthropicModel,
      devNotesMode,
      triggerWord,
      thinkingTag,
      planningTag,
      commentPrefix,
      acceptedTag,
      doneStatus,
      safeMode,
    };

    ensureGitignore();
    ensureHooksBoilerplate();
    fs.writeFileSync(dest, renderEnv(answers), 'utf8');
    console.log();
    logger.success(`.env.aidev written to ${dest}`);
    logger.info(`Agents: ${agents} ${dim('(first = primary, rest = fallback)')}`);

    if (process.platform === 'darwin') {
      console.log();
      console.log(chalk.bold('  macOS: enable cron scheduling'));
      console.log(chalk.dim('  ─────────────────────────────────────────────────'));
      console.log(`  For ${chalk.cyan('aidev schedule')} to work, cron needs Full Disk Access:`);
      console.log(`    1. Open ${chalk.cyan('System Settings → Privacy & Security → Full Disk Access')}`);
      console.log(`    2. Click ${chalk.cyan('+')} and add ${chalk.cyan('/usr/sbin/cron')}`);
      console.log();
    }

    const windowsCursorMsg = getWindowsCursorInitMessage(agents);
    if (windowsCursorMsg) {
      console.log();
      console.log(windowsCursorMsg);
      console.log();
    }

    printGhSuggestion(gitRemote);

    section('Schedule');
    await scheduleSetCommand();
  } finally {
    rl.close();
  }
}

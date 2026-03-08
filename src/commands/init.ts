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
import chalk from 'chalk';

const VALID_AGENTS = ['claude', 'cursor', 'windsurf'] as const;

// Patterns we want guaranteed in .gitignore.
// Each entry: [pattern to write, regex that matches equivalent existing lines]
const GITIGNORE_RULES: Array<[string, RegExp]> = [
  ['.env.*',   /^\.env[\.\*]/m],
  ['*.log',    /^\*\.log/m],
  ['*.aidev.instructions.md', /^\*\.aidev\.instructions\.md/m],
  ['*.aidev.task.json',       /^\*\.aidev\.task\.json/m],
];

export function ensureGitignore(dir = process.cwd()): void {
  const gitignorePath = path.join(dir, '.gitignore');
  const existing = fs.existsSync(gitignorePath)
    ? fs.readFileSync(gitignorePath, 'utf8')
    : '';

  const missing = GITIGNORE_RULES
    .filter(([, regex]) => !regex.test(existing))
    .map(([pattern]) => pattern);

  if (missing.length === 0) return;

  const addition = (existing.endsWith('\n') || existing === '' ? '' : '\n')
    + missing.join('\n') + '\n';
  fs.appendFileSync(gitignorePath, addition, 'utf8');
  if (dir === process.cwd()) logger.info(`.gitignore — added: ${missing.join(', ')}`);
}

interface ClickUpMember {
  id: number;
  username: string;
  email: string;
}

export interface Answers {
  provider: 'clickup' | 'jira';
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
  // Shared
  assigneeTag: string;
  gitRemote: string;
  githubBaseBranch: string;
  githubRepo: string;
  agents: string;
  devNotesMode: string;
  triggerWord: string;
  thinkingTag: string;
  aidevEnvExtend: string;
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
    a.provider === 'jira'
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
    `# Agents to use, in fallback order (comma-separated: claude, cursor, windsurf)`,
    `AGENTS=${a.agents}`,
    ``,
    `# DEV_NOTES_MODE: smart (only ask when unclear) | always (ask before every task)`,
    `DEV_NOTES_MODE=${a.devNotesMode}`,
    ``,
    `# AIDEV_TRIGGER_WORD: comment containing this word re-triggers task processing (default: aidev-continue)`,
    `AIDEV_TRIGGER_WORD=${envVal(a.triggerWord)}`,
    ``,
    `# THINKING_TAG: tasks with this tag are analyzed and broken into sub-tasks before execution`,
    line('THINKING_TAG', a.thinkingTag),
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
    const provider = await choose(rl, 'Which task provider do you use?', ['clickup', 'jira'], existing.PROVIDER || 'clickup') as 'clickup' | 'jira';

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

    if (provider === 'jira') {
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

    // ── Validate agent permissions ──────────────────────────
    section('Agent permissions');
    await validateAgentPermissions(agents.split(','), rl);

    const devNotesMode = await choose(
      rl,
      `Dev notes mode ${hint('smart = ask AI if unclear, always = ask before every task')}`,
      ['smart', 'always'],
      existing.DEV_NOTES_MODE || 'smart'
    );

    // ── Trigger word ─────────────────────────────────────────
    section('Trigger word');
    const triggerWord = await ask(
      rl,
      `Trigger word ${hint('comment containing this re-triggers a skipped task')}`,
      existing.AIDEV_TRIGGER_WORD || 'aidev-continue'
    );

    // ── Thinking tag ────────────────────────────────────────
    section('Thinking tasks');
    const thinkingTag = await ask(
      rl,
      `Thinking tag ${hint('tasks with this tag are broken into sub-tasks before execution, optional')}`,
      existing.THINKING_TAG || ''
    );

    // ── Assignee ─────────────────────────────────────────────
    section('Assignee');
    const effectiveApiKey = clickupApiKey || process.env.CLICKUP_API_KEY || '';
    let assigneeTag: string;

    if (provider === 'clickup' && effectiveApiKey) {
      assigneeTag = await pickAssignee(rl, effectiveApiKey, existing.ASSIGNEE_TAG || '');
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
      assigneeTag,
      gitRemote,
      githubBaseBranch,
      githubRepo,
      agents,
      devNotesMode,
      triggerWord,
      thinkingTag,
    };

    ensureGitignore();
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

    printGhSuggestion(gitRemote);

    section('Schedule');
    await scheduleSetCommand();
  } finally {
    rl.close();
  }
}

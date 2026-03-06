import * as fs from 'node:fs';
import * as path from 'node:path';
import * as readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { logger } from '../logger';
import { detectRemote } from '../git';
import chalk from 'chalk';

const VALID_AGENTS = ['claude', 'cursor'] as const;

// Patterns we want guaranteed in .gitignore.
// Each entry: [pattern to write, regex that matches equivalent existing lines]
const GITIGNORE_RULES: Array<[string, RegExp]> = [
  ['.env.*',   /^\.env[\.\*]/m],
  ['*.log',    /^\*\.log/m],
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

async function pickAgents(rl: readline.Interface): Promise<string> {
  const available = [...VALID_AGENTS];

  console.log(`\n  Available agents:`);
  available.forEach((a, i) => console.log(`    ${chalk.cyan(String(i + 1))}. ${a}`));

  console.log(
    `\n  Enter agents ${hint('numbers or names, comma-separated — first = primary, rest = fallback')}`
  );

  while (true) {
    const raw = await rl.question(`  Agents in order ${dim(`[${available.join(',')}]`)}: `);

    if (!raw.trim()) return available.join(',');

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

async function pickAssignee(rl: readline.Interface, apiKey: string): Promise<string> {
  process.stdout.write(`  ${chalk.dim('Fetching current user...')}\r`);
  const user = await fetchCurrentUser(apiKey);
  process.stdout.write('                              \r');

  if (!user) {
    return ask(rl, `Assignee tag ${hint('optional — could not fetch user')}`, '');
  }

  const display = user.username && user.username !== 'null'
    ? `${user.username} <${user.email}>`
    : user.email;
  return ask(rl, `Assignee tag`, display);
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
    ...providerLines,
    ``,
    line('ASSIGNEE_TAG', a.assigneeTag),
    `GIT_REMOTE=${envVal(a.gitRemote)}`,
    `GITHUB_BASE_BRANCH=${envVal(a.githubBaseBranch)}`,
    line('GITHUB_REPO', a.githubRepo),
    ``,
    `# Agents to use, in fallback order (comma-separated: claude, cursor)`,
    `AGENTS=${a.agents}`,
    ``,
    `# DEV_NOTES_MODE: smart (only ask when unclear) | always (ask before every task)`,
    `DEV_NOTES_MODE=${a.devNotesMode}`,
    ``,
  ];
  return lines.filter((l) => l !== null).join('\n');
}

export async function initCommand(): Promise<void> {
  const dest = path.join(process.cwd(), '.env.aidev');

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
    console.log();
  }

  console.log(chalk.bold('\naidev setup') + dim(' — press Enter to accept defaults\n'));

  const rl = readline.createInterface({ input, output });

  try {
    // ── Provider ─────────────────────────────────────────────
    section('Task provider');
    const provider = await choose(rl, 'Which task provider do you use?', ['clickup', 'jira'], 'clickup') as 'clickup' | 'jira';

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
        '',
        true
      );
      jiraEmail = await ask(rl, `Jira email ${globalEnvHint}`, '', true);
      jiraApiToken = await ask(rl, `Jira API token ${globalEnvHint}`, '', true);
      jiraProject = await ask(
        rl,
        `Project key ${hint('e.g. PROJ')}`,
        '',
        true
      );
      jiraLabel = await ask(
        rl,
        `Label to filter issues ${hint('issues with this label will be picked up')}`,
        folderName
      );
      jiraPendingStatus = await ask(rl, 'Pending status name', 'To Do');
      jiraInReviewStatus = await ask(rl, 'In-review status name', 'In Review');
    } else {
      // ── ClickUp ──────────────────────────────────────────────
      section('ClickUp');
      clickupApiKey = await ask(rl, `API key ${globalEnvHint}`, '');
      clickupTeamId = await ask(rl, `Team / workspace ID ${globalEnvHint}`, '');
      clickupTag = await ask(
        rl,
        `Tag to filter tasks ${hint('tasks with this tag will be picked up')}`,
        folderName
      );
      clickupPendingStatus = await ask(rl, 'Pending status name', 'pending');
      clickupInReviewStatus = await ask(rl, 'In-review status name', 'review');
    }

    // ── Git / GitHub ─────────────────────────────────────────
    section('Git & GitHub');
    const detectedRemote = detectRemote() ?? 'origin';
    const gitRemote = await ask(rl, 'Git remote', detectedRemote);
    const githubBaseBranch = await ask(rl, 'Base branch', 'main');
    const githubRepo = await ask(
      rl,
      `GitHub repo ${hint('owner/repo — used for PR links, optional')}`,
      ''
    );

    // ── AI agents ────────────────────────────────────────────
    section('AI agents');
    const agents = await pickAgents(rl);
    const devNotesMode = await choose(
      rl,
      `Dev notes mode ${hint('smart = ask AI if unclear, always = ask before every task')}`,
      ['smart', 'always'],
      'smart'
    );

    // ── Assignee ─────────────────────────────────────────────
    section('Assignee');
    const effectiveApiKey = clickupApiKey || process.env.CLICKUP_API_KEY || '';
    let assigneeTag: string;

    if (provider === 'clickup' && effectiveApiKey) {
      assigneeTag = await pickAssignee(rl, effectiveApiKey);
    } else {
      assigneeTag = await ask(
        rl,
        `Assignee tag ${hint('optional')}`,
        ''
      );
    }

    const answers: Answers = {
      provider,
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
    };

    ensureGitignore();
    fs.writeFileSync(dest, renderEnv(answers), 'utf8');
    console.log();
    logger.success(`.env.aidev written to ${dest}`);
    logger.info(`Agents: ${agents} ${dim('(first = primary, rest = fallback)')}`);
  } finally {
    rl.close();
  }
}

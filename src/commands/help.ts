import chalk from 'chalk';
import { isGhInstalled, isGhAuthenticated, isGitHubRemote } from '../github';
import { detectRemote } from '../git';
import { commandExists, isWindows } from '../platform';

const b = chalk.bold;
const c = chalk.cyan;
const d = chalk.dim;
const g = chalk.green;
const y = chalk.yellow;

function ghStatusLine(): string {
  const remote = detectRemote() || 'origin';
  if (!isGitHubRemote(remote)) return '';

  if (!isGhInstalled()) {
    return `\n${b('GITHUB CLI')}\n` +
      `  ${chalk.yellow('!')} Install ${c('gh')} to auto-create PRs: ${c('https://cli.github.com/')}\n`;
  }
  if (!isGhAuthenticated()) {
    return `\n${b('GITHUB CLI')}\n` +
      `  ${chalk.yellow('!')} ${c('gh')} found but not authenticated — run ${c('gh auth login')}\n`;
  }
  return `\n${b('GITHUB CLI')}\n` +
    `  ${g('✓')} ${c('gh')} authenticated — PRs will be created automatically after push\n`;
}

/**
 * Returns the Windows Cursor Agent CLI line for help output.
 * Exported for tests; call with no args to use real platform.
 */
export function windowsCursorAgentLine(opts?: { isWindows: boolean; agentExists: boolean }): string {
  const win = opts?.isWindows ?? isWindows;
  const exists = opts?.agentExists ?? commandExists('agent');
  if (!win) return '';
  if (exists) {
    return `\n${b('CURSOR (WINDOWS)')}\n` +
      `  ${g('✓')} ${c('agent')} CLI found — Cursor runner is available\n`;
  }
  return `\n${b('CURSOR (WINDOWS)')}\n` +
    `  ${y('!')} Cursor runner needs the Agent CLI. Install: ${c("irm 'https://cursor.com/install?win32=true' | iex")}\n`;
}

export function helpCommand(): void {
  console.log(`
${b('aidev')} ${d('v0.1.0')} — AI-powered task executor

${b('USAGE')}
  ${c('aidev')} ${d('[command]')}

${b('COMMANDS')}
  ${c('init')}                        Interactive setup — create ${d('.env.aidev')}
  ${c('run')}                         Process all open + pending-with-replies tasks
  ${c('run open')}                    Only open (non-pending) tasks
  ${c('run pending')}                 Only pending tasks — check for human replies
  ${c('schedule set')} ${d('<cron>')}         Set cron schedule for this directory
  ${c('schedule get')}                Show current cron schedule
  ${c('help')}                        Show this help message

${b('TRIGGER WORD')}
  When a task is skipped (branch exists or pending with no reply), post a comment
  containing the trigger word ${d('(default: aidev-continue)')} to re-trigger processing.
  The existing branch will be reused. Set ${c('AIDEV_TRIGGER_WORD')} to customise.

${b('NON-CODE TASKS')}
  Tasks tagged with the ${c('NON_CODE_TAG')} are executed without git branching —
  no checkout, commit, push, or PR creation. The AI agent runs the task directly
  in the current working directory. Useful for research, documentation, or tasks
  that don't produce code changes requiring review.
  Optionally use a different ClickUp team (${c('NON_CODE_CLICKUP_TEAM_ID')}) or
  Jira project (${c('NON_CODE_JIRA_PROJECT')}) for non-code tasks.
  If ${c('NON_CODE_TAG')} is not set, it defaults to ${d('<folder-name>-other')}.

${b('EXAMPLES')}
  ${d('$')} ${g('aidev init')}
  ${d('$')} ${g('aidev run')}
  ${d('$')} ${g('aidev run open')}
  ${d('$')} ${g('aidev schedule set "*/30 * * * *"')}
  ${d('$')} ${g('aidev schedule get')}

${b('CONFIG')}  ${d('.env.aidev in your project directory')}
  ${d('CLICKUP_API_KEY')}      ClickUp personal API token
  ${d('CLICKUP_TEAM_ID')}      Workspace / team ID
  ${d('CLICKUP_TAG')}          Tag used to filter tasks ${d('(default: folder name)')}
  ${d('AGENTS')}               Agent order: ${c('claude,cursor')} ${d('| cursor,claude | claude | cursor')}
  ${d('DEV_NOTES_MODE')}       ${c('smart')} ${d('(default) | always')}
  ${d('AIDEV_TRIGGER_WORD')}   Trigger word to re-process a skipped task ${d('(default: aidev-continue)')}
  ${d('NON_CODE_TAG')}         Tag for non-code tasks ${d('(default: <folder-name>-other)')}
  ${d('GIT_REMOTE')}           Remote name ${d('(auto-detected if unset)')}
  ${d('GITHUB_BASE_BRANCH')}   Base branch ${d('(default: main)')}
  ${d('GITHUB_REPO')}          ${d('owner/repo')} for PR links
${ghStatusLine()}${windowsCursorAgentLine()}
  Run ${c('aidev init')} to configure interactively.
`);
}

import chalk from 'chalk';

const b = chalk.bold;
const c = chalk.cyan;
const d = chalk.dim;
const g = chalk.green;

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

${b('EXAMPLES')}
  ${d('$')} ${g('aidev init')}
  ${d('$')} ${g('aidev run')}
  ${d('$')} ${g('aidev run open')}
  ${d('$')} ${g('aidev schedule set "*/30 * * * *"')}
  ${d('$')} ${g('aidev schedule get')}

${b('CONFIG')}  ${d('.env.aidev in your project directory')}
  ${d('CLICKUP_API_KEY')}      ClickUp personal API token
  ${d('CLICKUP_TEAM_ID')}      Workspace / team ID
  ${d('CLICKUP_TAG')}          Tag used to filter tasks
  ${d('AGENTS')}               Agent order: ${c('claude,cursor')} ${d('| cursor,claude | claude | cursor')}
  ${d('DEV_NOTES_MODE')}       ${c('smart')} ${d('(default) | always')}
  ${d('GIT_REMOTE')}           Remote name ${d('(auto-detected if unset)')}
  ${d('GITHUB_BASE_BRANCH')}   Base branch ${d('(default: main)')}
  ${d('GITHUB_REPO')}          ${d('owner/repo')} for PR links

  Run ${c('aidev init')} to configure interactively.
`);
}

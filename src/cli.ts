#!/usr/bin/env node
import { Command } from 'commander';
import { initCommand } from './commands/init';
import { runCommand, RunFilter } from './commands/run';
import { scheduleSetCommand, scheduleGetCommand, scheduleRemoveCommand, scheduleFixCommand } from './commands/schedule';
import { tasksAddCommand, tasksRemoveCommand, tasksLsCommand, tasksUpdateCommand } from './commands/tasks';
import { helpCommand } from './commands/help';
import { stopCommand } from './commands/stop';
import { loadConfig } from './config';
import { createProvider, TaskProvider } from './providers';
import { createRunners } from './ai';
import { processLocalTasks } from './tasks';
import { logger } from './logger';
import { Config } from './types';
import { loadHooks, createHookVM } from './hooks';
import { acceptedCommand } from './commands/accepted';
import { isGhInstalled } from './github';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { version } = require('../package.json') as { version: string };

const program = new Command();

program
  .name('aidev')
  .description('AI-powered task executor — implements ClickUp tasks with Claude or Cursor')
  .version(version)
  .option('-e, --env <path>', 'path to env file (default: .env.aidev)');

program
  .command('init')
  .description('Create .env.aidev from template in current directory')
  .action(async () => {
    await initCommand();
  });

program
  .command('help')
  .description('Show help')
  .action(() => {
    helpCommand();
  });

async function runWithFilter(filter: string | undefined): Promise<void> {
  const validFilters = ['all', 'open', 'pending', 'tasks', 'accepted'];

  if (filter && !validFilters.includes(filter)) {
    logger.error(`Unknown filter: ${filter}. Valid options: all, open, pending, tasks, accepted`);
    process.exit(1);
  }

  try {
    const { env } = program.opts<{ env?: string }>();
    const config = loadConfig(env);
    const provider = createProvider(config);

    // Handle "accepted" filter separately — no AI, just merge accepted PRs
    if (filter === 'accepted') {
      await acceptedCommand(config, provider);
      return;
    }

    let nonCodeProvider: TaskProvider | undefined;
    if (config.nonCodeTag) {
      const nonCodeConfig: Config = {
        ...config,
        clickupTag: config.nonCodeTag,
        clickupTeamId: config.nonCodeClickupTeamId || config.clickupTeamId,
        jiraLabel: config.nonCodeTag,
        jiraProject: config.nonCodeJiraProject || config.jiraProject,
        linearLabel: config.nonCodeTag,
        linearTeamId: config.nonCodeLinearTeamId || config.linearTeamId,
        trelloLabel: config.nonCodeTag,
      };
      nonCodeProvider = createProvider(nonCodeConfig, 'non-code');
    }

    // Always process local tasks (aidev.tasks.json)
    const localResult = await processLocalTasks(config, provider, nonCodeProvider);
    if (localResult.pushed > 0 || localResult.skipped > 0) {
      logger.info(`Local tasks: ${localResult.pushed} pushed, ${localResult.skipped} skipped`);
    }

    if (filter === 'tasks') return;

    const resolvedFilter: RunFilter = (filter as RunFilter) || 'all';
    const runners = createRunners(config);
    const hooks = loadHooks(config.hooksPath);
    const hookVM = createHookVM(provider, runners);
    await runCommand(resolvedFilter, config, provider, runners, nonCodeProvider, hooks, hookVM);

    // Auto-merge accepted PRs if configured (requires gh CLI)
    if (config.acceptedTag && isGhInstalled()) {
      await acceptedCommand(config, provider);
    }
  } catch (err) {
    logger.error(String(err));
    process.exit(1);
  }
}

program
  .command('run [filter]', { isDefault: true })
  .description('Process tasks: all (default), open, pending, tasks, or accepted')
  .action(async (filter?: string) => {
    await runWithFilter(filter);
  });

program
  .command('stop')
  .description('Stop any running aidev process in the current directory')
  .action(() => {
    stopCommand();
  });

const scheduleCmd = program
  .command('schedule')
  .description('Manage cron schedule for aidev in current directory');

scheduleCmd
  .command('set [cron]')
  .description('Set cron schedule — interactive picker if no cron given')
  .action(async (cron?: string) => {
    await scheduleSetCommand(cron);
  });

scheduleCmd
  .command('get')
  .description('Show all aidev cron schedules as a table')
  .action(async () => {
    await scheduleGetCommand();
  });

scheduleCmd
  .command('remove [id]')
  .description('Remove an aidev cron schedule by table ID (interactive if omitted)')
  .action(async (id?: string) => {
    await scheduleRemoveCommand(id ? parseInt(id, 10) : undefined);
  });

scheduleCmd
  .command('fix')
  .description('Rebuild all aidev schedules with current binary paths and config')
  .action(() => {
    scheduleFixCommand();
  });

const tasksCmd = program
  .command('tasks')
  .description('Manage local tasks (aidev.tasks.json)');

tasksCmd
  .command('add')
  .description('Add a new local task (interactive)')
  .action(async () => {
    await tasksAddCommand();
  });

tasksCmd
  .command('remove [id]')
  .description('Remove a local task by table ID (interactive if omitted)')
  .action(async (id?: string) => {
    await tasksRemoveCommand(id);
  });

tasksCmd
  .command('ls')
  .description('List all local tasks')
  .action(async () => {
    await tasksLsCommand();
  });

tasksCmd
  .command('update [id]')
  .description('Update a local task by table ID (interactive if omitted)')
  .action(async (id?: string) => {
    await tasksUpdateCommand(id);
  });

program.parse(process.argv);

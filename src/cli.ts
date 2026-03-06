#!/usr/bin/env node
import { Command } from 'commander';
import { initCommand } from './commands/init';
import { runCommand, RunFilter } from './commands/run';
import { scheduleSetCommand, scheduleGetCommand } from './commands/schedule';
import { helpCommand } from './commands/help';
import { loadConfig } from './config';
import { createProvider } from './providers';
import { createRunners } from './ai';
import { logger } from './logger';

const program = new Command();

program
  .name('aidev')
  .description('AI-powered task executor — implements ClickUp tasks with Claude or Cursor')
  .version('0.1.0')
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
  const validFilters: RunFilter[] = ['all', 'open', 'pending'];
  const resolvedFilter: RunFilter =
    filter && validFilters.includes(filter as RunFilter)
      ? (filter as RunFilter)
      : 'all';

  if (filter && !validFilters.includes(filter as RunFilter)) {
    logger.error(`Unknown filter: ${filter}. Valid options: all, open, pending`);
    process.exit(1);
  }

  try {
    const { env } = program.opts<{ env?: string }>();
    const config = loadConfig(env);
    const provider = createProvider(config);
    const runners = createRunners(config);
    await runCommand(resolvedFilter, config, provider, runners);
  } catch (err) {
    logger.error(String(err));
    process.exit(1);
  }
}

program
  .command('run [filter]', { isDefault: true })
  .description('Process tasks: all (default), open, or pending')
  .action(async (filter?: string) => {
    await runWithFilter(filter);
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
  .description('Show current cron schedule for this directory')
  .action(async () => {
    await scheduleGetCommand();
  });

program.parse(process.argv);

#!/usr/bin/env node
import { Command } from 'commander';
import { initCommand } from './commands/init';
import { runCommand, RunFilter } from './commands/run';
import { scheduleSetCommand, scheduleGetCommand, scheduleRemoveCommand, scheduleFixCommand } from './commands/schedule';
import {
  tasksAddCommand,
  tasksRemoveCommand,
  tasksLsCommand,
  tasksPushCommand,
  tasksUpdateCommand,
  tasksListCommand,
  tasksGetCommand,
  tasksDeleteCommand,
  tasksCommentCommand,
  tasksModifyCommand,
  tasksTagCommand,
  tasksUntagCommand,
  tasksStatusCommand,
  tasksHelpCommand,
} from './commands/tasks';
import { helpCommand } from './commands/help';
import { stopCommand } from './commands/stop';
import { uiCommand } from './commands/ui';
import { loadConfigWithInheritance } from './config';
import { buildConsultProviderConfig, buildNonCodeProviderConfig } from './providerViews';
import { createProvider, TaskProvider } from './providers';
import { createRunners } from './ai';
import { materializeMcp } from './mcp';
import { processLocalTasks } from './tasks';
import { logger } from './logger';
import { loadHooks, createHookVM } from './hooks';
import { acceptedCommand } from './commands/accepted';
import { agentReviewCommand } from './commands/agentReview';
import { isGhInstalled, isGhAuthenticated } from './github';
import { isScreenAvailable } from './platform';
import { hooksGenerateCommand, hooksUpdateCommand } from './commands/hooks';

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

async function runWithFilter(filter: string | undefined, taskId?: string): Promise<void> {
  const validFilters = ['all', 'open', 'pending', 'review', 'tasks', 'accepted'];

  if (filter && !validFilters.includes(filter)) {
    logger.error(`Unknown filter: ${filter}. Valid options: all, open, pending, review, tasks, accepted`);
    process.exit(1);
  }

  try {
    const { env } = program.opts<{ env?: string }>();
    const config = await loadConfigWithInheritance(env);
    const provider = createProvider(config);

    // Handle "accepted" filter separately — no AI, just merge accepted PRs
    if (filter === 'accepted') {
      await acceptedCommand(config, provider);
      return;
    }

    // Single-task execution skips the local-push/non-code/accepted machinery:
    // the UI's "Execute" action targets exactly one remote task.
    let nonCodeProvider: TaskProvider | undefined;
    if (config.nonCodeTag && !taskId) {
      nonCodeProvider = createProvider(buildNonCodeProviderConfig(config), 'non-code');
    }

    let consultProvider: TaskProvider | undefined;
    if (config.consultTag && !taskId) {
      consultProvider = createProvider(buildConsultProviderConfig(config), 'consult');
    }

    if (!taskId) {
      // Always process local tasks (aidev.tasks.json)
      const localResult = await processLocalTasks(config, provider, nonCodeProvider);
      if (localResult.pushed > 0 || localResult.skipped > 0) {
        logger.info(`Local tasks: ${localResult.pushed} pushed, ${localResult.skipped} skipped`);
      }
    }

    if (filter === 'tasks') return;

    const resolvedFilter: RunFilter = (filter as RunFilter) || 'all';
    materializeMcp(config);
    const runners = createRunners(config);
    const hooks = loadHooks(config.hooksPath);
    const hookVM = createHookVM(provider, runners);
    await runCommand(resolvedFilter, config, provider, runners, nonCodeProvider, consultProvider, hooks, hookVM, taskId);

    if (!taskId && config.agentReviewTag && isGhInstalled() && isGhAuthenticated()) {
      const screenAvailable = isScreenAvailable();
      await agentReviewCommand(config, provider, runners, screenAvailable);
    }

    // Auto-merge accepted PRs if configured (requires gh CLI)
    if (!taskId && config.acceptedTag && isGhInstalled()) {
      await acceptedCommand(config, provider);
    }
  } catch (err) {
    logger.error(String(err));
    process.exit(1);
  }
}

program
  .command('run [filter]', { isDefault: true })
  .description('Process tasks: all (default), open, pending, review, tasks, or accepted. Also checks review tasks for unresolved PR comments and runs agent review on tagged in-review tasks.')
  .option('--task <id>', 'process only the task with this provider id (skips local-task push, non-code, agent review, accepted, and review phases)')
  .option('--status <status>', 'alias for the positional filter — used by the aidev ui dashboard (open, pending, review, all)')
  .action(async (filter: string | undefined, opts: { task?: string; status?: string }) => {
    // --status is just a long-form alias for the positional filter so the UI's
    // Run screen can spawn `aidev run --status <status>` without worrying about
    // commander positional parsing. Explicit positional wins if both are given.
    const effectiveFilter = filter ?? opts.status;
    await runWithFilter(effectiveFilter, opts.task);
  });

program
  .command('stop')
  .description('Stop any running aidev process in the current directory')
  .action(() => {
    stopCommand();
  });

program
  .command('ui')
  .description('Run the aidev dashboard UI (Nuxt app) on a local port')
  .option('--port <number>', 'port to bind on 127.0.0.1', '19422')
  .option('--prod', 'serve the built Nuxt output if present (falls back to dev)')
  .action(async (opts: { port?: string; prod?: boolean }) => {
    try {
      await uiCommand(opts);
    } catch (err) {
      logger.error(String(err));
      process.exit(1);
    }
  });

const scheduleCmd = program
  .command('schedule')
  .description('Manage cron schedule for aidev in current directory');

scheduleCmd
  .command('set [cron]')
  .description('Set cron schedule — interactive picker if no cron given. Pass -e <path> to embed a custom env file in the scheduled command.')
  .action(async (cron: string | undefined) => {
    // -e is defined on the root program and commander captures it there even
    // when it appears after the subcommand name, so read it from program.opts().
    const { env } = program.opts<{ env?: string }>();
    const extraArgs = env ? ['-e', env] : [];
    await scheduleSetCommand(cron, extraArgs);
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
  .command('help')
  .description('Print an agent-oriented guide to the `aidev tasks` CLI (safe to use inside a running task)')
  .action(() => {
    tasksHelpCommand();
  });

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

tasksCmd
  .command('push')
  .description('Publish all tasks from aidev.tasks.json to the configured provider')
  .action(async () => {
    const { env } = program.opts<{ env?: string }>();
    try {
      await tasksPushCommand(env);
    } catch (err) {
      logger.error(String(err));
      process.exit(1);
    }
  });

tasksCmd
  .command('list [filter]')
  .description('List tasks (local .aidev/tasks by default, or the configured provider with --remote). Filter is a comma-separated list of statuses.')
  .option('--remote', 'operate against the configured provider instead of local .aidev/tasks')
  .option('-o, --output <format>', 'output format: table, json, or csv', 'table')
  .action(async (filter: string | undefined, opts: { remote?: boolean; output?: string }) => {
    const { env } = program.opts<{ env?: string }>();
    try {
      await tasksListCommand(filter, opts, env);
    } catch (err) {
      logger.error(String(err));
      process.exit(1);
    }
  });

tasksCmd
  .command('get <id>')
  .description('Get a single task by id (local .aidev/tasks by default, or the configured provider with --remote)')
  .option('--remote', 'operate against the configured provider instead of local .aidev/tasks')
  .option('--attachments', 'download attachments if the provider supports it')
  .option('-o, --output <format>', 'output format: table, json, or csv', 'table')
  .action(async (id: string, opts: { remote?: boolean; output?: string; attachments?: boolean }) => {
    const { env } = program.opts<{ env?: string }>();
    try {
      await tasksGetCommand(id, opts, env);
    } catch (err) {
      logger.error(String(err));
      process.exit(1);
    }
  });

tasksCmd
  .command('delete <id>')
  .description('Delete a task by id (local .aidev/tasks by default, or the configured provider with --remote)')
  .option('--remote', 'operate against the configured provider instead of local .aidev/tasks')
  .action(async (id: string, opts: { remote?: boolean }) => {
    const { env } = program.opts<{ env?: string }>();
    try {
      await tasksDeleteCommand(id, opts, env);
    } catch (err) {
      logger.error(String(err));
      process.exit(1);
    }
  });

tasksCmd
  .command('comment <id> <content>')
  .description('Post a comment on a task (local .aidev/tasks by default, or the configured provider with --remote)')
  .option('--remote', 'operate against the configured provider instead of local .aidev/tasks')
  .option('--as-aidev', 'prepend the configured commentPrefix to the comment text')
  .action(async (id: string, content: string, opts: { remote?: boolean; asAidev?: boolean }) => {
    const { env } = program.opts<{ env?: string }>();
    try {
      await tasksCommentCommand(id, content, opts, env);
    } catch (err) {
      logger.error(String(err));
      process.exit(1);
    }
  });

tasksCmd
  .command('modify <id>')
  .description('Update a task\'s status (local .aidev/tasks by default, or the configured provider with --remote). Only --status is supported; --title/--description are not yet supported by TaskProvider.')
  .option('--remote', 'operate against the configured provider instead of local .aidev/tasks')
  .option('--status <status>', 'new status to set')
  .option('--title <title>', 'not yet supported — TaskProvider has no updateTask(id, {title, description}) method')
  .option('--description <description>', 'not yet supported — TaskProvider has no updateTask(id, {title, description}) method')
  .action(async (id: string, opts: { remote?: boolean; status?: string; title?: string; description?: string }) => {
    const { env } = program.opts<{ env?: string }>();
    try {
      await tasksModifyCommand(id, opts, env);
    } catch (err) {
      logger.error(String(err));
      process.exit(1);
    }
  });

tasksCmd
  .command('tag <id> <tags>')
  .description('Add one or more comma-separated tags to a task (local .aidev/tasks by default, or the configured provider with --remote)')
  .option('--remote', 'operate against the configured provider instead of local .aidev/tasks')
  .action(async (id: string, tags: string, opts: { remote?: boolean }) => {
    const { env } = program.opts<{ env?: string }>();
    try {
      await tasksTagCommand(id, tags, opts, env);
    } catch (err) {
      logger.error(String(err));
      process.exit(1);
    }
  });

tasksCmd
  .command('untag <id> <tags>')
  .description('Remove one or more comma-separated tags from a task (local .aidev/tasks by default, or the configured provider with --remote)')
  .option('--remote', 'operate against the configured provider instead of local .aidev/tasks')
  .action(async (id: string, tags: string, opts: { remote?: boolean }) => {
    const { env } = program.opts<{ env?: string }>();
    try {
      await tasksUntagCommand(id, tags, opts, env);
    } catch (err) {
      logger.error(String(err));
      process.exit(1);
    }
  });

tasksCmd
  .command('status <id> [newStatus]')
  .description('Get or set a task\'s status (local .aidev/tasks by default, or the configured provider with --remote). When newStatus is omitted, prints the current status. Logical names (open, pending, review, done) are resolved through the configured status mapping.')
  .option('--remote', 'operate against the configured provider instead of local .aidev/tasks')
  .option('-o, --output <format>', 'output format for get mode: table, json, or csv', 'table')
  .action(async (id: string, newStatus: string | undefined, opts: { remote?: boolean; output?: string }) => {
    const { env } = program.opts<{ env?: string }>();
    try {
      await tasksStatusCommand(id, newStatus, opts, env);
    } catch (err) {
      logger.error(String(err));
      process.exit(1);
    }
  });

const hooksCmd = program
  .command('hooks')
  .description('Manage the aidev hooks file');

hooksCmd
  .command('generate')
  .description('Write a fresh hooks boilerplate to AIDEV_HOOKS_PATH (aborts if file exists without --force)')
  .option('--force', 'overwrite an existing hooks file')
  .action(async (opts: { force?: boolean }) => {
    const { env } = program.opts<{ env?: string }>();
    try {
      await hooksGenerateCommand(opts, env);
    } catch (err) {
      logger.error(String(err));
      process.exit(1);
    }
  });

hooksCmd
  .command('update')
  .description('Append stubs for any missing hooks to the existing hooks file')
  .action(async () => {
    const { env } = program.opts<{ env?: string }>();
    try {
      await hooksUpdateCommand(env);
    } catch (err) {
      logger.error(String(err));
      process.exit(1);
    }
  });

program.parse(process.argv);

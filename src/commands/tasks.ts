import * as crypto from 'node:crypto';
import * as readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import chalk from 'chalk';
import { Config, LocalTask } from '../types';
import { processLocalTasks, readTasksFile, writeTasksFile } from '../tasks';
import { parseCron } from '../cron';
import { logger } from '../logger';
import { loadConfig } from '../config';
import { createProvider, TaskProvider } from '../providers';

// ─── Shared helpers ───────────────────────────────────────────────────────────

function dim(s: string): string {
  return chalk.dim(s);
}

function hint(s: string): string {
  return chalk.dim(`(${s})`);
}

async function ask(
  rl: readline.Interface,
  question: string,
  defaultVal = '',
  required = false,
): Promise<string> {
  const suffix = defaultVal ? chalk.dim(` [${defaultVal}]`) : '';
  while (true) {
    const raw = await rl.question(`  ${question}${suffix}: `);
    const val = raw.trim() || defaultVal;
    if (required && !val) {
      console.log(chalk.yellow('  This field is required.'));
      continue;
    }
    return val;
  }
}

async function choose(
  rl: readline.Interface,
  question: string,
  options: string[],
  defaultVal: string,
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

function validateCron(expr: string): boolean {
  try {
    parseCron(expr);
    return true;
  } catch {
    return false;
  }
}

async function askCron(rl: readline.Interface, defaultVal = ''): Promise<string> {
  const suffix = defaultVal ? chalk.dim(` [${defaultVal}]`) : '';
  while (true) {
    const raw = await rl.question(
      `  Cron expression ${hint('5-field, blank for one-shot')}${suffix}: `,
    );
    const val = raw.trim() || defaultVal;
    if (!val) return '';
    if (validateCron(val)) return val;
    console.log(chalk.yellow('  Invalid cron expression. Use 5 fields: minute hour day month weekday'));
  }
}

async function collectTaskFields(
  rl: readline.Interface,
  defaults: Partial<LocalTask> = {},
): Promise<Omit<LocalTask, 'id' | 'lastPushedAt'>> {
  const title = await ask(rl, 'Title', defaults.title || '', true);
  const description = await ask(rl, 'Description', defaults.description || '');
  const type = (await choose(rl, 'Type', ['code', 'non-code'], defaults.type || 'code')) as
    | 'code'
    | 'non-code';

  const priorityRaw = await ask(
    rl,
    `Priority ${hint('1=urgent 2=high 3=normal 4=low, blank=none')}`,
    defaults.priority ? String(defaults.priority) : '',
  );
  const priority = priorityRaw ? parseInt(priorityRaw, 10) : undefined;

  const dueDate = await ask(
    rl,
    `Due date ${hint('YYYY-MM-DD, blank=none')}`,
    defaults.dueDate || '',
  );

  const tagsRaw = await ask(
    rl,
    `Extra tags ${hint('comma-separated, blank=none')}`,
    (defaults.tags ?? []).join(','),
  );
  const tags = tagsRaw ? tagsRaw.split(',').map((t) => t.trim()).filter(Boolean) : undefined;

  const listId = await ask(
    rl,
    `List / project ID ${hint('blank=use env default')}`,
    defaults.listId || '',
  );

  const cron = await askCron(rl, defaults.cron || '');

  return {
    title,
    description,
    type,
    ...(priority !== undefined ? { priority } : {}),
    ...(dueDate ? { dueDate } : {}),
    ...(tags && tags.length > 0 ? { tags } : {}),
    ...(listId ? { listId } : {}),
    ...(cron ? { cron } : {}),
  };
}

// ─── Table rendering ──────────────────────────────────────────────────────────

function printTasksTable(tasks: LocalTask[]): void {
  const idW = 4;
  const titleW = Math.max(5, ...tasks.map((t) => t.title.length));
  const typeW = 8;
  const cronW = Math.max(4, ...tasks.map((t) => (t.cron || '—').length));
  const prioW = 8;

  const header =
    `  ${chalk.bold('ID'.padEnd(idW))}  ` +
    `${chalk.bold('Title'.padEnd(titleW))}  ` +
    `${chalk.bold('Type'.padEnd(typeW))}  ` +
    `${chalk.bold('Priority'.padEnd(prioW))}  ` +
    chalk.bold('Cron'.padEnd(cronW));

  const sep =
    `  ${'─'.repeat(idW)}  ` +
    `${'─'.repeat(titleW)}  ` +
    `${'─'.repeat(typeW)}  ` +
    `${'─'.repeat(prioW)}  ` +
    '─'.repeat(cronW);

  console.log(header);
  console.log(sep);

  const prioNames: Record<number, string> = { 1: 'urgent', 2: 'high', 3: 'normal', 4: 'low' };

  tasks.forEach((t, i) => {
    const id = chalk.cyan(String(i + 1).padStart(idW));
    const title = t.title.padEnd(titleW);
    const type = t.type === 'code' ? chalk.green(t.type.padEnd(typeW)) : chalk.yellow(t.type.padEnd(typeW));
    const prio = (t.priority ? prioNames[t.priority] || String(t.priority) : '—').padEnd(prioW);
    const cron = (t.cron || '—').padEnd(cronW);
    console.log(`  ${id}  ${title}  ${type}  ${prio}  ${cron}`);
  });
}

async function pickTaskIndex(rl: readline.Interface, tasks: LocalTask[]): Promise<number> {
  while (true) {
    const raw = await rl.question(`\n  Select task ${dim('[1]')}: `);
    const val = raw.trim() || '1';
    const n = parseInt(val, 10);
    if (n >= 1 && n <= tasks.length) return n - 1;
    console.log(chalk.yellow(`  Enter a number between 1 and ${tasks.length}.`));
  }
}

// ─── Commands ─────────────────────────────────────────────────────────────────

export async function tasksAddCommand(): Promise<void> {
  console.log(chalk.bold('\nAdd a local task\n'));

  const rl = readline.createInterface({ input, output });
  try {
    const fields = await collectTaskFields(rl);
    const task: LocalTask = {
      id: crypto.randomUUID(),
      ...fields,
    };

    const tasks = readTasksFile();
    tasks.push(task);
    writeTasksFile(tasks);

    console.log();
    logger.success(`Task added: "${task.title}"${task.cron ? ` (cron: ${task.cron})` : ''}`);
  } finally {
    rl.close();
  }
}

export async function tasksRemoveCommand(id?: string): Promise<void> {
  const tasks = readTasksFile();
  if (tasks.length === 0) {
    logger.warn('No local tasks found');
    return;
  }

  let idx: number;
  if (id !== undefined) {
    idx = parseInt(id, 10) - 1;
  } else {
    console.log();
    printTasksTable(tasks);
    console.log();

    const rl = readline.createInterface({ input, output });
    try {
      idx = await pickTaskIndex(rl, tasks);
    } finally {
      rl.close();
    }
  }

  if (idx < 0 || idx >= tasks.length) {
    logger.error(`Invalid ID: ${(idx + 1)}. Valid range: 1–${tasks.length}`);
    process.exit(1);
  }

  const removed = tasks.splice(idx, 1)[0];
  writeTasksFile(tasks);
  logger.success(`Removed task: "${removed.title}"`);
}

export async function tasksLsCommand(): Promise<void> {
  const tasks = readTasksFile();
  if (tasks.length === 0) {
    logger.warn('No local tasks found');
    logger.info('Use "aidev tasks add" to create one.');
    return;
  }

  logger.info(`Local tasks (${tasks.length}):`);
  console.log();
  printTasksTable(tasks);
  console.log();
}

export async function tasksPushCommand(envPath?: string): Promise<void> {
  const tasks = readTasksFile();
  if (tasks.length === 0) {
    logger.warn('No local tasks found in aidev.tasks.json');
    logger.info('Use "aidev tasks add" to create one.');
    return;
  }

  const config = loadConfig(envPath);
  const provider = createProvider(config);

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

  const result = await processLocalTasks(config, provider, nonCodeProvider);
  logger.info(`Local tasks: ${result.pushed} pushed, ${result.skipped} skipped`);
}

export async function tasksUpdateCommand(id?: string): Promise<void> {
  const tasks = readTasksFile();
  if (tasks.length === 0) {
    logger.warn('No local tasks found');
    return;
  }

  let idx: number;

  const rl = readline.createInterface({ input, output });
  try {
    if (id !== undefined) {
      idx = parseInt(id, 10) - 1;
    } else {
      console.log();
      printTasksTable(tasks);
      console.log();
      idx = await pickTaskIndex(rl, tasks);
    }

    if (idx < 0 || idx >= tasks.length) {
      logger.error(`Invalid ID: ${(idx + 1)}. Valid range: 1–${tasks.length}`);
      process.exit(1);
    }

    const existing = tasks[idx];
    console.log(chalk.bold(`\nUpdate task: "${existing.title}"\n`));

    const fields = await collectTaskFields(rl, existing);
    tasks[idx] = {
      id: existing.id,
      ...fields,
      ...(existing.lastPushedAt !== undefined ? { lastPushedAt: existing.lastPushedAt } : {}),
    };
    writeTasksFile(tasks);

    console.log();
    logger.success(`Task updated: "${tasks[idx].title}"`);
  } finally {
    rl.close();
  }
}

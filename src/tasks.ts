import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { Config, LocalTask } from './types';
import { TaskProvider } from './providers';
import { shouldCronFire } from './cron';
import { logger } from './logger';

const TASKS_FILENAME = 'aidev.tasks.json';

export function tasksFilePath(dir = process.cwd()): string {
  return path.join(dir, TASKS_FILENAME);
}

export function readTasksFile(dir?: string): LocalTask[] {
  const p = tasksFilePath(dir);
  if (!fs.existsSync(p)) return [];
  try {
    const raw = JSON.parse(fs.readFileSync(p, 'utf8')) as unknown;
    if (!Array.isArray(raw)) return [];
    return raw as LocalTask[];
  } catch {
    return [];
  }
}

export function writeTasksFile(tasks: LocalTask[], dir?: string): void {
  fs.writeFileSync(tasksFilePath(dir), JSON.stringify(tasks, null, 2) + '\n', 'utf8');
}

function resolveTag(task: LocalTask, config: Config): string {
  if (task.type === 'code') return config.clickupTag;
  return config.nonCodeTag || config.clickupTag;
}

function resolveProvider(
  task: LocalTask,
  codeProvider: TaskProvider,
  nonCodeProvider?: TaskProvider,
): TaskProvider {
  if (task.type === 'non-code' && nonCodeProvider) return nonCodeProvider;
  return codeProvider;
}

function ensureTaskId(task: LocalTask): string {
  if (!task.id) {
    task.id = crypto.randomUUID();
  }
  return task.id;
}

function keepQueuedTask(task: LocalTask, toRemove: Set<string>): boolean {
  const id = task.id;
  return id === undefined || !toRemove.has(id);
}

export interface ProcessLocalTasksResult {
  pushed: number;
  skipped: number;
}

export async function processLocalTasks(
  config: Config,
  provider: TaskProvider,
  nonCodeProvider?: TaskProvider,
): Promise<ProcessLocalTasksResult> {
  const tasks = readTasksFile();
  if (tasks.length === 0) return { pushed: 0, skipped: 0 };

  let pushed = 0;
  let skipped = 0;
  let modified = false;
  const toRemove = new Set<string>();

  for (const task of tasks) {
    const hadId = Boolean(task.id);
    const taskId = ensureTaskId(task);
    if (!hadId) modified = true;

    if (task.cron) {
      if (!shouldCronFire(task.cron, task.lastPushedAt)) {
        skipped++;
        continue;
      }
    }

    const tag = resolveTag(task, config);
    const targetProvider = resolveProvider(task, provider, nonCodeProvider);
    const tags = [tag, ...(task.tags ?? [])];

    try {
      const result = await targetProvider.createTask({
        title: task.title,
        description: task.description,
        tags,
        priority: task.priority,
        dueDate: task.dueDate ? new Date(task.dueDate).getTime() : undefined,
        listId: task.listId,
      });

      logger.success(`Pushed task "${task.title}" → ${result.url}`);
      pushed++;

      if (task.cron) {
        task.lastPushedAt = Date.now();
        modified = true;
      } else {
        toRemove.add(taskId);
        modified = true;
      }
    } catch (err) {
      logger.error(`Failed to push task "${task.title}": ${err}`);
      skipped++;
    }
  }

  if (modified) {
    const remaining = tasks.filter((t) => keepQueuedTask(t, toRemove));
    writeTasksFile(remaining);
  }

  return { pushed, skipped };
}

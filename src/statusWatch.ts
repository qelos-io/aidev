import { AIRunner, AIRunResult } from './ai/base';
import { logger } from './logger';
import { TaskProvider } from './providers';
import { Config, Task } from './types';
import { isActiveImplementationStatus } from './taskStatus';

export { isActiveImplementationStatus } from './taskStatus';

export const STATUS_POLL_INTERVAL_MS = 5000;

export type ImplementationTagMode = 'code' | 'non-code';

export type ImplementationStatusCheck =
  | { active: true }
  | { active: false; reason: string };

export function resolveImplementationTag(config: Config, mode: ImplementationTagMode): string {
  if (mode === 'non-code') {
    return config.nonCodeTag || config.clickupTag;
  }
  return config.clickupTag;
}

function taskHasTag(task: Task, tag: string): boolean {
  if (!tag) return true;
  const wanted = tag.toLowerCase();
  return task.tags.some((t) => t.toLowerCase() === wanted);
}

export async function checkImplementationStillActive(
  provider: TaskProvider,
  taskId: string,
  config: Config,
  tagMode: ImplementationTagMode = 'code',
): Promise<ImplementationStatusCheck> {
  if (!provider.fetchTaskById) {
    return { active: true };
  }

  const task = await provider.fetchTaskById(taskId);
  if (task === null) {
    return { active: false, reason: 'task was deleted or archived' };
  }

  if (!isActiveImplementationStatus(task.status, config)) {
    return { active: false, reason: `status changed to "${task.status}"` };
  }

  const requiredTag = resolveImplementationTag(config, tagMode);
  if (requiredTag && !taskHasTag(task, requiredTag)) {
    return { active: false, reason: `required tag "${requiredTag}" was removed` };
  }

  return { active: true };
}

export async function runRunnerWithStatusWatch(
  runner: AIRunner,
  prompt: string,
  notes: string | undefined,
  provider: TaskProvider,
  taskId: string,
  config: Config,
  tagMode: ImplementationTagMode = 'code',
): Promise<AIRunResult & { stoppedByStatus?: boolean; stopReason?: string }> {
  if (!provider.fetchTaskById) {
    return runner.run(prompt, notes);
  }

  const controller = new AbortController();
  let stopReason = 'task is no longer eligible for implementation';

  const poll = setInterval(() => {
    void (async () => {
      try {
        const check = await checkImplementationStillActive(provider, taskId, config, tagMode);
        if (!check.active) {
          stopReason = check.reason;
          logger.info(`Stopping ${runner.name}: ${stopReason}`);
          controller.abort();
        }
      } catch (err) {
        logger.debug(`Status poll failed: ${err instanceof Error ? err.message : err}`);
      }
    })();
  }, STATUS_POLL_INTERVAL_MS);

  try {
    const result = await runner.run(prompt, notes, { signal: controller.signal });
    if (controller.signal.aborted || result.aborted) {
      return {
        success: false,
        output: result.output,
        error: result.error || stopReason,
        aborted: true,
        stoppedByStatus: true,
        stopReason,
      };
    }
    return result;
  } finally {
    clearInterval(poll);
  }
}

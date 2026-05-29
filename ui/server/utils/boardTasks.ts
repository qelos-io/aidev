import { statusesForFilter, type UiConfig, type UiProvider, type UiTask } from './provider';

/** Options passed to aidev providers for dashboard board listing. */
export const BOARD_FETCH_OPTIONS = {
  skipAttachments: true,
  omitDescription: true,
} as const;

/** Options for task detail in the modal (description yes, no file downloads). */
export const TASK_DETAIL_FETCH_OPTIONS = {
  skipAttachments: true,
  omitDescription: false,
} as const;

export function mergeTasksById(primary: UiTask[], extra: UiTask[]): UiTask[] {
  const byId = new Map<string, UiTask>();
  for (const t of primary) byId.set(t.id, t);
  for (const t of extra) byId.set(t.id, t);
  return [...byId.values()];
}

/**
 * Same task set as GET /api/tasks (filter=all), optimized for the Kanban board.
 */
export async function fetchBoardTasks(config: UiConfig, provider: UiProvider): Promise<UiTask[]> {
  const opts = BOARD_FETCH_OPTIONS;

  if (typeof provider.fetchBoardTasks === 'function') {
    return provider.fetchBoardTasks(opts);
  }

  let tasks = await provider.fetchTasks(opts);
  const inProgressStatuses = statusesForFilter(config, 'inprogress') ?? [];
  if (inProgressStatuses.length > 0) {
    try {
      const inProgress = await provider.fetchTasksByStatus(inProgressStatuses, opts);
      tasks = mergeTasksById(tasks, inProgress);
    } catch {
      // Non-fatal — open/pending board still loads.
    }
  }
  return tasks;
}

export async function findBoardTask(
  config: UiConfig,
  provider: UiProvider,
  taskId: string,
): Promise<UiTask | undefined> {
  const tasks = await fetchBoardTasks(config, provider);
  return tasks.find((t) => t.id === taskId);
}

export async function fetchTaskDetail(
  config: UiConfig,
  provider: UiProvider,
  taskId: string,
): Promise<UiTask | undefined> {
  if (typeof provider.fetchTaskById === 'function') {
    const task = await provider.fetchTaskById(taskId, TASK_DETAIL_FETCH_OPTIONS);
    if (task) return task;
  }
  return findBoardTask(config, provider, taskId);
}

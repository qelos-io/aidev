import { defineEventHandler, getQuery } from 'h3';
import { resolveActiveTaskId } from '../utils/activeTask';
import { fetchBoardTasks } from '../utils/boardTasks';
import { getProvider, statusesForFilter } from '../utils/provider';

export interface TasksResponse {
  filter: string;
  provider: string;
  tasks: UiTask[];
  // Provider-specific status names the filters map to (so the UI can highlight
  // which board statuses are considered open/pending/review/done).
  filters: {
    open: string[];
    pending: string[];
    inProgress: string[];
    review: string[];
    done: string[];
  };
  /** Task id being implemented by a live aidev run in this cwd, if known. */
  activeTaskId: string | null;
}

export default defineEventHandler(async (event): Promise<TasksResponse> => {
  const { config, provider, cwd, dist } = getProvider(event);
  const q = getQuery(event);
  const filter = (typeof q.status === 'string' ? q.status : 'all').toLowerCase();

  let tasks: UiTask[];
  if (filter === 'all' || filter === '') {
    tasks = await fetchBoardTasks(config, provider);
  } else {
    const mapped = statusesForFilter(config, filter);
    if (!mapped || mapped.length === 0) {
      // Filter is recognised but unconfigured (e.g. user picked "pending" but
      // never set PENDING_STATUS). Returning [] would hide all their tasks, so
      // fall back to a full fetch — the client can filter client-side.
      tasks = await fetchBoardTasks(config, provider);
    } else {
      tasks = await provider.fetchTasksByStatus(mapped, {
        skipAttachments: true,
        omitDescription: true,
      });
    }
  }

  return {
    filter,
    provider: config.provider,
    tasks,
    filters: {
      open: statusesForFilter(config, 'open') ?? [],
      pending: statusesForFilter(config, 'pending') ?? [],
      inProgress: statusesForFilter(config, 'inprogress') ?? [],
      review: statusesForFilter(config, 'review') ?? [],
      done: config.doneStatus ? [config.doneStatus] : [],
    },
    activeTaskId: resolveActiveTaskId(cwd, dist),
  };
});

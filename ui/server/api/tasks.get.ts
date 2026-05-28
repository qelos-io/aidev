import { defineEventHandler, getQuery } from 'h3';
import { getProvider, statusesForFilter, type UiTask } from '../utils/provider';

export interface TasksResponse {
  filter: string;
  provider: string;
  tasks: UiTask[];
  // Available statuses on the board, when the provider exposes them. Used by
  // the frontend to drive the status dropdown and Kanban columns.
  statuses: string[];
  // Provider-specific status names the filters map to (so the UI can highlight
  // which board statuses are considered open/pending/review/done).
  filters: {
    open: string[];
    pending: string[];
    review: string[];
    done: string[];
  };
}

export default defineEventHandler(async (event): Promise<TasksResponse> => {
  const { config, provider } = getProvider(event);
  const q = getQuery(event);
  const filter = (typeof q.status === 'string' ? q.status : 'all').toLowerCase();

  let tasks: UiTask[];
  if (filter === 'all' || filter === '') {
    tasks = await provider.fetchTasks();
  } else {
    const mapped = statusesForFilter(config, filter);
    if (mapped.length === 0) {
      // Filter is recognised but unconfigured (e.g. user picked "pending" but
      // never set PENDING_STATUS). Returning [] would hide all their tasks, so
      // fall back to a full fetch — the client can filter client-side.
      tasks = await provider.fetchTasks();
    } else {
      tasks = await provider.fetchTasksByStatus(mapped);
    }
  }

  let statuses: string[] = [];
  if (typeof provider.fetchAvailableStatuses === 'function') {
    try {
      statuses = await provider.fetchAvailableStatuses();
    } catch {
      // Non-fatal — board listing is a nice-to-have for the column count.
      statuses = [];
    }
  }

  return {
    filter,
    provider: config.provider,
    tasks,
    statuses,
    filters: {
      open: statusesForFilter(config, 'open'),
      pending: statusesForFilter(config, 'pending'),
      review: statusesForFilter(config, 'review'),
      done: config.doneStatus ? [config.doneStatus] : [],
    },
  };
});

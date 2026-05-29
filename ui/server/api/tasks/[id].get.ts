import { defineEventHandler, getRouterParam, createError } from 'h3';
import { getProvider, type UiTask, type UiComment } from '../../utils/provider';

export interface TaskDetailResponse {
  task: UiTask;
  comments: UiComment[];
}

export default defineEventHandler(async (event): Promise<TaskDetailResponse> => {
  const id = getRouterParam(event, 'id');
  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'Missing task id' });
  }

  const { provider } = getProvider(event);

  // TaskProvider exposes no single-task fetch — scan fetchTasks() for the id.
  // This is the same approach used by run.ts (filters the full list), and
  // it's bounded by the provider tag scope so it's not a full-project scan.
  const all = await provider.fetchTasks();
  const task = all.find((t) => t.id === id);
  if (!task) {
    throw createError({
      statusCode: 404,
      statusMessage: `Task ${id} not found within the configured provider tag scope`,
    });
  }

  const comments = await provider.getComments(id);
  return { task, comments };
});

import { defineEventHandler, getRouterParam, createError } from 'h3';
import { fetchTaskDetail } from '../../utils/boardTasks';
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

  const { config, provider } = getProvider(event);

  // TaskProvider exposes no single-task fetch — resolve from the same task set
  // as GET /api/tasks (includes in-progress tasks merged for the board).
  const task = await fetchTaskDetail(config, provider, id);
  if (!task) {
    throw createError({
      statusCode: 404,
      statusMessage: `Task ${id} not found within the configured provider tag scope`,
    });
  }

  const comments = await provider.getComments(id);
  return { task, comments };
});

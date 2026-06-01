import { defineEventHandler, readBody, createError } from 'h3';
import { getProvider } from '../utils/provider';

interface CreateTaskBody {
  title: string;
  description?: string;
  tags?: string[];
  priority?: number;
  dueDate?: number;
  listId?: string;
}

interface CreateTaskResponse {
  id: string;
  url: string;
}

export default defineEventHandler(async (event): Promise<CreateTaskResponse> => {
  const body = (await readBody<CreateTaskBody>(event)) ?? {};

  const title = typeof body.title === 'string' ? body.title.trim() : '';
  if (!title) {
    throw createError({ statusCode: 400, statusMessage: 'title is required' });
  }

  const description = typeof body.description === 'string' ? body.description : '';
  const tags = Array.isArray(body.tags)
    ? body.tags.filter((t): t is string => typeof t === 'string' && t.length > 0)
    : [];
  const priority = typeof body.priority === 'number' ? body.priority : undefined;
  const dueDate = typeof body.dueDate === 'number' ? body.dueDate : undefined;
  const listId = typeof body.listId === 'string' ? body.listId.trim() || undefined : undefined;

  const { provider, nonCodeProvider, config } = getProvider(event);

  // Use non-code provider when the task's tags include the non-code tag
  const nonCodeTag = (config.nonCodeTag as string | undefined) || '';
  const useNonCode =
    nonCodeTag.length > 0 &&
    nonCodeProvider !== undefined &&
    tags.some((t) => t.toLowerCase() === nonCodeTag.toLowerCase());
  const target = useNonCode ? nonCodeProvider! : provider;

  if (typeof (target as any).createTask !== 'function') {
    throw createError({
      statusCode: 501,
      statusMessage: `${config.provider} provider does not support task creation`,
    });
  }

  const result = await (target as any).createTask({ title, description, tags, priority, dueDate, listId });

  return { id: result.id, url: result.url };
});

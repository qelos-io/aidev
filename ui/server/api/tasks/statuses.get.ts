import { defineEventHandler } from 'h3';
import { getProvider } from '../../utils/provider';

export interface TaskStatusesResponse {
  statuses: string[];
}

/** Provider status names for the task modal dropdown (loaded on demand). */
export default defineEventHandler(async (event): Promise<TaskStatusesResponse> => {
  const { provider } = getProvider(event);

  if (typeof provider.fetchAvailableStatuses !== 'function') {
    return { statuses: [] };
  }

  try {
    const statuses = await provider.fetchAvailableStatuses();
    return { statuses };
  } catch {
    return { statuses: [] };
  }
});

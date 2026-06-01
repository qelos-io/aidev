import { defineEventHandler } from 'h3';
import { getProvider, statusesForFilter } from '../../utils/provider';

export interface TaskStatusesResponse {
  statuses: string[];
}

/** Provider status names for the task modal dropdown (loaded on demand). */
export default defineEventHandler(async (event): Promise<TaskStatusesResponse> => {
  const { provider, config } = getProvider(event);

  // Try the provider's native status list first
  if (typeof provider.fetchAvailableStatuses === 'function') {
    try {
      const statuses = await provider.fetchAvailableStatuses();
      if (statuses.length > 0) return { statuses };
    } catch { /* fall through */ }
  }

  // Fallback: derive from all configured status names in the config.
  // statusesForFilter returns the real provider status strings that the
  // user has configured (or sensible defaults for open/inprogress).
  const seen = new Set<string>();
  const statuses: string[] = [];
  const add = (s: unknown) => {
    if (typeof s === 'string' && s.trim() && !seen.has(s)) {
      seen.add(s);
      statuses.push(s);
    }
  };

  for (const filter of ['open', 'pending', 'inprogress', 'review', 'done'] as const) {
    for (const s of statusesForFilter(config, filter) ?? []) add(s);
  }

  return { statuses };
});

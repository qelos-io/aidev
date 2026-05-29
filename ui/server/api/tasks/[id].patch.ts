import { defineEventHandler, getRouterParam, readBody, createError } from 'h3';
import { getProvider } from '../../utils/provider';

interface PatchBody {
  status?: string;
  // Tag names to remove from the task. Provider must implement `removeTag`.
  removeTags?: string[];
}

export interface PatchResponse {
  ok: boolean;
  id: string;
  applied: {
    status?: string;
    removedTags?: string[];
  };
}

/**
 * Apply mutations the TaskProvider interface supports today:
 *   - status changes (every provider implements updateStatus)
 *   - tag removal (optional — guarded by typeof check)
 *
 * Title/description edits aren't exposed by TaskProvider (see
 * `src/providers/base.ts`), so we reject those with 400 rather than silently
 * dropping them. If a provider gains an `updateTask` method later, extend
 * this route instead of adding a parallel one.
 */
export default defineEventHandler(async (event): Promise<PatchResponse> => {
  const id = getRouterParam(event, 'id');
  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'Missing task id' });
  }

  const body = (await readBody<PatchBody>(event)) ?? {};
  const status = typeof body.status === 'string' ? body.status.trim() : '';
  const removeTags = Array.isArray(body.removeTags)
    ? body.removeTags.filter((t): t is string => typeof t === 'string' && t.length > 0)
    : [];

  if (!status && removeTags.length === 0) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Body must include `status` and/or `removeTags`. Title/description edits are not supported by the provider interface.',
    });
  }

  const { provider } = getProvider(event);

  if (status) {
    await provider.updateStatus(id, status);
  }

  const removed: string[] = [];
  if (removeTags.length > 0) {
    if (typeof provider.removeTag !== 'function') {
      throw createError({
        statusCode: 501,
        statusMessage: `${provider.constructor?.name || 'provider'} does not support tag removal`,
      });
    }
    for (const tag of removeTags) {
      await provider.removeTag(id, tag);
      removed.push(tag);
    }
  }

  return {
    ok: true,
    id,
    applied: {
      ...(status ? { status } : {}),
      ...(removed.length > 0 ? { removedTags: removed } : {}),
    },
  };
});

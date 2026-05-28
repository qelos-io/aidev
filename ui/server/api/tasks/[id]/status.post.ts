import { defineEventHandler, getRouterParam, readBody, createError } from 'h3';
import { getProvider } from '../../../utils/provider';

interface StatusBody {
  status?: string;
}

export interface StatusResponse {
  ok: boolean;
  id: string;
  status: string;
}

export default defineEventHandler(async (event): Promise<StatusResponse> => {
  const id = getRouterParam(event, 'id');
  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'Missing task id' });
  }

  const body = (await readBody<StatusBody>(event)) ?? {};
  const status = typeof body.status === 'string' ? body.status.trim() : '';
  if (!status) {
    throw createError({ statusCode: 400, statusMessage: 'Body must include non-empty `status`' });
  }

  const { provider } = getProvider(event);
  await provider.updateStatus(id, status);
  return { ok: true, id, status };
});

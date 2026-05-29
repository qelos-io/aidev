import { defineEventHandler, getRouterParam, readBody, createError } from 'h3';
import { getProvider } from '../../../utils/provider';

interface CommentBody {
  text?: string;
  // When true the comment is prefixed with the configured comment marker
  // (e.g. "[aidev]") so it shows up as a bot/aidev comment in run logic.
  // Default false — UI comments are human comments.
  asAidev?: boolean;
}

export interface CommentResponse {
  ok: boolean;
  id: string;
  text: string;
}

export default defineEventHandler(async (event): Promise<CommentResponse> => {
  const id = getRouterParam(event, 'id');
  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'Missing task id' });
  }

  const body = (await readBody<CommentBody>(event)) ?? {};
  const text = typeof body.text === 'string' ? body.text.trim() : '';
  if (!text) {
    throw createError({ statusCode: 400, statusMessage: 'Body must include non-empty `text`' });
  }

  const { config, provider } = getProvider(event);
  const finalText = body.asAidev && config.commentPrefix
    ? `${config.commentPrefix} ${text}`
    : text;

  await provider.postComment(id, finalText);
  return { ok: true, id, text: finalText };
});

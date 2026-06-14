import { defineEventHandler, readBody, createError } from 'h3';
import * as fs from 'node:fs';
import * as path from 'node:path';

interface PutBody {
  content?: unknown;
}

export default defineEventHandler(async (event) => {
  const hooksPath = process.env.AIDEV_HOOKS_PATH;
  if (!hooksPath) {
    throw createError({ statusCode: 400, statusMessage: 'AIDEV_HOOKS_PATH not configured' });
  }

  const body = await readBody<PutBody>(event);
  if (!body || typeof body.content !== 'string') {
    throw createError({ statusCode: 400, statusMessage: 'Body must be { content: string }' });
  }

  fs.mkdirSync(path.dirname(hooksPath), { recursive: true });
  fs.writeFileSync(hooksPath, body.content, 'utf8');
  return { ok: true };
});

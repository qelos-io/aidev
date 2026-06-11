import { defineEventHandler, createError } from 'h3';
import * as fs from 'node:fs';

export default defineEventHandler(() => {
  const hooksPath = process.env.AIDEV_HOOKS_PATH;
  if (!hooksPath) {
    throw createError({ statusCode: 400, statusMessage: 'AIDEV_HOOKS_PATH not configured' });
  }

  const content = fs.existsSync(hooksPath) ? fs.readFileSync(hooksPath, 'utf8') : '';
  return { content, path: hooksPath };
});

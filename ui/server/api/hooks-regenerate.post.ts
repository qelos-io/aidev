import { defineEventHandler, createError } from 'h3';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { generateFullHooksFile } from '../../../src/hooksTemplate';

export default defineEventHandler(() => {
  const hooksPath = process.env.AIDEV_HOOKS_PATH;
  if (!hooksPath) {
    throw createError({ statusCode: 400, statusMessage: 'AIDEV_HOOKS_PATH not configured' });
  }
  const content = generateFullHooksFile();
  fs.mkdirSync(path.dirname(hooksPath), { recursive: true });
  fs.writeFileSync(hooksPath, content, 'utf8');
  return { ok: true, content };
});

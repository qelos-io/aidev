import { defineEventHandler, createError } from 'h3';
import * as fs from 'node:fs';
import { updateHooksFile } from '../../../src/hooksTemplate';

export default defineEventHandler(() => {
  const hooksPath = process.env.AIDEV_HOOKS_PATH;
  if (!hooksPath) {
    throw createError({ statusCode: 400, statusMessage: 'AIDEV_HOOKS_PATH not configured' });
  }
  const existing = fs.existsSync(hooksPath) ? fs.readFileSync(hooksPath, 'utf8') : '';
  const { content, added } = updateHooksFile(existing);
  fs.writeFileSync(hooksPath, content, 'utf8');
  return { ok: true, content, added };
});

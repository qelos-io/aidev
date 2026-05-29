import { defineEventHandler, createError } from 'h3';
import { readEnvFile } from '../utils/envFile';

export default defineEventHandler(() => {
  const cwd = process.env.AIDEV_CWD;
  if (!cwd) {
    throw createError({ statusCode: 500, statusMessage: 'AIDEV_CWD not set' });
  }
  return readEnvFile(cwd);
});

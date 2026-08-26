import { defineEventHandler, createError } from 'h3';
import { readMcpFile } from '../utils/mcpFile';

export default defineEventHandler(() => {
  const cwd = process.env.AIDEV_CWD;
  if (!cwd) {
    throw createError({ statusCode: 500, statusMessage: 'AIDEV_CWD not set' });
  }
  return readMcpFile(cwd);
});

import { defineEventHandler, createError } from 'h3';
import * as fs from 'node:fs';
import { resolveLogPath } from '../utils/logFile';

export default defineEventHandler(() => {
  const cwd = process.env.AIDEV_CWD;
  if (!cwd) {
    throw createError({ statusCode: 500, statusMessage: 'AIDEV_CWD not set' });
  }

  const file = resolveLogPath(cwd);
  if (!fs.existsSync(file)) {
    return { path: file, exists: false, cleared: false };
  }

  // Truncate rather than unlink so any handle the CLI may have open keeps
  // working — `fs.appendFileSync` reopens per write, but rotating writers
  // (future log libraries) would break if we removed the inode.
  fs.truncateSync(file, 0);
  return { path: file, exists: true, cleared: true };
});

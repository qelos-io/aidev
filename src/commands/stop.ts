import { logger } from '../logger';
import { stopProcess } from '../lockfile';

export function stopCommand(): void {
  const cwd = process.cwd();
  const result = stopProcess(cwd);

  if (result === 'no-lock') {
    logger.info('No aidev process is running in this directory.');
    return;
  }

  if (result === 'not-running') {
    logger.info('Found a stale lock file — removed. No process was running.');
    return;
  }

  // 'killed'
  logger.success('aidev process stopped.');
}

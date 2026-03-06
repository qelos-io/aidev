import { spawnSync } from 'node:child_process';
import { AIRunner, AIRunResult } from './base';
import { logger } from '../logger';
import { commandExists } from '../platform';

export class CursorRunner implements AIRunner {
  readonly name = 'cursor';

  isAvailable(): boolean {
    return commandExists('cursor');
  }

  async run(prompt: string, notes?: string): Promise<AIRunResult> {
    const fullPrompt = notes ? `${prompt}\n\nAdditional context:\n${notes}` : prompt;

    logger.info('Running Cursor Agent...');
    logger.debug(`Prompt: ${fullPrompt.slice(0, 200)}...`);

    const result = spawnSync('cursor', ['--agent', fullPrompt], {
      encoding: 'utf8',
      timeout: 10 * 60 * 1000,
      cwd: process.cwd(),
    });

    const success = result.status === 0;
    const output = result.stdout || '';
    const error = result.stderr || '';

    if (!success) {
      logger.warn(`Cursor exited with status ${result.status}`);
    }

    return { success, output, error };
  }
}

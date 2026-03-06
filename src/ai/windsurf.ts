import { spawnSync } from 'node:child_process';
import { AIRunner, AIRunResult } from './base';
import { logger } from '../logger';
import { commandExists } from '../platform';

export class WindsurfRunner implements AIRunner {
  readonly name = 'windsurf';

  isAvailable(): boolean {
    return commandExists('windsurf');
  }

  async run(prompt: string, notes?: string): Promise<AIRunResult> {
    const fullPrompt = notes ? `${prompt}\n\nAdditional context:\n${notes}` : prompt;

    logger.info('Running Windsurf...');
    logger.debug(`Prompt: ${fullPrompt.slice(0, 200)}...`);

    const cwd = process.cwd();
    const result = spawnSync(
      'windsurf',
      ['--agent', '--print', '--trust', '--workspace', cwd, fullPrompt],
      {
        encoding: 'utf8',
        timeout: 10 * 60 * 1000,
        cwd,
      }
    );

    const success = result.status === 0;
    const output = result.stdout || '';
    const error = result.stderr || '';

    if (!success) {
      logger.warn(`Windsurf exited with status ${result.status}`);
      if (error) logger.debug(`stderr: ${error.slice(0, 300)}`);
    }

    return { success, output, error };
  }
}

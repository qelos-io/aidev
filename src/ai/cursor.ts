import { AIRunner, AIRunResult } from './base';
import { logger } from '../logger';
import { commandExists, getUserShellEnv, spawnCommand } from '../platform';

export class CursorRunner implements AIRunner {
  readonly name = 'cursor';

  isAvailable(): boolean {
    return commandExists('agent');
  }

  async run(prompt: string, notes?: string): Promise<AIRunResult> {
    const fullPrompt = notes ? `${prompt}\n\nAdditional context:\n${notes}` : prompt;

    logger.info('Running Cursor Agent...');
    logger.debug(`Prompt: ${fullPrompt.slice(0, 200)}...`);

    const cwd = process.cwd();
    const result = spawnCommand(
      'agent',
      ['--print', '--force', '--trust', '--workspace', cwd, fullPrompt],
      {
        encoding: 'utf8',
        timeout: 10 * 60 * 1000,
        cwd,
        env: getUserShellEnv(),
      }
    );

    const success = result.status === 0;
    const output = result.stdout || '';
    const error = result.stderr || '';

    if (!success) {
      logger.warn(`Cursor Agent exited with status ${result.status}`);
      if (error) logger.warn(`cursor stderr: ${error.slice(0, 500)}`);
      if (result.error) logger.warn(`cursor spawn error: ${result.error.message}`);
    }

    return { success, output, error };
  }
}

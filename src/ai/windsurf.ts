import { AIRunner, AIRunResult } from './base';
import { logger } from '../logger';
import { commandExists, getUserShellEnv, spawnCommand } from '../platform';

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
    const result = spawnCommand(
      'windsurf',
      ['--agent', '--print', '--trust', '--workspace', cwd, fullPrompt],
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
      logger.warn(`Windsurf exited with status ${result.status}`);
      if (error) logger.warn(`windsurf stderr: ${error.slice(0, 500)}`);
      if (result.error) logger.warn(`windsurf spawn error: ${result.error.message}`);
    }

    return { success, output, error };
  }
}

import { AIRunner, AIRunResult } from './base';
import { logger } from '../logger';
import { commandExists, getUserShellEnv, spawnCommand } from '../platform';

export class ClaudeRunner implements AIRunner {
  readonly name = 'claude';

  isAvailable(): boolean {
    return commandExists('claude');
  }

  async run(prompt: string, notes?: string): Promise<AIRunResult> {
    const fullPrompt = notes ? `${prompt}\n\nAdditional context:\n${notes}` : prompt;

    logger.info('Running Claude CLI...');
    logger.debug(`Prompt: ${fullPrompt.slice(0, 200)}...`);

    const baseArgs = ['-p', fullPrompt, '--dangerously-skip-permissions'];
    const attempts: string[][] = [
      [...baseArgs, '--model', 'auto'],
      [...baseArgs, '--reasoning', 'auto'],
      baseArgs,
    ];

    let result = spawnCommand('claude', attempts[0], {
      encoding: 'utf8',
      timeout: 10 * 60 * 1000,
      cwd: process.cwd(),
      env: getUserShellEnv(),
    });

    for (let i = 1; i < attempts.length; i++) {
      if (result.status === 0) break;
      const err = (result.stderr || '').toLowerCase();
      const unknownFlag =
        err.includes('unknown option') ||
        err.includes('unrecognized option') ||
        err.includes('unknown argument') ||
        err.includes('unexpected argument') ||
        err.includes('invalid option');
      if (!unknownFlag) break;
      result = spawnCommand('claude', attempts[i], {
        encoding: 'utf8',
        timeout: 10 * 60 * 1000,
        cwd: process.cwd(),
        env: getUserShellEnv(),
      });
    }

    const success = result.status === 0;
    const output = result.stdout || '';
    const error = result.stderr || '';

    if (!success) {
      logger.warn(`Claude exited with status ${result.status}`);
      if (error) logger.warn(`claude stderr: ${error.slice(0, 500)}`);
      if (result.error) logger.warn(`claude spawn error: ${result.error.message}`);
    }

    return { success, output, error };
  }
}

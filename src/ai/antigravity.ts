import { AIRunner, AIRunResult } from './base';
import { logger } from '../logger';
import { commandExists, getUserShellEnv, spawnCommand } from '../platform';

/**
 * Google Antigravity agent runner. Uses the `agy` CLI (or `antigravity` on some
 * installs). Opens the workspace and runs the agent with the prompt on stdin.
 * See https://antigravity.codes and antigravity.google/download.
 */
export class AntigravityRunner implements AIRunner {
  readonly name = 'antigravity';

  isAvailable(): boolean {
    return commandExists('agy') || commandExists('antigravity');
  }

  async run(prompt: string, notes?: string): Promise<AIRunResult> {
    const fullPrompt = notes ? `${prompt}\n\nAdditional context:\n${notes}` : prompt;

    logger.info('Running Antigravity agent...');
    logger.debug(`Prompt: ${fullPrompt.slice(0, 200)}...`);

    const cwd = process.cwd();
    const bin = commandExists('agy') ? 'agy' : 'antigravity';
    const baseArgs = ['.'];
    const attempts: string[][] = [
      ['--agent', '--print', ...baseArgs],
      ['--print', ...baseArgs],
      baseArgs,
    ];

    let result = spawnCommand(bin, attempts[0], {
      encoding: 'utf8',
      timeout: 10 * 60 * 1000,
      cwd,
      env: getUserShellEnv(),
      input: fullPrompt,
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
      result = spawnCommand(bin, attempts[i], {
        encoding: 'utf8',
        timeout: 10 * 60 * 1000,
        cwd,
        env: getUserShellEnv(),
        input: fullPrompt,
      });
    }

    const success = result.status === 0;
    const output = result.stdout || '';
    const error = result.stderr || '';

    if (!success) {
      logger.warn(`Antigravity exited with status ${result.status}`);
      if (error) logger.warn(`antigravity stderr: ${error.slice(0, 500)}`);
      if (result.error) logger.warn(`antigravity spawn error: ${result.error.message}`);
    }

    return { success, output, error };
  }
}

import { AIRunner, AIRunOptions, AIRunResult } from './base';
import { logger } from '../logger';
import { commandExists, getUserShellEnv } from '../platform';
import { runSpawnAttempts } from './spawnAttempts';

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

  async run(prompt: string, notes?: string, options?: AIRunOptions): Promise<AIRunResult> {
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

    const result = await runSpawnAttempts(bin, attempts, {
      encoding: 'utf8',
      timeout: 10 * 60 * 1000,
      cwd,
      env: getUserShellEnv(),
      input: fullPrompt,
      signal: options?.signal,
    });

    if (result.aborted) {
      return { success: false, output: result.stdout, error: result.stderr || 'aborted', aborted: true };
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

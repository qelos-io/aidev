import { AIRunner, AIRunResult } from './base';
import { logger } from '../logger';
import { commandExists, getUserShellEnv, shouldRetryAgentCliAttempt, spawnCommand } from '../platform';

const DEFAULT_MODEL = 'opusplan';

export class ClaudeRunner implements AIRunner {
  readonly name = 'claude';

  isAvailable(): boolean {
    return commandExists('claude');
  }

  async run(prompt: string, notes?: string): Promise<AIRunResult> {
    const fullPrompt = notes ? `${prompt}\n\nAdditional context:\n${notes}` : prompt;

    logger.info('Running Claude CLI...');
    logger.debug(`Prompt: ${fullPrompt.slice(0, 200)}...`);

    const model = (process.env.CLAUDE_MODEL || '').trim() || DEFAULT_MODEL;

    const baseArgs = ['-p', fullPrompt, '--dangerously-skip-permissions'];
    // Default to CLAUDE_MODEL (opusplan routes plan→opus and code→sonnet, saving tokens).
    // Fall back to the CLI's own default model, then `--model auto` — both fail on
    // some installs/plans, so they come last.
    const attempts: string[][] = [
      [...baseArgs, '--model', model],
      baseArgs,
      [...baseArgs, '--reasoning', 'auto'],
      [...baseArgs, '--model', 'auto'],
    ];

    let result = spawnCommand('claude', attempts[0], {
      encoding: 'utf8',
      timeout: 10 * 60 * 1000,
      cwd: process.cwd(),
      env: getUserShellEnv(),
    });

    for (let i = 1; i < attempts.length; i++) {
      if (result.status === 0) break;
      if (!shouldRetryAgentCliAttempt(result.stderr || '', result.stdout || '')) break;
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

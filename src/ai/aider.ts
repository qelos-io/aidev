import * as path from 'node:path';
import { ensureSessionsDir, getSessionsDir } from '../sessions';
import { AIRunner, AIRunOptions, AIRunResult } from './base';
import { logger } from '../logger';
import { commandExists, getUserShellEnv } from '../platform';
import { runSpawnAttempts } from './spawnAttempts';

export class AiderRunner implements AIRunner {
  readonly name = 'aider';
  readonly supportsSessions = true;

  isAvailable(): boolean {
    return commandExists('aider');
  }

  async run(prompt: string, notes?: string, options?: AIRunOptions): Promise<AIRunResult> {
    const fullPrompt = notes ? `${prompt}\n\nAdditional context:\n${notes}` : prompt;

    logger.info('Running aider...');
    logger.debug(`Prompt: ${fullPrompt.slice(0, 200)}...`);

    const extraArgs = (process.env.AIDER_ARGS || '').split(/\s+/).filter(Boolean);
    // aider has no session ids; a per-session chat-history file gives the same
    // effect: the follow-up restores the history written by the first run.
    const sessionArgs: string[] = [];
    if (options?.session) {
      ensureSessionsDir();
      sessionArgs.push(
        '--chat-history-file',
        path.join(getSessionsDir(), `aider-${options.session.id}.chat.md`),
      );
      if (options.session.resume) sessionArgs.push('--restore-chat-history');
    }
    const args = ['--message', fullPrompt, '--yes-always', ...sessionArgs, ...extraArgs];

    const result = await runSpawnAttempts('aider', [args], {
      encoding: 'utf8',
      timeout: 15 * 60 * 1000,
      cwd: process.cwd(),
      env: getUserShellEnv(),
      signal: options?.signal,
    }, () => false);

    if (result.aborted) {
      return { success: false, output: result.stdout, error: result.stderr || 'aborted', aborted: true };
    }

    const success = result.status === 0;
    const output = result.stdout || '';
    const error = result.stderr || '';

    if (!success) {
      logger.warn(`aider exited with status ${result.status}`);
      if (error) logger.warn(`aider stderr: ${error.slice(0, 500)}`);
      if (result.error) logger.warn(`aider spawn error: ${result.error.message}`);
    }

    return { success, output, error };
  }
}

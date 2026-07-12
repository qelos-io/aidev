import { AIRunner, AIRunOptions, AIRunResult } from './base';
import { logger } from '../logger';
import { commandExists, getUserShellEnv } from '../platform';
import { runSpawnAttempts } from './spawnAttempts';

/**
 * OpenCode CLI runner. Uses `opencode run` for non-interactive agent runs.
 * Install: npm install -g opencode-ai. Set OPENCODE_CONFIG_DIR for a custom config directory.
 */
export class OpencodeRunner implements AIRunner {
  readonly name = 'opencode';

  isAvailable(): boolean {
    return commandExists('opencode');
  }

  async run(prompt: string, notes?: string, options?: AIRunOptions): Promise<AIRunResult> {
    const fullPrompt = notes ? `${prompt}\n\nAdditional context:\n${notes}` : prompt;

    logger.info('Running OpenCode CLI (run)...');
    logger.debug(`Prompt: ${fullPrompt.slice(0, 200)}...`);

    const cwd = process.cwd();
    const args = ['run', '--dangerously-skip-permissions', '--dir', cwd];

    const model = (process.env.OPENCODE_MODEL || '').trim();
    if (model) args.push('--model', model);

    args.push(fullPrompt);

    const result = await runSpawnAttempts('opencode', [args], {
      encoding: 'utf8',
      timeout: 10 * 60 * 1000,
      cwd,
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
      logger.warn(`OpenCode exited with status ${result.status}`);
      if (error) logger.warn(`opencode stderr: ${error.slice(0, 500)}`);
      if (result.error) logger.warn(`opencode spawn error: ${result.error.message}`);
    }

    return { success, output, error };
  }
}

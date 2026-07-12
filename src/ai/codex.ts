import { AIRunner, AIRunOptions, AIRunResult } from './base';
import { logger } from '../logger';
import { commandExists, getUserShellEnv } from '../platform';
import { runSpawnAttempts } from './spawnAttempts';

/**
 * OpenAI Codex CLI runner. Uses `codex exec` for non-interactive agent runs.
 * Install: npm install -g @openai/codex. Set OPENAI_API_KEY or use codex login.
 */
export class CodexRunner implements AIRunner {
  readonly name = 'codex';

  isAvailable(): boolean {
    return commandExists('codex');
  }

  async run(prompt: string, notes?: string, options?: AIRunOptions): Promise<AIRunResult> {
    const fullPrompt = notes ? `${prompt}\n\nAdditional context:\n${notes}` : prompt;

    logger.info('Running Codex CLI (exec)...');
    logger.debug(`Prompt: ${fullPrompt.slice(0, 200)}...`);

    const cwd = process.cwd();
    const args = [
      'exec',
      '--ask-for-approval', 'never',
      '--sandbox', 'workspace-write',
      '--cd', cwd,
      fullPrompt,
    ];

    const result = await runSpawnAttempts('codex', [args], {
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
      logger.warn(`Codex exited with status ${result.status}`);
      if (error) logger.warn(`codex stderr: ${error.slice(0, 500)}`);
      if (result.error) logger.warn(`codex spawn error: ${result.error.message}`);
    }

    return { success, output, error };
  }
}

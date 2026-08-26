import { AIRunner, AIRunOptions, AIRunResult } from './base';
import { logger } from '../logger';
import { commandExists, getUserShellEnv } from '../platform';
import { runSpawnAttempts } from './spawnAttempts';
import { getMcpState } from '../mcp';

const DEFAULT_MODEL = 'opusplan';

export class ClaudeRunner implements AIRunner {
  readonly name = 'claude';

  isAvailable(): boolean {
    return commandExists('claude');
  }

  async run(prompt: string, notes?: string, options?: AIRunOptions): Promise<AIRunResult> {
    const fullPrompt = notes ? `${prompt}\n\nAdditional context:\n${notes}` : prompt;

    logger.info('Running Claude CLI...');
    logger.debug(`Prompt: ${fullPrompt.slice(0, 200)}...`);

    const model = (process.env.CLAUDE_MODEL || '').trim() || DEFAULT_MODEL;

    // --dangerously-skip-permissions already bypasses the permission system
    // entirely, so no --allowedTools is needed (and passing one could narrow
    // the effective tool set on some CLI versions instead of just widening it).
    const mcp = getMcpState();
    const mcpArgs = mcp ? ['--mcp-config', mcp.claudeConfigPath, '--strict-mcp-config'] : [];

    const baseArgs = ['-p', fullPrompt, '--dangerously-skip-permissions', ...mcpArgs];
    const attempts: string[][] = [
      [...baseArgs, '--model', model],
      baseArgs,
      [...baseArgs, '--reasoning', 'auto'],
      [...baseArgs, '--model', 'auto'],
    ];

    const result = await runSpawnAttempts('claude', attempts, {
      encoding: 'utf8',
      timeout: 10 * 60 * 1000,
      cwd: process.cwd(),
      env: getUserShellEnv(),
      signal: options?.signal,
    });

    if (result.aborted) {
      return { success: false, output: result.stdout, error: result.stderr || 'aborted', aborted: true };
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

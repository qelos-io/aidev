import { AIRunner, AIRunOptions, AIRunResult } from './base';
import { logger } from '../logger';
import { commandExists, getUserShellEnv, spawnCommand } from '../platform';
import { runSpawnAttempts } from './spawnAttempts';
import { getMcpState } from '../mcp';

const DEFAULT_MODEL = 'opusplan';

// Claude prints most user-facing errors (auth, rate limits, model errors) to
// stdout rather than stderr. These patterns identify failures that may be
// credential/auth related so we can run `claude auth status` for diagnostics.
const AUTH_ERROR_PATTERNS = [
  /oauth access token has expired/i,
  /failed to authenticate/i,
  /re-authenticate to continue/i,
  /\b401\b.*unauthorized/i,
  /unauthorized.*\b401\b/i,
  /api key.*(invalid|missing|expired)/i,
  /authentication.*failed/i,
  /not authenticated/i,
];

function looksLikeAuthError(...texts: string[]): boolean {
  return AUTH_ERROR_PATTERNS.some((re) => texts.some((t) => re.test(t)));
}

/**
 * Runs `claude auth status` and logs the result. Helps distinguish a real auth
 * failure (expired token, revoked credentials) from an API/transport error that
 * merely mentions authentication. Best-effort: never throws.
 */
function logClaudeAuthStatus(): void {
  logger.warn('Running `claude auth status` for diagnostics...');
  try {
    const result = spawnCommand('claude', ['auth', 'status'], {
      encoding: 'utf8',
      timeout: 15000,
      cwd: process.cwd(),
      env: getUserShellEnv(),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const out = (result.stdout || '').trim();
    const err = (result.stderr || '').trim();
    if (out) logger.warn(`claude auth status stdout: ${out.slice(0, 500)}`);
    if (err) logger.warn(`claude auth status stderr: ${err.slice(0, 500)}`);
    if (result.status !== 0) {
      logger.warn(`claude auth status exited with status ${result.status}`);
    }
    if (result.error) {
      logger.warn(`claude auth status spawn error: ${result.error.message}`);
    }
  } catch (e) {
    logger.warn(`claude auth status failed to run: ${e instanceof Error ? e.message : String(e)}`);
  }
}

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
      // Claude prints most failure reasons (auth, model errors, rate limits) to
      // stdout, not stderr. Log both so the aidev.log actually captures why the
      // run failed instead of just the exit status.
      if (output) logger.warn(`claude stdout: ${output.slice(0, 1000)}`);
      if (error) logger.warn(`claude stderr: ${error.slice(0, 500)}`);
      if (result.error) logger.warn(`claude spawn error: ${result.error.message}`);
      if (looksLikeAuthError(output, error)) {
        logClaudeAuthStatus();
      }
    }

    return { success, output, error };
  }
}

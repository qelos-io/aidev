import { AIRunner, AIRunResult } from './base';
import { logger } from '../logger';
import { parseAnthropicTokens, pickNextToken } from '../config';

const SDK_PACKAGE = '@anthropic-ai/claude-agent-sdk';
const RUN_TIMEOUT_MS = 10 * 60 * 1000;
const DEFAULT_MODEL = 'claude-opus-4-6';
const DEFAULT_MAX_RETRIES = 3;
const RETRY_BACKOFF_BASE_MS = 1000;
const RETRY_BACKOFF_MAX_MS = 10000;

/**
 * Reads `ANTHROPIC_SDK_MAX_RETRIES` from the environment, defaulting to 3.
 * Non-numeric or negative values fall back to the default. The count is the
 * number of retries *after* the initial attempt, so total attempts equal
 * `maxRetries + 1`.
 */
export function getAnthropicSdkMaxRetries(): number {
  const raw = (process.env.ANTHROPIC_SDK_MAX_RETRIES || '').trim();
  if (!raw) return DEFAULT_MAX_RETRIES;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 0) return DEFAULT_MAX_RETRIES;
  return parsed;
}

type RunAttemptResult = {
  success: boolean;
  output: string;
  error: string;
  timedOut: boolean;
};

/**
 * Runs Claude in-process via the official `@anthropic-ai/claude-agent-sdk`
 * package rather than shelling out to the `claude` CLI. The SDK is ESM-only,
 * so we load it lazily with a dynamic `import()` from this CJS module.
 *
 * Honors a comma-separated pool of `ANTHROPIC_API_KEY` values via round-robin
 * rotation across `run()` calls — and also across retries, so a flaky token
 * gets swapped out on the next attempt. Forwards `ANTHROPIC_BASE_URL` /
 * `CLAUDE_MODEL` when set. The `claude_code` system prompt preset combined
 * with `cwd: process.cwd()` is what makes the SDK pick up `.claude/skills`,
 * `.claude/commands`, and `.claude/agents` from the project — do not override.
 *
 * Transient SDK errors (connection drops, mid-stream failures) are retried up
 * to `ANTHROPIC_SDK_MAX_RETRIES` times (default 3) with capped exponential
 * backoff. Watchdog timeouts are surfaced immediately — they mean the run
 * already burned its budget, so a retry would only burn another.
 */
export class AnthropicSdkRunner implements AIRunner {
  readonly name = 'anthropic-sdk';

  private tokenCursor = 0;

  isAvailable(): boolean {
    try {
      require.resolve(SDK_PACKAGE);
    } catch {
      return false;
    }
    return parseAnthropicTokens(process.env.ANTHROPIC_API_KEY || '').length > 0;
  }

  // Dynamic import — SDK is ESM-only and this module is CJS. Exposed as a
  // method so tests can stub it without touching Node's ESM loader.
  async loadSdk(): Promise<unknown> {
    return import(SDK_PACKAGE);
  }

  // Exposed as a method so tests can stub it to 0 and avoid real waits.
  retryDelayMs(attempt: number): number {
    return Math.min(RETRY_BACKOFF_BASE_MS * 2 ** attempt, RETRY_BACKOFF_MAX_MS);
  }

  async run(prompt: string, notes?: string): Promise<AIRunResult> {
    const fullPrompt = notes ? `${prompt}\n\nAdditional context:\n${notes}` : prompt;

    const tokens = parseAnthropicTokens(process.env.ANTHROPIC_API_KEY || '');
    if (tokens.length === 0) {
      return { success: false, output: '', error: 'No ANTHROPIC_API_KEY configured' };
    }

    const maxRetries = getAnthropicSdkMaxRetries();
    const prevApiKey = process.env.ANTHROPIC_API_KEY;
    const prevBaseUrl = process.env.ANTHROPIC_BASE_URL;
    const baseUrl = (process.env.ANTHROPIC_BASE_URL || '').trim();
    const model = (process.env.CLAUDE_MODEL || '').trim() || DEFAULT_MODEL;

    let lastError = '';
    let lastOutput = '';

    try {
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        const { token, nextCursor } = pickNextToken(tokens, this.tokenCursor);
        this.tokenCursor = nextCursor;

        process.env.ANTHROPIC_API_KEY = token!;
        if (baseUrl) process.env.ANTHROPIC_BASE_URL = baseUrl;

        if (attempt === 0) {
          logger.info('Running Claude via Anthropic Agent SDK...');
        } else {
          logger.info(
            `Retrying Anthropic Agent SDK (attempt ${attempt + 1}/${maxRetries + 1})...`,
          );
        }
        logger.debug(`Prompt: ${fullPrompt.slice(0, 200)}...`);

        const attemptResult = await this.runOnce(fullPrompt, model);
        if (attemptResult.success) {
          return { success: true, output: attemptResult.output, error: '' };
        }

        lastError = attemptResult.error;
        lastOutput = attemptResult.output;

        if (attemptResult.timedOut) {
          return { success: false, output: lastOutput, error: lastError };
        }

        if (attempt < maxRetries) {
          const delay = this.retryDelayMs(attempt);
          logger.warn(
            `Anthropic SDK attempt ${attempt + 1} failed: ${lastError}. Retrying in ${delay}ms...`,
          );
          await new Promise<void>((resolve) => setTimeout(resolve, delay));
        }
      }

      return { success: false, output: lastOutput, error: lastError };
    } finally {
      if (prevApiKey === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = prevApiKey;
      if (prevBaseUrl === undefined) delete process.env.ANTHROPIC_BASE_URL;
      else process.env.ANTHROPIC_BASE_URL = prevBaseUrl;
    }
  }

  private async runOnce(fullPrompt: string, model: string): Promise<RunAttemptResult> {
    let output = '';
    let timedOut = false;
    const watchdog = setTimeout(() => {
      timedOut = true;
      logger.warn(`Anthropic SDK run exceeded ${RUN_TIMEOUT_MS / 1000}s — cancelling`);
    }, RUN_TIMEOUT_MS);

    try {
      const sdk: any = await this.loadSdk();
      const q = sdk.query({
        prompt: fullPrompt,
        options: {
          cwd: process.cwd(),
          allowedTools: ['Read', 'Write', 'Edit', 'Glob', 'Grep', 'Bash'],
          permissionMode: 'acceptEdits',
          systemPrompt: { type: 'preset', preset: 'claude_code' },
          maxTurns: 20,
          model,
        },
      });

      for await (const msg of q as AsyncIterable<any>) {
        if (timedOut) break;
        if (msg?.type === 'assistant' && msg.message?.content) {
          for (const block of msg.message.content) {
            if (block?.type === 'text' && typeof block.text === 'string') {
              output += block.text;
              logger.debug(block.text);
            }
          }
        } else if (msg?.type === 'result') {
          if (typeof msg.result === 'string' && msg.result.length > 0) {
            output += (output ? '\n' : '') + msg.result;
          }
        }
      }

      if (timedOut) {
        return { success: false, output, error: 'Anthropic SDK run timed out', timedOut: true };
      }
      return { success: true, output, error: '', timedOut: false };
    } catch (err: any) {
      const error = err?.message || String(err);
      logger.warn(`Anthropic SDK run failed: ${error}`);
      return { success: false, output, error, timedOut: false };
    } finally {
      clearTimeout(watchdog);
    }
  }
}

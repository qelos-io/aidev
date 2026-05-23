import { AIRunner, AIRunResult } from './base';
import { logger } from '../logger';
import { parseAnthropicTokens, pickNextToken } from '../config';

const SDK_PACKAGE = '@anthropic-ai/claude-agent-sdk';
const RUN_TIMEOUT_MS = 10 * 60 * 1000;
const DEFAULT_MODEL = 'claude-opus-4-6';

/**
 * Runs Claude in-process via the official `@anthropic-ai/claude-agent-sdk`
 * package rather than shelling out to the `claude` CLI. The SDK is ESM-only,
 * so we load it lazily with a dynamic `import()` from this CJS module.
 *
 * Honors a comma-separated pool of `ANTHROPIC_API_KEY` values via round-robin
 * rotation across `run()` calls, and forwards `ANTHROPIC_BASE_URL` /
 * `CLAUDE_MODEL` when set. The `claude_code` system prompt preset combined
 * with `cwd: process.cwd()` is what makes the SDK pick up `.claude/skills`,
 * `.claude/commands`, and `.claude/agents` from the project — do not override.
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

  async run(prompt: string, notes?: string): Promise<AIRunResult> {
    const fullPrompt = notes ? `${prompt}\n\nAdditional context:\n${notes}` : prompt;

    const tokens = parseAnthropicTokens(process.env.ANTHROPIC_API_KEY || '');
    if (tokens.length === 0) {
      return { success: false, output: '', error: 'No ANTHROPIC_API_KEY configured' };
    }

    const { token, nextCursor } = pickNextToken(tokens, this.tokenCursor);
    this.tokenCursor = nextCursor;

    logger.info('Running Claude via Anthropic Agent SDK...');
    logger.debug(`Prompt: ${fullPrompt.slice(0, 200)}...`);

    const prevApiKey = process.env.ANTHROPIC_API_KEY;
    const prevBaseUrl = process.env.ANTHROPIC_BASE_URL;
    const baseUrl = (process.env.ANTHROPIC_BASE_URL || '').trim();
    const model = (process.env.CLAUDE_MODEL || '').trim() || DEFAULT_MODEL;

    process.env.ANTHROPIC_API_KEY = token;
    if (baseUrl) process.env.ANTHROPIC_BASE_URL = baseUrl;

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
        return { success: false, output, error: 'Anthropic SDK run timed out' };
      }
      return { success: true, output, error: '' };
    } catch (err: any) {
      const error = err?.message || String(err);
      logger.warn(`Anthropic SDK run failed: ${error}`);
      return { success: false, output, error };
    } finally {
      clearTimeout(watchdog);
      if (prevApiKey === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = prevApiKey;
      if (prevBaseUrl === undefined) delete process.env.ANTHROPIC_BASE_URL;
      else process.env.ANTHROPIC_BASE_URL = prevBaseUrl;
    }
  }
}

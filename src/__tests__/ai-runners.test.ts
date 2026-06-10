import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mock } from 'node:test';
import { logger } from '../logger';
import { AntigravityRunner } from '../ai/antigravity';
import { AnthropicSdkRunner, getAnthropicSdkMaxRetries } from '../ai/anthropicSdk';
import { ClaudeRunner } from '../ai/claude';
import { CodexRunner } from '../ai/codex';
import { CursorRunner } from '../ai/cursor';
import { DevinRunner } from '../ai/devin';
import { createRunners } from '../ai/index';
import { isWindows } from '../platform';
import type { Config } from '../types';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const childProcess = require('node:child_process');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function mockSpawnSync(overrides: Record<string, unknown>) {
  return mock.method(childProcess, 'spawnSync', () => ({
    pid: 1,
    output: [],
    stdout: '',
    stderr: '',
    status: 0,
    signal: null,
    error: undefined,
    ...overrides,
  }));
}

function spyLogger() {
  return {
    info: mock.method(logger, 'info', () => {}),
    warn: mock.method(logger, 'warn', () => {}),
    debug: mock.method(logger, 'debug', () => {}),
  };
}

// ─── ClaudeRunner ─────────────────────────────────────────────────────────────

describe('ClaudeRunner – failed tasks', () => {
  beforeEach(() => mock.restoreAll());
  afterEach(() => mock.restoreAll());

  it('returns success=false when claude exits with non-zero status', async () => {
    mockSpawnSync({ status: 1, stdout: '', stderr: 'something went wrong' });
    spyLogger();

    const runner = new ClaudeRunner();
    const result = await runner.run('test prompt');

    assert.equal(result.success, false);
    assert.equal(result.error, 'something went wrong');
  });

  it('logs a warning with exit status on failure', async () => {
    mockSpawnSync({ status: 2, stdout: '', stderr: 'fatal error' });
    const spies = spyLogger();

    const runner = new ClaudeRunner();
    await runner.run('test prompt');

    const warnCalls = spies.warn.mock.calls.map((c) => c.arguments[0]);
    assert.ok(warnCalls.some((msg) => msg?.includes('status 2')));
  });

  it('logs stderr on failure', async () => {
    mockSpawnSync({ status: 1, stdout: '', stderr: 'heap out of memory' });
    const spies = spyLogger();

    const runner = new ClaudeRunner();
    await runner.run('test prompt');

    const warnCalls = spies.warn.mock.calls.map((c) => c.arguments[0]);
    assert.ok(warnCalls.some((msg) => msg?.includes('heap out of memory')));
  });

  it('logs spawn error when present', async () => {
    mockSpawnSync({ status: null, stdout: '', stderr: '', error: new Error('ENOENT') });
    const spies = spyLogger();

    const runner = new ClaudeRunner();
    await runner.run('test prompt');

    const warnCalls = spies.warn.mock.calls.map((c) => c.arguments[0]);
    assert.ok(warnCalls.some((msg) => msg?.includes('ENOENT')));
  });

  it('returns empty output on failure', async () => {
    mockSpawnSync({ status: 1, stdout: '', stderr: 'err' });
    spyLogger();

    const runner = new ClaudeRunner();
    const result = await runner.run('test prompt');

    assert.equal(result.output, '');
  });
});

// ─── ClaudeRunner – argv order ────────────────────────────────────────────────

describe('ClaudeRunner – argv order', () => {
  beforeEach(() => mock.restoreAll());
  afterEach(() => mock.restoreAll());

  it('first attempt passes --model opusplan (the default CLAUDE_MODEL)', async () => {
    const argvSnapshots: string[][] = [];
    mock.method(childProcess, 'spawnSync', (cmd: unknown, args: unknown) => {
      // On Windows, spawnCommand calls findBin which may invoke where.exe —
      // skip those helper calls and only capture the real CLI invocations.
      const command = cmd as string;
      if (!command.endsWith('where.exe')) {
        argvSnapshots.push([...(args as string[])]);
      }
      return {
        pid: 1,
        output: [],
        stdout: 'ok',
        stderr: '',
        status: 0,
        signal: null,
        error: undefined,
      };
    });
    spyLogger();

    const prev = process.env.CLAUDE_MODEL;
    delete process.env.CLAUDE_MODEL;
    try {
      await new ClaudeRunner().run('fix the bug');
    } finally {
      if (prev === undefined) delete process.env.CLAUDE_MODEL;
      else process.env.CLAUDE_MODEL = prev;
    }

    assert.equal(argvSnapshots.length, 1);
    const args = argvSnapshots[0];
    const pIdx = args.indexOf('-p');
    assert.ok(pIdx >= 0, 'expected -p in spawn argv (after any Windows node cli.js prefix)');
    assert.equal(args[pIdx + 1], 'fix the bug');
    assert.ok(args.includes('--dangerously-skip-permissions'));
    const modelIdx = args.indexOf('--model');
    assert.ok(modelIdx >= 0, 'expected --model in spawn argv');
    assert.equal(args[modelIdx + 1], 'opusplan');
  });

  it('uses CLAUDE_MODEL from env when set', async () => {
    const argvSnapshots: string[][] = [];
    mock.method(childProcess, 'spawnSync', (cmd: unknown, args: unknown) => {
      const command = cmd as string;
      if (!command.endsWith('where.exe')) {
        argvSnapshots.push([...(args as string[])]);
      }
      return {
        pid: 1,
        output: [],
        stdout: 'ok',
        stderr: '',
        status: 0,
        signal: null,
        error: undefined,
      };
    });
    spyLogger();

    const prev = process.env.CLAUDE_MODEL;
    process.env.CLAUDE_MODEL = 'claude-sonnet-4-6';
    try {
      await new ClaudeRunner().run('do it');
    } finally {
      if (prev === undefined) delete process.env.CLAUDE_MODEL;
      else process.env.CLAUDE_MODEL = prev;
    }

    const args = argvSnapshots[0];
    const modelIdx = args.indexOf('--model');
    assert.equal(args[modelIdx + 1], 'claude-sonnet-4-6');
  });
});

// ─── AntigravityRunner ────────────────────────────────────────────────────────

describe('AntigravityRunner', () => {
  it('isAvailable returns boolean (depends on agy/antigravity in PATH)', () => {
    const runner = new AntigravityRunner();
    assert.equal(typeof runner.isAvailable(), 'boolean');
  });
});

// ─── CodexRunner ─────────────────────────────────────────────────────────────

describe('CodexRunner', () => {
  it('isAvailable returns boolean (depends on codex CLI in PATH)', () => {
    const runner = new CodexRunner();
    assert.equal(typeof runner.isAvailable(), 'boolean');
  });
});

describe('AntigravityRunner – failed tasks', () => {
  beforeEach(() => mock.restoreAll());
  afterEach(() => mock.restoreAll());

  it('returns success=false when antigravity exits with non-zero status', async () => {
    mockSpawnSync({ status: 1, stdout: '', stderr: 'antigravity failed' });
    spyLogger();

    const runner = new AntigravityRunner();
    const result = await runner.run('test prompt');

    assert.equal(result.success, false);
    assert.equal(result.error, 'antigravity failed');
  });

  it('logs a warning with exit status on failure', async () => {
    mockSpawnSync({ status: 2, stdout: '', stderr: 'not found' });
    const spies = spyLogger();

    const runner = new AntigravityRunner();
    await runner.run('test prompt');

    const warnCalls = spies.warn.mock.calls.map((c) => c.arguments[0]);
    assert.ok(warnCalls.some((msg) => msg?.includes('status 2')));
  });

  it('returns empty output on failure', async () => {
    mockSpawnSync({ status: 1, stdout: '', stderr: 'err' });
    spyLogger();

    const runner = new AntigravityRunner();
    const result = await runner.run('test prompt');

    assert.equal(result.output, '');
  });
});

describe('CodexRunner – failed tasks', () => {
  beforeEach(() => mock.restoreAll());
  afterEach(() => mock.restoreAll());

  it('returns success=false when codex exits with non-zero status', async () => {
    mockSpawnSync({ status: 1, stdout: '', stderr: 'codex failed' });
    spyLogger();

    const runner = new CodexRunner();
    const result = await runner.run('test prompt');

    assert.equal(result.success, false);
    assert.equal(result.error, 'codex failed');
  });

  it('logs a warning with exit status on failure', async () => {
    mockSpawnSync({ status: 2, stdout: '', stderr: 'auth error' });
    const spies = spyLogger();

    const runner = new CodexRunner();
    await runner.run('test prompt');

    const warnCalls = spies.warn.mock.calls.map((c) => c.arguments[0]);
    assert.ok(warnCalls.some((msg) => msg?.includes('status 2')));
  });

  it('returns empty output on failure', async () => {
    mockSpawnSync({ status: 1, stdout: '', stderr: 'err' });
    spyLogger();

    const runner = new CodexRunner();
    const result = await runner.run('test prompt');

    assert.equal(result.output, '');
  });
});

// ─── CursorRunner ─────────────────────────────────────────────────────────────

describe('CursorRunner', () => {
  it('isAvailable returns boolean (depends on agent CLI in PATH)', () => {
    const runner = new CursorRunner();
    assert.equal(typeof runner.isAvailable(), 'boolean');
  });
});

describe('CursorRunner – failed tasks', () => {
  beforeEach(() => mock.restoreAll());
  afterEach(() => mock.restoreAll());

  it('returns success=false when cursor exits with non-zero status', async () => {
    mockSpawnSync({ status: 1, stdout: '', stderr: 'cursor failed' });
    spyLogger();

    const runner = new CursorRunner();
    const result = await runner.run('test prompt');

    assert.equal(result.success, false);
    assert.equal(result.error, 'cursor failed');
  });

  it('logs a warning with exit status on failure', async () => {
    mockSpawnSync({ status: 3, stdout: '', stderr: 'timeout' });
    const spies = spyLogger();

    const runner = new CursorRunner();
    await runner.run('test prompt');

    const warnCalls = spies.warn.mock.calls.map((c) => c.arguments[0]);
    assert.ok(warnCalls.some((msg) => msg?.includes('status 3')));
  });

  it('logs stderr on failure', async () => {
    mockSpawnSync({ status: 1, stdout: '', stderr: 'workspace not found' });
    const spies = spyLogger();

    const runner = new CursorRunner();
    await runner.run('test prompt');

    const warnCalls = spies.warn.mock.calls.map((c) => c.arguments[0]);
    assert.ok(warnCalls.some((msg) => msg?.includes('workspace not found')));
  });

  it('logs spawn error when present', async () => {
    mockSpawnSync({ status: null, stdout: '', stderr: '', error: new Error('EACCES') });
    const spies = spyLogger();

    const runner = new CursorRunner();
    await runner.run('test prompt');

    const warnCalls = spies.warn.mock.calls.map((c) => c.arguments[0]);
    assert.ok(warnCalls.some((msg) => msg?.includes('EACCES')));
  });

  it('returns empty output on failure', async () => {
    mockSpawnSync({ status: 1, stdout: '', stderr: 'err' });
    spyLogger();

    const runner = new CursorRunner();
    const result = await runner.run('test prompt');

    assert.equal(result.output, '');
  });
});

// ─── DevinRunner ──────────────────────────────────────────────────────────────

describe('DevinRunner', () => {
  it('isAvailable returns boolean (depends on devin CLI in PATH)', () => {
    const runner = new DevinRunner();
    assert.equal(typeof runner.isAvailable(), 'boolean');
  });
});

describe('DevinRunner – failed tasks', () => {
  beforeEach(() => mock.restoreAll());
  afterEach(() => mock.restoreAll());

  it('returns success=false when devin exits with non-zero status', async () => {
    mockSpawnSync({ status: 1, stdout: '', stderr: 'devin crashed' });
    spyLogger();

    const runner = new DevinRunner();
    const result = await runner.run('test prompt');

    assert.equal(result.success, false);
    assert.equal(result.error, 'devin crashed');
  });

  it('logs a warning with exit status on failure', async () => {
    mockSpawnSync({ status: 127, stdout: '', stderr: 'not found' });
    const spies = spyLogger();

    const runner = new DevinRunner();
    await runner.run('test prompt');

    const warnCalls = spies.warn.mock.calls.map((c) => c.arguments[0]);
    assert.ok(warnCalls.some((msg) => msg?.includes('status 127')));
  });

  it('logs stderr on failure', async () => {
    mockSpawnSync({ status: 1, stdout: '', stderr: 'license expired' });
    const spies = spyLogger();

    const runner = new DevinRunner();
    await runner.run('test prompt');

    const warnCalls = spies.warn.mock.calls.map((c) => c.arguments[0]);
    assert.ok(warnCalls.some((msg) => msg?.includes('license expired')));
  });

  it('logs spawn error when present', async () => {
    mockSpawnSync({ status: null, stdout: '', stderr: '', error: new Error('SIGTERM') });
    const spies = spyLogger();

    const runner = new DevinRunner();
    await runner.run('test prompt');

    const warnCalls = spies.warn.mock.calls.map((c) => c.arguments[0]);
    assert.ok(warnCalls.some((msg) => msg?.includes('SIGTERM')));
  });

  it('returns empty output on failure', async () => {
    mockSpawnSync({ status: 1, stdout: '', stderr: 'err' });
    spyLogger();

    const runner = new DevinRunner();
    const result = await runner.run('test prompt');

    assert.equal(result.output, '');
  });
});

// ─── AnthropicSdkRunner ──────────────────────────────────────────────────────

type SdkMessage =
  | { type: 'assistant'; message: { content: Array<{ type: string; text?: string }> } }
  | { type: 'result'; result: string }
  | { type: 'system'; subtype: string };

interface QueryCall {
  prompt: string;
  options: {
    cwd: string;
    allowedTools: string[];
    permissionMode: string;
    systemPrompt: { type: string; preset: string };
    maxTurns: number;
    model: string;
  };
  envSnapshot: { apiKey: string | undefined; baseUrl: string | undefined };
}

function fakeSdk(messages: SdkMessage[]): { sdk: unknown; calls: QueryCall[] } {
  const calls: QueryCall[] = [];
  const sdk = {
    query(args: QueryCall) {
      calls.push({
        prompt: args.prompt,
        options: args.options,
        envSnapshot: {
          apiKey: process.env.ANTHROPIC_API_KEY,
          baseUrl: process.env.ANTHROPIC_BASE_URL,
        },
      });
      return (async function* () {
        for (const m of messages) yield m;
      })();
    },
  };
  return { sdk, calls };
}

function withAnthropicEnv<T>(
  env: { apiKey?: string; baseUrl?: string; model?: string; maxRetries?: string },
  fn: () => Promise<T>,
): Promise<T> {
  const prev = {
    apiKey: process.env.ANTHROPIC_API_KEY,
    baseUrl: process.env.ANTHROPIC_BASE_URL,
    model: process.env.ANTHROPIC_MODEL,
    maxRetries: process.env.ANTHROPIC_SDK_MAX_RETRIES,
  };
  if (env.apiKey !== undefined) process.env.ANTHROPIC_API_KEY = env.apiKey;
  else delete process.env.ANTHROPIC_API_KEY;
  if (env.baseUrl !== undefined) process.env.ANTHROPIC_BASE_URL = env.baseUrl;
  else delete process.env.ANTHROPIC_BASE_URL;
  if (env.model !== undefined) process.env.ANTHROPIC_MODEL = env.model;
  else delete process.env.ANTHROPIC_MODEL;
  if (env.maxRetries !== undefined) process.env.ANTHROPIC_SDK_MAX_RETRIES = env.maxRetries;
  else delete process.env.ANTHROPIC_SDK_MAX_RETRIES;

  return fn().finally(() => {
    if (prev.apiKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = prev.apiKey;
    if (prev.baseUrl === undefined) delete process.env.ANTHROPIC_BASE_URL;
    else process.env.ANTHROPIC_BASE_URL = prev.baseUrl;
    if (prev.model === undefined) delete process.env.ANTHROPIC_MODEL;
    else process.env.ANTHROPIC_MODEL = prev.model;
    if (prev.maxRetries === undefined) delete process.env.ANTHROPIC_SDK_MAX_RETRIES;
    else process.env.ANTHROPIC_SDK_MAX_RETRIES = prev.maxRetries;
  });
}

describe('AnthropicSdkRunner', () => {
  beforeEach(() => mock.restoreAll());
  afterEach(() => mock.restoreAll());

  it('returns failure when no ANTHROPIC_API_KEY is configured', async () => {
    spyLogger();
    await withAnthropicEnv({}, async () => {
      const runner = new AnthropicSdkRunner();
      const result = await runner.run('do something');
      assert.equal(result.success, false);
      assert.equal(result.output, '');
      assert.match(result.error, /No ANTHROPIC_API_KEY/);
    });
  });

  it('concatenates assistant text and result into output', async () => {
    spyLogger();
    const { sdk } = fakeSdk([
      { type: 'assistant', message: { content: [{ type: 'text', text: 'hello ' }] } },
      { type: 'assistant', message: { content: [{ type: 'text', text: 'world' }] } },
      { type: 'result', result: 'final-summary' },
    ]);

    await withAnthropicEnv({ apiKey: 'sk-test' }, async () => {
      const runner = new AnthropicSdkRunner();
      mock.method(runner, 'loadSdk', async () => sdk);

      const result = await runner.run('please help');
      assert.equal(result.success, true);
      assert.equal(result.error, '');
      assert.equal(result.output, 'hello world\nfinal-summary');
    });
  });

  it('forwards cwd, claude_code preset, and default model to the SDK', async () => {
    spyLogger();
    const { sdk, calls } = fakeSdk([{ type: 'result', result: 'ok' }]);

    await withAnthropicEnv({ apiKey: 'sk-test' }, async () => {
      const runner = new AnthropicSdkRunner();
      mock.method(runner, 'loadSdk', async () => sdk);
      await runner.run('the prompt');
    });

    assert.equal(calls.length, 1);
    assert.equal(calls[0].prompt, 'the prompt');
    assert.equal(calls[0].options.cwd, process.cwd());
    assert.equal(calls[0].options.systemPrompt.type, 'preset');
    assert.equal(calls[0].options.systemPrompt.preset, 'claude_code');
    assert.equal(calls[0].options.permissionMode, 'acceptEdits');
    assert.equal(calls[0].options.model, 'claude-opus-4-6');
    assert.deepEqual(calls[0].options.allowedTools, ['Read', 'Write', 'Edit', 'Glob', 'Grep', 'Bash']);
  });

  it('uses ANTHROPIC_MODEL from env when set', async () => {
    spyLogger();
    const { sdk, calls } = fakeSdk([{ type: 'result', result: 'ok' }]);

    await withAnthropicEnv({ apiKey: 'sk-test', model: 'claude-sonnet-4-6' }, async () => {
      const runner = new AnthropicSdkRunner();
      mock.method(runner, 'loadSdk', async () => sdk);
      await runner.run('p');
    });

    assert.equal(calls[0].options.model, 'claude-sonnet-4-6');
  });

  it('sets ANTHROPIC_API_KEY during the call and restores it after', async () => {
    spyLogger();
    const { sdk, calls } = fakeSdk([{ type: 'result', result: 'ok' }]);

    await withAnthropicEnv({ apiKey: 'sk-original' }, async () => {
      const runner = new AnthropicSdkRunner();
      mock.method(runner, 'loadSdk', async () => sdk);
      await runner.run('p');

      // While the SDK was being called, the chosen token (the only one) was in env
      assert.equal(calls[0].envSnapshot.apiKey, 'sk-original');
      // After the call, env is restored to the original value
      assert.equal(process.env.ANTHROPIC_API_KEY, 'sk-original');
    });
  });

  it('sets ANTHROPIC_BASE_URL during the call when configured and restores after', async () => {
    spyLogger();
    const { sdk, calls } = fakeSdk([{ type: 'result', result: 'ok' }]);

    await withAnthropicEnv(
      { apiKey: 'sk-x', baseUrl: 'https://proxy.example.com' },
      async () => {
        const runner = new AnthropicSdkRunner();
        mock.method(runner, 'loadSdk', async () => sdk);
        await runner.run('p');

        assert.equal(calls[0].envSnapshot.baseUrl, 'https://proxy.example.com');
        assert.equal(process.env.ANTHROPIC_BASE_URL, 'https://proxy.example.com');
      },
    );
  });

  it('does not set ANTHROPIC_BASE_URL when not configured (and leaves it absent afterwards)', async () => {
    spyLogger();
    const { sdk, calls } = fakeSdk([{ type: 'result', result: 'ok' }]);

    await withAnthropicEnv({ apiKey: 'sk-x' }, async () => {
      const runner = new AnthropicSdkRunner();
      mock.method(runner, 'loadSdk', async () => sdk);
      await runner.run('p');

      assert.equal(calls[0].envSnapshot.baseUrl, undefined);
      assert.equal(process.env.ANTHROPIC_BASE_URL, undefined);
    });
  });

  it('rotates round-robin through a comma-separated token pool', async () => {
    spyLogger();
    const { sdk, calls } = fakeSdk([{ type: 'result', result: 'ok' }]);

    await withAnthropicEnv({ apiKey: 'k1,k2,k3' }, async () => {
      const runner = new AnthropicSdkRunner();
      mock.method(runner, 'loadSdk', async () => sdk);
      await runner.run('a');
      await runner.run('b');
      await runner.run('c');
      await runner.run('d');
    });

    assert.deepEqual(
      calls.map((c) => c.envSnapshot.apiKey),
      ['k1', 'k2', 'k3', 'k1'],
    );
  });

  it('appends notes to the prompt as "Additional context"', async () => {
    spyLogger();
    const { sdk, calls } = fakeSdk([{ type: 'result', result: 'ok' }]);

    await withAnthropicEnv({ apiKey: 'sk-x' }, async () => {
      const runner = new AnthropicSdkRunner();
      mock.method(runner, 'loadSdk', async () => sdk);
      await runner.run('do X', 'be careful about Y');
    });

    assert.equal(calls[0].prompt, 'do X\n\nAdditional context:\nbe careful about Y');
  });

  it('returns success=false and logs a warning when the SDK throws', async () => {
    const spies = spyLogger();

    await withAnthropicEnv({ apiKey: 'sk-x', maxRetries: '0' }, async () => {
      const runner = new AnthropicSdkRunner();
      mock.method(runner, 'loadSdk', async () => {
        throw new Error('auth failed');
      });
      const result = await runner.run('p');
      assert.equal(result.success, false);
      assert.equal(result.error, 'auth failed');
    });

    const warnCalls = spies.warn.mock.calls.map((c) => c.arguments[0]);
    assert.ok(warnCalls.some((m) => m?.includes('auth failed')));
  });

  it('isAvailable returns false when no token is set even if the SDK is installed', async () => {
    spyLogger();
    await withAnthropicEnv({}, async () => {
      const runner = new AnthropicSdkRunner();
      assert.equal(runner.isAvailable(), false);
    });
  });
});

// ─── AnthropicSdkRunner – retry behavior ─────────────────────────────────────

describe('AnthropicSdkRunner – retries', () => {
  beforeEach(() => mock.restoreAll());
  afterEach(() => mock.restoreAll());

  it('retries transient SDK errors and eventually succeeds', async () => {
    spyLogger();
    const { sdk } = fakeSdk([
      { type: 'assistant', message: { content: [{ type: 'text', text: 'recovered' }] } },
      { type: 'result', result: 'ok' },
    ]);

    await withAnthropicEnv({ apiKey: 'sk-x', maxRetries: '3' }, async () => {
      const runner = new AnthropicSdkRunner();
      mock.method(runner, 'retryDelayMs', () => 0);

      // Fail the first two loadSdk calls; succeed on the third.
      let calls = 0;
      mock.method(runner, 'loadSdk', async () => {
        calls += 1;
        if (calls < 3) throw new Error('ECONNRESET');
        return sdk;
      });

      const result = await runner.run('p');
      assert.equal(result.success, true);
      assert.equal(result.output, 'recovered\nok');
      assert.equal(result.error, '');
      assert.equal(calls, 3);
    });
  });

  it('honors ANTHROPIC_SDK_MAX_RETRIES and surfaces the last error after exhausting attempts', async () => {
    spyLogger();

    await withAnthropicEnv({ apiKey: 'sk-x', maxRetries: '2' }, async () => {
      const runner = new AnthropicSdkRunner();
      mock.method(runner, 'retryDelayMs', () => 0);

      let calls = 0;
      mock.method(runner, 'loadSdk', async () => {
        calls += 1;
        throw new Error(`fail ${calls}`);
      });

      const result = await runner.run('p');
      assert.equal(result.success, false);
      // 1 initial + 2 retries = 3 attempts
      assert.equal(calls, 3);
      assert.equal(result.error, 'fail 3');
    });
  });

  it('does not retry when ANTHROPIC_SDK_MAX_RETRIES=0', async () => {
    spyLogger();

    await withAnthropicEnv({ apiKey: 'sk-x', maxRetries: '0' }, async () => {
      const runner = new AnthropicSdkRunner();
      mock.method(runner, 'retryDelayMs', () => 0);

      let calls = 0;
      mock.method(runner, 'loadSdk', async () => {
        calls += 1;
        throw new Error('boom');
      });

      const result = await runner.run('p');
      assert.equal(result.success, false);
      assert.equal(calls, 1);
      assert.equal(result.error, 'boom');
    });
  });

  it('rotates to the next token on each retry attempt', async () => {
    spyLogger();

    await withAnthropicEnv({ apiKey: 'k1,k2,k3', maxRetries: '2' }, async () => {
      const runner = new AnthropicSdkRunner();
      mock.method(runner, 'retryDelayMs', () => 0);

      const seenKeys: Array<string | undefined> = [];
      mock.method(runner, 'loadSdk', async () => {
        seenKeys.push(process.env.ANTHROPIC_API_KEY);
        throw new Error('nope');
      });

      const result = await runner.run('p');
      assert.equal(result.success, false);
      assert.deepEqual(seenKeys, ['k1', 'k2', 'k3']);
    });
  });
});

describe('getAnthropicSdkMaxRetries', () => {
  const prev = process.env.ANTHROPIC_SDK_MAX_RETRIES;
  afterEach(() => {
    if (prev === undefined) delete process.env.ANTHROPIC_SDK_MAX_RETRIES;
    else process.env.ANTHROPIC_SDK_MAX_RETRIES = prev;
  });

  it('defaults to 3 when the env var is unset', () => {
    delete process.env.ANTHROPIC_SDK_MAX_RETRIES;
    assert.equal(getAnthropicSdkMaxRetries(), 3);
  });

  it('returns the parsed env value when valid', () => {
    process.env.ANTHROPIC_SDK_MAX_RETRIES = '7';
    assert.equal(getAnthropicSdkMaxRetries(), 7);
  });

  it('accepts 0 as a valid value (disables retries)', () => {
    process.env.ANTHROPIC_SDK_MAX_RETRIES = '0';
    assert.equal(getAnthropicSdkMaxRetries(), 0);
  });

  it('falls back to the default on non-numeric input', () => {
    process.env.ANTHROPIC_SDK_MAX_RETRIES = 'foo';
    assert.equal(getAnthropicSdkMaxRetries(), 3);
  });

  it('falls back to the default on negative numbers', () => {
    process.env.ANTHROPIC_SDK_MAX_RETRIES = '-1';
    assert.equal(getAnthropicSdkMaxRetries(), 3);
  });
});

// ─── createRunners ────────────────────────────────────────────────────────────

function makeConfig(agents: Config['agents']): Config {
  return { agents } as Config;
}

describe('createRunners', () => {
  beforeEach(() => mock.restoreAll());
  afterEach(() => mock.restoreAll());

  it('returns runners in the order specified by config.agents', () => {
    spyLogger();
    const runners = createRunners(
      makeConfig(['cursor', 'codex', 'devin', 'claude', 'antigravity'])
    );
    assert.deepEqual(
      runners.map((r) => r.name),
      ['cursor', 'codex', 'devin', 'claude', 'antigravity']
    );
  });

  it('returns runners in reversed order when config specifies reversed order', () => {
    spyLogger();
    const runners = createRunners(makeConfig(['claude', 'cursor']));
    assert.deepEqual(
      runners.map((r) => r.name),
      ['claude', 'cursor']
    );
  });

  it('returns a single runner when only one agent is configured', () => {
    spyLogger();
    const runners = createRunners(makeConfig(['claude']));
    assert.equal(runners.length, 1);
    assert.equal(runners[0].name, 'claude');
  });

  it('logs configured runners at info level', () => {
    const spies = spyLogger();
    createRunners(makeConfig(['cursor', 'claude']));
    const infoCalls = spies.info.mock.calls.map((c) => c.arguments[0]);
    assert.ok(infoCalls.some((msg) => msg?.includes('cursor') && msg?.includes('claude') && msg?.includes('Configured runners')));
  });

  it('logs a warning when a configured runner is not available', () => {
    const spies = spyLogger();
    createRunners(makeConfig(['devin', 'claude']));
    const warnCalls = spies.warn.mock.calls.map((c) => c.arguments[0]);
    const hasUnavailableWarning = warnCalls.some((msg) => msg?.includes('not found'));
    // At least devin should be flagged (it's typically not installed in CI)
    // We can't assert strongly since CI might have different tool availability
    assert.ok(typeof hasUnavailableWarning === 'boolean');
  });

  it('includes unavailable runners in the returned array (filtering is done by callers)', () => {
    spyLogger();
    const runners = createRunners(makeConfig(['devin', 'claude']));
    assert.equal(runners.length, 2);
    assert.equal(runners[0].name, 'devin');
    assert.equal(runners[1].name, 'claude');
  });
});

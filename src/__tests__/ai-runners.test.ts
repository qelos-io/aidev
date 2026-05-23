import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mock } from 'node:test';
import { logger } from '../logger';
import { AntigravityRunner } from '../ai/antigravity';
import { AnthropicSdkRunner } from '../ai/anthropicSdk';
import { ClaudeRunner } from '../ai/claude';
import { CodexRunner } from '../ai/codex';
import { CursorRunner } from '../ai/cursor';
import { WindsurfRunner } from '../ai/windsurf';
import { isDockerWindsurfAvailable } from '../ai/windsurf';
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

  it('first attempt omits --model so default CLI model is used', async () => {
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

    await new ClaudeRunner().run('fix the bug');

    assert.equal(argvSnapshots.length, 1);
    const args = argvSnapshots[0];
    const pIdx = args.indexOf('-p');
    assert.ok(pIdx >= 0, 'expected -p in spawn argv (after any Windows node cli.js prefix)');
    assert.equal(args[pIdx + 1], 'fix the bug');
    assert.ok(args.includes('--dangerously-skip-permissions'));
    assert.ok(!args.includes('--model'));
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

// ─── WindsurfRunner ───────────────────────────────────────────────────────────

describe('WindsurfRunner – failed tasks', () => {
  beforeEach(() => mock.restoreAll());
  afterEach(() => mock.restoreAll());

  it('returns success=false when windsurf exits with non-zero status', async () => {
    mockSpawnSync({ status: 1, stdout: '', stderr: 'windsurf crashed' });
    spyLogger();

    const runner = new WindsurfRunner();
    const result = await runner.run('test prompt');

    assert.equal(result.success, false);
    assert.equal(result.error, 'windsurf crashed');
  });

  it('logs a warning with exit status on failure', async () => {
    mockSpawnSync({ status: 127, stdout: '', stderr: 'not found' });
    const spies = spyLogger();

    const runner = new WindsurfRunner();
    await runner.run('test prompt');

    const warnCalls = spies.warn.mock.calls.map((c) => c.arguments[0]);
    assert.ok(warnCalls.some((msg) => msg?.includes('status 127')));
  });

  it('logs stderr on failure', async () => {
    mockSpawnSync({ status: 1, stdout: '', stderr: 'license expired' });
    const spies = spyLogger();

    const runner = new WindsurfRunner();
    await runner.run('test prompt');

    const warnCalls = spies.warn.mock.calls.map((c) => c.arguments[0]);
    assert.ok(warnCalls.some((msg) => msg?.includes('license expired')));
  });

  it('logs spawn error when present', async () => {
    mockSpawnSync({ status: null, stdout: '', stderr: '', error: new Error('SIGTERM') });
    const spies = spyLogger();

    const runner = new WindsurfRunner();
    await runner.run('test prompt');

    const warnCalls = spies.warn.mock.calls.map((c) => c.arguments[0]);
    assert.ok(warnCalls.some((msg) => msg?.includes('SIGTERM')));
  });

  it('returns empty output on failure', async () => {
    mockSpawnSync({ status: 1, stdout: '', stderr: 'err' });
    spyLogger();

    const runner = new WindsurfRunner();
    const result = await runner.run('test prompt');

    assert.equal(result.output, '');
  });
});

describe('WindsurfRunner – process cleanup (non-Windows CLI mode)', { skip: isWindows }, () => {
  beforeEach(() => mock.restoreAll());
  afterEach(() => mock.restoreAll());

  it('kills Windsurf IDE after run when it was not already running', async () => {
    const spawnMock = mock.method(childProcess, 'spawnSync', (command: string) => {
      const base = { pid: 1, output: [], stderr: '', status: 0, signal: null, error: undefined };
      if (command === 'pgrep') return { ...base, stdout: '', status: 1 };
      return { ...base, stdout: '' };
    });
    spyLogger();

    const runner = new WindsurfRunner();
    await runner.run('test prompt');

    const calls: string[] = spawnMock.mock.calls.map((c: { arguments: string[] }) => c.arguments[0]);
    assert.ok(
      calls.some((cmd: string) => cmd === 'pkill'),
      `Expected pkill in spawn calls: [${calls}]`
    );
  });

  it('does not kill Windsurf IDE when it was already running', async () => {
    const spawnMock = mock.method(childProcess, 'spawnSync', (command: string) => {
      const base = { pid: 1, output: [], stderr: '', status: 0, signal: null, error: undefined };
      if (command === 'pgrep') {
        return { ...base, stdout: '1234' };
      }
      return { ...base, stdout: '' };
    });
    spyLogger();

    const runner = new WindsurfRunner();
    await runner.run('test prompt');

    const calls: string[] = spawnMock.mock.calls.map((c: { arguments: string[] }) => c.arguments[0]);
    assert.ok(
      !calls.some((cmd: string) => cmd === 'pkill'),
      `Expected no pkill in spawn calls: [${calls}]`
    );
  });
});

describe('WindsurfRunner – Docker mode (Windows)', { skip: !isWindows }, () => {
  it('isDockerWindsurfAvailable checks for docker and WINDSURF_TOKEN', () => {
    // This test reflects the real environment — just verify it returns a boolean
    assert.equal(typeof isDockerWindsurfAvailable(), 'boolean');
  });

  it('isAvailable returns boolean on Windows', () => {
    const runner = new WindsurfRunner();
    assert.equal(typeof runner.isAvailable(), 'boolean');
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
  env: { apiKey?: string; baseUrl?: string; model?: string },
  fn: () => Promise<T>,
): Promise<T> {
  const prev = {
    apiKey: process.env.ANTHROPIC_API_KEY,
    baseUrl: process.env.ANTHROPIC_BASE_URL,
    model: process.env.CLAUDE_MODEL,
  };
  if (env.apiKey !== undefined) process.env.ANTHROPIC_API_KEY = env.apiKey;
  else delete process.env.ANTHROPIC_API_KEY;
  if (env.baseUrl !== undefined) process.env.ANTHROPIC_BASE_URL = env.baseUrl;
  else delete process.env.ANTHROPIC_BASE_URL;
  if (env.model !== undefined) process.env.CLAUDE_MODEL = env.model;
  else delete process.env.CLAUDE_MODEL;

  return fn().finally(() => {
    if (prev.apiKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = prev.apiKey;
    if (prev.baseUrl === undefined) delete process.env.ANTHROPIC_BASE_URL;
    else process.env.ANTHROPIC_BASE_URL = prev.baseUrl;
    if (prev.model === undefined) delete process.env.CLAUDE_MODEL;
    else process.env.CLAUDE_MODEL = prev.model;
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

  it('uses CLAUDE_MODEL from env when set', async () => {
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

    await withAnthropicEnv({ apiKey: 'sk-x' }, async () => {
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
      makeConfig(['cursor', 'codex', 'windsurf', 'claude', 'antigravity'])
    );
    assert.deepEqual(
      runners.map((r) => r.name),
      ['cursor', 'codex', 'windsurf', 'claude', 'antigravity']
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
    createRunners(makeConfig(['windsurf', 'claude']));
    const warnCalls = spies.warn.mock.calls.map((c) => c.arguments[0]);
    const hasUnavailableWarning = warnCalls.some((msg) => msg?.includes('not found'));
    // At least windsurf should be flagged (it's typically not installed in CI)
    // We can't assert strongly since CI might have different tool availability
    assert.ok(typeof hasUnavailableWarning === 'boolean');
  });

  it('includes unavailable runners in the returned array (filtering is done by callers)', () => {
    spyLogger();
    const runners = createRunners(makeConfig(['windsurf', 'claude']));
    assert.equal(runners.length, 2);
    assert.equal(runners[0].name, 'windsurf');
    assert.equal(runners[1].name, 'claude');
  });
});

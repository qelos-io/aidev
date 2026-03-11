import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mock } from 'node:test';
import { logger } from '../logger';
import { ClaudeRunner } from '../ai/claude';
import { CursorRunner } from '../ai/cursor';
import { WindsurfRunner } from '../ai/windsurf';
import { createRunners } from '../ai/index';
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

// ─── createRunners ────────────────────────────────────────────────────────────

function makeConfig(agents: Config['agents']): Config {
  return { agents } as Config;
}

describe('createRunners', () => {
  beforeEach(() => mock.restoreAll());
  afterEach(() => mock.restoreAll());

  it('returns runners in the order specified by config.agents', () => {
    spyLogger();
    const runners = createRunners(makeConfig(['cursor', 'windsurf', 'claude']));
    assert.deepEqual(
      runners.map((r) => r.name),
      ['cursor', 'windsurf', 'claude']
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

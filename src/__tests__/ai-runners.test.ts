import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mock } from 'node:test';
import { logger } from '../logger';
import { ClaudeRunner } from '../ai/claude';
import { CursorRunner } from '../ai/cursor';
import { WindsurfRunner } from '../ai/windsurf';

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

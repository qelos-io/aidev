import { describe, it, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import {
  ensureBetterMcp,
  getInstalledBetterMcpVersion,
  getLatestBetterMcpVersion,
  isNewerVersion,
  resetBetterMcpCache,
  setBetterMcpDeps,
} from '../betterMcpCli';
import { logger } from '../logger';

type Res = { status: number; stdout?: string; stderr?: string };

interface Env {
  bins: Set<string>;
  latest?: string | null;
  installed?: string | null;
  installOk?: boolean;
}

function setup(env: Env) {
  const calls: string[][] = [];
  const bins = env.bins;
  setBetterMcpDeps({
    commandExists: (n: string) => bins.has(n),
    spawnCommand: ((_cmd: string, args: string[]): Res => {
    calls.push(args);
    if (args[0] === 'view') {
      return env.latest ? { status: 0, stdout: `${env.latest}\n` } : { status: 1, stdout: '' };
    }
    if (args[0] === 'ls') {
      return env.installed
        ? { status: 0, stdout: JSON.stringify({ dependencies: { '@qelos/better-mcp': { version: env.installed } } }) }
        : { status: 1, stdout: '{}' };
    }
    if (args[0] === 'install') {
      if (env.installOk) bins.add('better-mcp');
      return { status: env.installOk ? 0 : 1, stdout: '', stderr: 'EACCES' };
    }
    return { status: 1 };
    }) as never,
  });
  return calls;
}

const installs = (calls: string[][]) => calls.filter((a) => a[0] === 'install');
const BIN = { command: 'better-mcp', args: [] };

describe('betterMcpCli', () => {
  beforeEach(() => {
    resetBetterMcpCache();
    mock.method(logger, 'warn', () => {});
    mock.method(logger, 'info', () => {});
  });
  afterEach(() => {
    mock.restoreAll();
    setBetterMcpDeps(null);
  });

  it('isNewerVersion compares numerically', () => {
    assert.equal(isNewerVersion('1.10.0', '1.9.0'), true);
    assert.equal(isNewerVersion('1.0.0', '1.0.0'), false);
    assert.equal(isNewerVersion('1.0.0', '1.0.1'), false);
  });

  it('getLatestBetterMcpVersion parses npm view output and handles failure', () => {
    setup({ bins: new Set(['npm']), latest: '2.3.4' });
    assert.equal(getLatestBetterMcpVersion(), '2.3.4');
    setup({ bins: new Set(['npm']), latest: null });
    assert.equal(getLatestBetterMcpVersion(), null);
  });

  it('getInstalledBetterMcpVersion parses npm ls and returns null when absent', () => {
    setup({ bins: new Set(['npm']), installed: '1.2.3' });
    assert.equal(getInstalledBetterMcpVersion(), '1.2.3');
    mock.restoreAll();
    setup({ bins: new Set(['npm']), installed: null });
    assert.equal(getInstalledBetterMcpVersion(), null);
  });

  it('returns null without npm', () => {
    setup({ bins: new Set() });
    assert.equal(ensureBetterMcp(), null);
  });

  it('installs when the binary is missing', () => {
    const calls = setup({ bins: new Set(['npm']), installOk: true, latest: '1.0.0' });
    assert.deepEqual(ensureBetterMcp(), BIN);
    assert.equal(installs(calls).length, 1);
  });

  it('reinstalls when installed version is outdated', () => {
    const calls = setup({ bins: new Set(['npm', 'better-mcp']), installOk: true, installed: '1.0.0', latest: '1.1.0' });
    assert.deepEqual(ensureBetterMcp(), BIN);
    assert.equal(installs(calls).length, 1);
  });

  it('skips install when up to date or newer', () => {
    const calls = setup({ bins: new Set(['npm', 'better-mcp']), installed: '2.0.0', latest: '1.9.0' });
    assert.deepEqual(ensureBetterMcp(), BIN);
    assert.equal(installs(calls).length, 0);
  });

  it('does not reinstall when installed version is unknown', () => {
    const calls = setup({ bins: new Set(['npm', 'better-mcp']), installed: null, latest: '1.9.0' });
    assert.deepEqual(ensureBetterMcp(), BIN);
    assert.equal(installs(calls).length, 0);
  });

  it('does not reinstall when offline', () => {
    const calls = setup({ bins: new Set(['npm', 'better-mcp']), installed: '1.0.0', latest: null });
    assert.deepEqual(ensureBetterMcp(), BIN);
    assert.equal(installs(calls).length, 0);
  });

  it('keeps the existing binary when an upgrade fails', () => {
    setup({ bins: new Set(['npm', 'better-mcp']), installed: '1.0.0', latest: '1.1.0', installOk: false });
    assert.deepEqual(ensureBetterMcp(), BIN);
  });

  it('falls back to npx when install fails and no binary exists', () => {
    setup({ bins: new Set(['npm', 'npx']), installOk: false, latest: '1.0.0' });
    assert.deepEqual(ensureBetterMcp(), { command: 'npx', args: ['-y', '@qelos/better-mcp@latest'] });
  });

  it('returns null when install fails and npx is unavailable', () => {
    setup({ bins: new Set(['npm']), installOk: false });
    assert.equal(ensureBetterMcp(), null);
  });

  it('caches the result for the process', () => {
    const calls = setup({ bins: new Set(['npm', 'better-mcp']), installed: '1.0.0', latest: '1.0.0' });
    ensureBetterMcp();
    const n = calls.length;
    ensureBetterMcp();
    assert.equal(calls.length, n);
  });
});

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { commandExists, findBin, spawnCommand, resolveWindowsCmd } from '../platform';

const FAKE = '__aidev_definitely_not_a_real_binary_xyz__';

describe('commandExists', () => {
  it('returns true for node (always in PATH when tests run)', () => {
    assert.equal(commandExists('node'), true);
  });

  it('returns false for a non-existent binary', () => {
    assert.equal(commandExists(FAKE), false);
  });
});

describe('findBin', () => {
  it('returns a non-null path for node', () => {
    const result = findBin('node');
    assert.notEqual(result, null);
  });

  it('returned path contains "node"', () => {
    const result = findBin('node');
    assert.ok(result?.toLowerCase().includes('node'));
  });

  it('returns null for a non-existent binary', () => {
    assert.equal(findBin(FAKE), null);
  });
});

describe('spawnCommand', () => {
  it('runs a command and returns stdout', () => {
    const result = spawnCommand('node', ['--version'], { encoding: 'utf8' });
    assert.equal(result.status, 0);
    assert.ok(result.stdout.startsWith('v'));
  });

  it('returns non-zero status for invalid args', () => {
    const result = spawnCommand('node', ['--invalid-flag-xyz'], { encoding: 'utf8' });
    assert.notEqual(result.status, 0);
  });

  it('passes through spawn errors for non-existent commands', () => {
    const result = spawnCommand(FAKE, ['--version'], { encoding: 'utf8' });
    assert.ok(result.error);
  });
});

// ─── resolveWindowsCmd ────────────────────────────────────────────────────────

describe('resolveWindowsCmd', () => {
  let origComSpec: string | undefined;

  beforeEach(() => {
    origComSpec = process.env.ComSpec;
  });

  afterEach(() => {
    if (origComSpec !== undefined) process.env.ComSpec = origComSpec;
    else delete process.env.ComSpec;
  });

  it('routes .cmd files through ComSpec with /c', () => {
    const result = resolveWindowsCmd('C:\\npm\\claude.cmd', ['-p', 'hello']);
    assert.notEqual(result, null);
    assert.deepEqual(result!.args, ['/c', 'C:\\npm\\claude.cmd', '-p', 'hello']);
  });

  it('routes .CMD files (uppercase) through ComSpec', () => {
    const result = resolveWindowsCmd('C:\\npm\\cursor.CMD', ['--agent']);
    assert.notEqual(result, null);
    assert.equal(result!.args[0], '/c');
    assert.equal(result!.args[1], 'C:\\npm\\cursor.CMD');
  });

  it('routes .bat files through ComSpec', () => {
    const result = resolveWindowsCmd('C:\\scripts\\run.bat', ['arg1', 'arg2']);
    assert.notEqual(result, null);
    assert.deepEqual(result!.args, ['/c', 'C:\\scripts\\run.bat', 'arg1', 'arg2']);
  });

  it('returns null for .exe files', () => {
    assert.equal(resolveWindowsCmd('C:\\node\\node.exe', ['--version']), null);
  });

  it('returns null for null path', () => {
    assert.equal(resolveWindowsCmd(null, ['--version']), null);
  });

  it('returns null for paths without extension', () => {
    assert.equal(resolveWindowsCmd('/usr/local/bin/claude', ['-p', 'test']), null);
  });

  it('uses ComSpec env var when set', () => {
    process.env.ComSpec = 'C:\\custom\\cmd.exe';
    const result = resolveWindowsCmd('test.cmd', []);
    assert.equal(result!.bin, 'C:\\custom\\cmd.exe');
  });

  it('defaults to cmd.exe when ComSpec is not set', () => {
    delete process.env.ComSpec;
    const result = resolveWindowsCmd('test.cmd', []);
    assert.equal(result!.bin, 'cmd.exe');
  });

  it('preserves argument order including prompt with spaces', () => {
    const prompt = 'You are implementing a software development task. Make changes.';
    const result = resolveWindowsCmd('claude.cmd', ['-p', prompt, '--dangerously-skip-permissions']);
    assert.deepEqual(result!.args, ['/c', 'claude.cmd', '-p', prompt, '--dangerously-skip-permissions']);
  });

  it('handles empty args array', () => {
    const result = resolveWindowsCmd('script.cmd', []);
    assert.deepEqual(result!.args, ['/c', 'script.cmd']);
  });
});

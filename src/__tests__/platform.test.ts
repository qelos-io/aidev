import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { commandExists, findBin, spawnCommand } from '../platform';

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

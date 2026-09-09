import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getParentPid, getAncestorPids, isAncestorPid } from '../processTree';

// ─── getAncestorPids ──────────────────────────────────────────────────────────

describe('getAncestorPids', () => {
  it('returns a non-empty array whose first element equals process.ppid', () => {
    const ancestors = getAncestorPids();
    assert.ok(Array.isArray(ancestors));
    assert.ok(ancestors.length > 0, 'expected at least one ancestor');
    assert.equal(ancestors[0], process.ppid);
  });
});

// ─── isAncestorPid ────────────────────────────────────────────────────────────

describe('isAncestorPid', () => {
  it('returns true for the immediate parent (process.ppid)', () => {
    assert.equal(isAncestorPid(process.ppid), true);
  });

  it('returns false for the current process (self is not an ancestor)', () => {
    assert.equal(isAncestorPid(process.pid), false);
  });

  it('returns false for pid 0', () => {
    assert.equal(isAncestorPid(0), false);
  });

  it('returns false for negative pids', () => {
    assert.equal(isAncestorPid(-1), false);
  });

  it('returns false for a pid that is definitely not an ancestor', () => {
    assert.equal(isAncestorPid(999999), false);
  });
});

// ─── getParentPid ────────────────────────────────────────────────────────────

describe('getParentPid', () => {
  it('returns null for pid 0', () => {
    assert.equal(getParentPid(0), null);
  });

  it('returns null for negative pids', () => {
    assert.equal(getParentPid(-1), null);
  });
});

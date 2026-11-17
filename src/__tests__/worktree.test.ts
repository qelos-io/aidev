import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { shouldUseWorktree } from '../worktree';

const base = { useWorktree: false, worktreeTag: 'worktree' } as const;

describe('shouldUseWorktree', () => {
  it('is off by default', () => {
    assert.equal(shouldUseWorktree({ ...base }, { tags: [] }), false);
    assert.equal(shouldUseWorktree({ ...base }, undefined), false);
  });

  it('env enables it', () => {
    assert.equal(shouldUseWorktree({ ...base, useWorktree: true }, { tags: [] }), true);
  });

  it('task tag enables it case-insensitively', () => {
    assert.equal(shouldUseWorktree({ ...base }, { tags: ['Other', 'WorkTree'] }), true);
  });

  it('honors a custom tag name', () => {
    const cfg = { ...base, worktreeTag: 'wt' };
    assert.equal(shouldUseWorktree(cfg, { tags: ['worktree'] }), false);
    assert.equal(shouldUseWorktree(cfg, { tags: ['WT'] }), true);
  });

  it('CLI override wins over tag and env', () => {
    assert.equal(shouldUseWorktree({ ...base, useWorktree: true, worktreeOverride: false }, { tags: ['worktree'] }), false);
    assert.equal(shouldUseWorktree({ ...base, worktreeOverride: true }, { tags: [] }), true);
  });
});

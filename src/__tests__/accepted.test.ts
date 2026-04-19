import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildAcceptedMergeComment } from '../commands/accepted';
import type { Config } from '../types';

describe('buildAcceptedMergeComment', () => {
  it('includes comment prefix and branch name', () => {
    const config = { commentPrefix: '[aidev]' } as Config;
    const text = buildAcceptedMergeComment(config, 'abc123/fix-bug');
    assert.equal(
      text,
      '[aidev] Merging the accepted pull request for branch `abc123/fix-bug`.',
    );
  });

  it('respects custom comment prefix', () => {
    const config = { commentPrefix: '[bot]' } as Config;
    const text = buildAcceptedMergeComment(config, 'x/y');
    assert.ok(text.startsWith('[bot] '));
    assert.ok(text.includes('`x/y`'));
  });
});

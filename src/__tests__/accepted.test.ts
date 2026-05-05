import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  ACCEPTED_CONFLICT_MARKER,
  buildAcceptedConflictComment,
  buildAcceptedMergeComment,
  hasAlreadyNotifiedConflict,
  resolveDoneStatus,
} from '../commands/accepted';
import type { Comment, Config } from '../types';
import type { TaskProvider } from '../providers';

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

describe('buildAcceptedConflictComment', () => {
  it('embeds the conflict marker so duplicates can be detected', () => {
    const config = { commentPrefix: '[aidev]' } as Config;
    const text = buildAcceptedConflictComment(config, 'abc/fix', 'main');
    assert.ok(text.startsWith('[aidev] '));
    assert.ok(text.includes('`abc/fix`'));
    assert.ok(text.includes('`main`'));
    assert.ok(text.includes(ACCEPTED_CONFLICT_MARKER));
  });
});

function makeComment(text: string): Comment {
  return { id: 'c', text, author: 'a', authorId: 'a', date: 0 };
}

describe('hasAlreadyNotifiedConflict', () => {
  const prefix = '[aidev]';

  it('returns true when a prior aidev-prefixed conflict notice exists', () => {
    const config = { commentPrefix: prefix } as Config;
    const notice = buildAcceptedConflictComment(config, 'b/x', 'main');
    assert.equal(hasAlreadyNotifiedConflict([makeComment(notice)], prefix), true);
  });

  it('returns false when no prior notice exists', () => {
    const comments = [
      makeComment(`${prefix} Merging the accepted pull request for branch \`b/x\`.`),
      makeComment('looks good'),
    ];
    assert.equal(hasAlreadyNotifiedConflict(comments, prefix), false);
  });

  it('ignores notices that lack the comment prefix (so user-written text containing the marker does not block aidev)', () => {
    const text = `random user note: ${ACCEPTED_CONFLICT_MARKER}`;
    assert.equal(hasAlreadyNotifiedConflict([makeComment(text)], prefix), false);
  });

  it('returns false on empty comments', () => {
    assert.equal(hasAlreadyNotifiedConflict([], prefix), false);
  });
});

function stubProvider(overrides: Partial<TaskProvider> = {}): TaskProvider {
  const noop = async () => { throw new Error('not implemented'); };
  return {
    fetchTasks: noop,
    fetchTasksByStatus: noop,
    postComment: noop,
    getComments: noop,
    updateStatus: noop,
    createTask: noop,
    ...overrides,
  } as TaskProvider;
}

describe('resolveDoneStatus', () => {
  it('returns the configured doneStatus when set', async () => {
    const config = { doneStatus: 'Released' } as Config;
    const provider = stubProvider({
      fetchAvailableStatuses: async () => ['done', 'open'],
    });
    const result = await resolveDoneStatus(config, provider);
    assert.equal(result, 'Released');
  });

  it('detects "done" from available board statuses', async () => {
    const config = { doneStatus: '' } as Config;
    const provider = stubProvider({
      fetchAvailableStatuses: async () => ['Open', 'In Review', 'Done'],
    });
    const result = await resolveDoneStatus(config, provider);
    assert.equal(result, 'Done');
  });

  it('matches case-insensitively and preserves the board casing', async () => {
    const config = { doneStatus: '' } as Config;
    const provider = stubProvider({
      fetchAvailableStatuses: async () => ['Open', 'CLOSED'],
    });
    const result = await resolveDoneStatus(config, provider);
    assert.equal(result, 'CLOSED');
  });

  it('prefers "done" over later candidates when multiple match', async () => {
    const config = { doneStatus: '' } as Config;
    const provider = stubProvider({
      fetchAvailableStatuses: async () => ['prod', 'finish', 'done', 'closed'],
    });
    const result = await resolveDoneStatus(config, provider);
    assert.equal(result, 'done');
  });

  it('falls back through the candidate order (closed, finish, success, prod)', async () => {
    const config = { doneStatus: '' } as Config;
    const provider = stubProvider({
      fetchAvailableStatuses: async () => ['Backlog', 'Success', 'Prod'],
    });
    const result = await resolveDoneStatus(config, provider);
    assert.equal(result, 'Success');
  });

  it('returns null when no candidate matches', async () => {
    const config = { doneStatus: '' } as Config;
    const provider = stubProvider({
      fetchAvailableStatuses: async () => ['Open', 'In Review', 'Backlog'],
    });
    const result = await resolveDoneStatus(config, provider);
    assert.equal(result, null);
  });

  it('returns null when the provider does not implement fetchAvailableStatuses', async () => {
    const config = { doneStatus: '' } as Config;
    const provider = stubProvider();
    const result = await resolveDoneStatus(config, provider);
    assert.equal(result, null);
  });

  it('returns null when fetchAvailableStatuses throws', async () => {
    const config = { doneStatus: '' } as Config;
    const provider = stubProvider({
      fetchAvailableStatuses: async () => { throw new Error('boom'); },
    });
    const result = await resolveDoneStatus(config, provider);
    assert.equal(result, null);
  });
});

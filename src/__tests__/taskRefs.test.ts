import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { augmentTaskReferences } from '../prompts/taskRefs';
import { taskDescription } from '../prompts/shared';
import { Task } from '../types';

function makeTask(overrides: Partial<Task>): Task {
  return {
    id: 'abc111',
    name: 'Self task',
    description: '',
    status: 'open',
    url: 'https://app.clickup.com/t/abc111',
    tags: [],
    ...overrides,
  };
}

describe('augmentTaskReferences', () => {
  describe('ClickUp URLs', () => {
    const self = makeTask({});

    it('appends a --remote hint after a referenced task URL', () => {
      const text = 'Depends on https://app.clickup.com/t/xyz999 being done first.';
      const out = augmentTaskReferences(text, self);
      assert.equal(
        out,
        'Depends on https://app.clickup.com/t/xyz999 (run `aidev tasks get xyz999 --remote`) being done first.',
      );
    });

    it('skips a self-reference URL', () => {
      const text = 'See https://app.clickup.com/t/abc111 for context.';
      const out = augmentTaskReferences(text, self);
      assert.equal(out, text);
    });

    it('annotates multiple URLs in one text', () => {
      const text = 'https://app.clickup.com/t/aaa222 and https://app.clickup.com/t/bbb333';
      const out = augmentTaskReferences(text, self);
      assert.ok(out.includes('aaa222 (run `aidev tasks get aaa222 --remote`)'));
      assert.ok(out.includes('bbb333 (run `aidev tasks get bbb333 --remote`)'));
    });

    it('does not annotate a URL with the same id as self', () => {
      const text = 'https://app.clickup.com/t/abc111';
      const out = augmentTaskReferences(text, self);
      assert.equal(out, text);
    });
  });

  describe('Jira bare IDs', () => {
    const self = makeTask({
      id: 'PROJ-100',
      url: 'https://example.atlassian.net/browse/PROJ-100',
    });

    it('appends a --remote hint after bare KEY-NUMBER references', () => {
      const text = 'Blocked by PROJ-200 and related to PROJ-300.';
      const out = augmentTaskReferences(text, self);
      assert.equal(
        out,
        'Blocked by PROJ-200 (run `aidev tasks get PROJ-200 --remote`) and related to PROJ-300 (run `aidev tasks get PROJ-300 --remote`).',
      );
    });

    it('skips a self-reference bare id', () => {
      const text = 'See PROJ-100 for context.';
      const out = augmentTaskReferences(text, self);
      assert.equal(out, text);
    });

    it('does not double-annotate when run twice (idempotent)', () => {
      const text = 'Blocked by PROJ-200.';
      const once = augmentTaskReferences(text, self);
      const twice = augmentTaskReferences(once, self);
      assert.equal(once, twice);
    });

    it('does not match bare ids inside a URL span', () => {
      const text = 'https://example.atlassian.net/browse/PROJ-200';
      const out = augmentTaskReferences(text, self);
      // The URL gets annotated once; the bare PROJ-200 inside it is not matched again
      assert.ok(out.includes('browse/PROJ-200 (run `aidev tasks get PROJ-200 --remote`)'));
      // Only one annotation was inserted (PROJ-200 appears once in the URL and
      // once inside the single annotation — no duplicate annotation).
      assert.equal(
        (out.match(/run `aidev tasks get PROJ-200/g) || []).length,
        1,
      );
    });
  });

  describe('Linear bare IDs', () => {
    const self = makeTask({
      id: 'ENG-42',
      url: 'https://linear.app/team/issue/ENG-42',
    });

    it('annotates a bare Linear id', () => {
      const text = 'Depends on ENG-99.';
      const out = augmentTaskReferences(text, self);
      assert.ok(out.includes('ENG-99 (run `aidev tasks get ENG-99 --remote`)'));
    });
  });

  describe('local provider (non-http url)', () => {
    const self = makeTask({
      id: 'taskA',
      url: '/path/.aidev/tasks/open/taskA.md',
    });

    it('omits --remote from the hint when the self url is not http', () => {
      const text = 'See /path/.aidev/tasks/open/taskB.md for details.';
      const out = augmentTaskReferences(text, self);
      assert.ok(out.includes('(run `aidev tasks get taskB`)'));
      assert.ok(!out.includes('--remote'));
    });
  });

  describe('edge cases', () => {
    const self = makeTask({});

    it('returns the text unchanged when there are no references', () => {
      const text = 'Just a plain description with no links.';
      assert.equal(augmentTaskReferences(text, self), text);
    });

    it('returns the text unchanged when empty', () => {
      assert.equal(augmentTaskReferences('', self), '');
    });

    it('returns the text unchanged when self url is empty', () => {
      const noUrl = makeTask({ url: '' });
      const text = 'https://app.clickup.com/t/xyz999';
      assert.equal(augmentTaskReferences(text, noUrl), text);
    });

    it('does not re-annotate an already-annotated reference', () => {
      const text = 'https://app.clickup.com/t/xyz999 (run `aidev tasks get xyz999 --remote`)';
      const out = augmentTaskReferences(text, self);
      assert.equal(out, text);
    });
  });

  describe('parent task hint (via taskDescription)', () => {
    it('appends a parent-task hint when parentTaskId is set (remote)', () => {
      const task = makeTask({
        parentTaskId: 'parent456',
        description: 'Do the thing',
      });
      const desc = taskDescription(task);
      assert.ok(desc.includes('Do the thing'));
      assert.ok(
        desc.includes('(This task is a subtask. To get the parent task run `aidev tasks get parent456 --remote`)'),
      );
    });

    it('omits --remote for local provider tasks', () => {
      const task = makeTask({
        id: 'taskA',
        url: '/path/.aidev/tasks/open/taskA.md',
        parentTaskId: 'taskB',
        description: 'Do the thing',
      });
      const desc = taskDescription(task);
      assert.ok(desc.includes('`aidev tasks get taskB`)'));
      assert.ok(!desc.includes('--remote'));
    });

    it('does not append a parent hint when parentTaskId is absent', () => {
      const task = makeTask({ description: 'Do the thing' });
      const desc = taskDescription(task);
      assert.ok(!desc.includes('parent task'));
    });
  });
});

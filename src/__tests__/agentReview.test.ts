import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Task } from '../types';
import {
  buildAgentReviewExportInstructions,
  buildAgentReviewPrompt,
  composeAgentReviewPrompt,
  parseAgentReviewResponse,
} from '../prompts/agentReview';

function stubTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'TASK-1',
    name: 'Add agent review',
    description: 'Ship the default agent-review prompt and parser.',
    status: 'open',
    url: 'https://example.test/t/TASK-1',
    tags: [],
    ...overrides,
  };
}

const sampleDiff = `diff --git a/src/foo.ts b/src/foo.ts
index 123..456 100644
--- a/src/foo.ts
+++ b/src/foo.ts
@@ -1,3 +1,4 @@
 export function foo() {
+  return 42;
 }
`;

describe('buildAgentReviewPrompt', () => {
  it('includes task info, diff, and export instructions', () => {
    const task = stubTask();
    const prompt = buildAgentReviewPrompt(task, sampleDiff, 'https://github.com/acme/repo/pull/1');

    assert.ok(prompt.includes('Task: Add agent review'));
    assert.ok(prompt.includes('Ship the default agent-review prompt and parser.'));
    assert.ok(prompt.includes('https://github.com/acme/repo/pull/1'));
    assert.ok(prompt.includes(sampleDiff.trim()));
    assert.ok(prompt.includes(buildAgentReviewExportInstructions()));
    assert.ok(prompt.includes('senior code reviewer'));
    assert.ok(prompt.includes('Correctness'));
    assert.ok(prompt.includes('empty array []'));
  });
});

describe('composeAgentReviewPrompt', () => {
  it('uses skill content as the main body while keeping diff and export instructions', () => {
    const task = stubTask();
    const skillContent = 'Custom review skill: focus on API compatibility only.';
    const prompt = composeAgentReviewPrompt(
      task,
      sampleDiff,
      'https://github.com/acme/repo/pull/2',
      skillContent,
    );

    assert.ok(prompt.includes(skillContent));
    assert.ok(!prompt.includes('senior code reviewer'));
    assert.ok(prompt.includes('Task: Add agent review'));
    assert.ok(prompt.includes(sampleDiff.trim()));
    assert.ok(prompt.includes(buildAgentReviewExportInstructions()));
  });

  it('falls back to the built-in body when skill content is null', () => {
    const task = stubTask();
    const prompt = composeAgentReviewPrompt(task, sampleDiff);

    assert.ok(prompt.includes('senior code reviewer'));
    assert.ok(prompt.includes(buildAgentReviewExportInstructions()));
  });
});

describe('parseAgentReviewResponse', () => {
  it('accepts valid comments', () => {
    const output = JSON.stringify([
      { path: 'src/foo.ts', line: 42, body: 'Use const here.' },
      { path: 'src/bar.ts', line: 10, body: 'Missing null check.' },
    ]);

    const parsed = parseAgentReviewResponse(output);
    assert.deepEqual(parsed, [
      { path: 'src/foo.ts', line: 42, body: 'Use const here.' },
      { path: 'src/bar.ts', line: 10, body: 'Missing null check.' },
    ]);
  });

  it('accepts an empty array', () => {
    assert.deepEqual(parseAgentReviewResponse('[]'), []);
    assert.deepEqual(parseAgentReviewResponse('No issues found:\n[]\nDone.'), []);
  });

  it('extracts JSON from output with surrounding prose', () => {
    const output = `Here are my findings:\n${JSON.stringify([
      { path: 'src/foo.ts', line: 3, body: 'Explain the issue.' },
    ])}\nThanks!`;

    const parsed = parseAgentReviewResponse(output);
    assert.deepEqual(parsed, [{ path: 'src/foo.ts', line: 3, body: 'Explain the issue.' }]);
  });

  it('extracts JSON from markdown fences', () => {
    const output = `\`\`\`json\n${JSON.stringify([
      { path: 'src/foo.ts', line: 5, body: 'Fix typo.' },
    ])}\n\`\`\``;

    const parsed = parseAgentReviewResponse(output);
    assert.deepEqual(parsed, [{ path: 'src/foo.ts', line: 5, body: 'Fix typo.' }]);
  });

  it('rejects malformed JSON', () => {
    assert.equal(parseAgentReviewResponse('this is not json at all'), null);
    assert.equal(parseAgentReviewResponse('[ unterminated'), null);
  });

  it('rejects items with missing or invalid fields', () => {
    assert.equal(parseAgentReviewResponse(JSON.stringify([
      { path: '', line: 1, body: 'missing path' },
    ])), null);

    assert.equal(parseAgentReviewResponse(JSON.stringify([
      { path: 'src/foo.ts', line: 0, body: 'line must be positive' },
    ])), null);

    assert.equal(parseAgentReviewResponse(JSON.stringify([
      { path: 'src/foo.ts', line: 1.5, body: 'line must be integer' },
    ])), null);

    assert.equal(parseAgentReviewResponse(JSON.stringify([
      { path: 'src/foo.ts', line: 1, body: '' },
    ])), null);

    assert.equal(parseAgentReviewResponse(JSON.stringify([
      { path: 'src/foo.ts', line: '1', body: 'line must be number' },
    ])), null);

    assert.equal(parseAgentReviewResponse(JSON.stringify([
      { path: 'src/foo.ts', body: 'missing line' },
    ])), null);
  });
});

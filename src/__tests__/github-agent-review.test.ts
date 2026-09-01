import { describe, it, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildAgentReviewPayload,
  fetchPrDiff,
  getPrHeadSha,
  postAgentPullRequestReview,
} from '../github';
import type { AgentReviewComment } from '../prompts/agentReview';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const childProcess = require('node:child_process');

function isReviewApiCall(args: string[]): boolean {
  return args.includes('api') && args.some((arg) => arg.includes('/reviews'));
}

function mockGhSpawnSync(
  handler: (args: string[], input?: string) => {
    status: number;
    stdout: string;
    stderr: string;
  }
): void {
  mock.method(childProcess, 'spawnSync', (_cmd: string, args: string[], options?: { input?: string }) => {
    const isGh = args.includes('pr') || args.includes('api');
    if (!isGh) {
      return { status: 1, stdout: '', stderr: '', pid: 1, output: [], signal: null };
    }
    const result = handler(args, options?.input);
    return { ...result, pid: 1, output: [], signal: null };
  });
}

describe('buildAgentReviewPayload', () => {
  it('uses APPROVE when there are no inline comments', () => {
    const payload = buildAgentReviewPayload({
      headSha: 'abc123',
      comments: [],
      summary: 'Looks good',
    });

    assert.deepEqual(payload, {
      commit_id: 'abc123',
      body: 'Looks good',
      event: 'APPROVE',
    });
    assert.equal(payload.comments, undefined);
  });

  it('uses COMMENT with inline comments when issues are reported', () => {
    const comments: AgentReviewComment[] = [
      { path: 'src/index.ts', line: 10, body: 'Use const here' },
      { path: 'src/util.ts', line: 3, body: 'Missing null check' },
    ];

    const payload = buildAgentReviewPayload({
      headSha: 'deadbeef',
      comments,
      summary: 'Found 2 issues',
    });

    assert.equal(payload.event, 'COMMENT');
    assert.equal(payload.commit_id, 'deadbeef');
    assert.equal(payload.body, 'Found 2 issues');
    assert.deepEqual(payload.comments, [
      { path: 'src/index.ts', line: 10, body: 'Use const here', side: 'RIGHT' },
      { path: 'src/util.ts', line: 3, body: 'Missing null check', side: 'RIGHT' },
    ]);
  });
});

describe('fetchPrDiff', () => {
  beforeEach(() => mock.restoreAll());
  afterEach(() => mock.restoreAll());

  it('returns diff text on success', () => {
    mockGhSpawnSync((args) => {
      if (args.includes('diff')) {
        return { status: 0, stdout: 'diff --git a/foo b/foo\n', stderr: '' };
      }
      return { status: 1, stdout: '', stderr: 'unexpected' };
    });

    const result = fetchPrDiff('abc123/fix-bug');
    assert.equal(result.error, '');
    assert.equal(result.diff, 'diff --git a/foo b/foo\n');
  });

  it('returns a descriptive error when gh exits non-zero', () => {
    mockGhSpawnSync((args) => {
      if (args.includes('diff')) {
        return { status: 1, stdout: 'no open pull request', stderr: 'GraphQL: Could not resolve' };
      }
      return { status: 0, stdout: '', stderr: '' };
    });

    const result = fetchPrDiff('missing-branch');
    assert.equal(result.diff, '');
    assert.ok(result.error.includes('GraphQL: Could not resolve'));
    assert.ok(result.error.includes('no open pull request'));
  });

  it('falls back to exit status when gh produces no output', () => {
    mockGhSpawnSync((args) => {
      if (args.includes('diff')) {
        return { status: 2, stdout: '', stderr: '' };
      }
      return { status: 0, stdout: '', stderr: '' };
    });

    const result = fetchPrDiff('broken');
    assert.equal(result.diff, '');
    assert.equal(result.error, 'gh exited with status 2');
  });
});

describe('getPrHeadSha', () => {
  beforeEach(() => mock.restoreAll());
  afterEach(() => mock.restoreAll());

  it('returns headRefOid from gh pr view JSON', () => {
    mockGhSpawnSync((args) => {
      if (args.includes('view') && args.includes('headRefOid')) {
        return { status: 0, stdout: JSON.stringify({ headRefOid: 'sha123' }), stderr: '' };
      }
      return { status: 1, stdout: '', stderr: 'not found' };
    });

    assert.equal(getPrHeadSha('abc/fix'), 'sha123');
  });

  it('returns null when gh fails', () => {
    mockGhSpawnSync(() => ({ status: 1, stdout: '', stderr: 'not found' }));
    assert.equal(getPrHeadSha('missing'), null);
  });
});

describe('postAgentPullRequestReview', () => {
  beforeEach(() => mock.restoreAll());
  afterEach(() => mock.restoreAll());

  it('submits APPROVE payload when comments are empty', () => {
    let capturedInput = '';
    mockGhSpawnSync((args, input) => {
      if (isReviewApiCall(args)) {
        capturedInput = input ?? '';
        return { status: 0, stdout: '{}', stderr: '' };
      }
      return { status: 1, stdout: '', stderr: 'unexpected' };
    });

    const result = postAgentPullRequestReview({
      owner: 'acme',
      repo: 'widgets',
      prNumber: 42,
      headSha: 'abc123',
      comments: [],
      summary: 'No issues found',
    });

    assert.equal(result.success, true);
    assert.equal(result.error, '');
    assert.equal(result.commentsPosted, 0);
    assert.deepEqual(JSON.parse(capturedInput), {
      commit_id: 'abc123',
      body: 'No issues found',
      event: 'APPROVE',
    });
  });

  it('submits COMMENT payload with inline comments', () => {
    let capturedInput = '';
    mockGhSpawnSync((args, input) => {
      if (isReviewApiCall(args)) {
        capturedInput = input ?? '';
        return { status: 0, stdout: '{}', stderr: '' };
      }
      return { status: 1, stdout: '', stderr: 'unexpected' };
    });

    const comments: AgentReviewComment[] = [
      { path: 'src/a.ts', line: 5, body: 'nit' },
    ];

    const result = postAgentPullRequestReview({
      owner: 'acme',
      repo: 'widgets',
      prNumber: 7,
      headSha: 'deadbeef',
      comments,
      summary: 'One issue',
    });

    assert.equal(result.success, true);
    assert.equal(result.commentsPosted, 1);
    assert.deepEqual(JSON.parse(capturedInput), {
      commit_id: 'deadbeef',
      body: 'One issue',
      event: 'COMMENT',
      comments: [{ path: 'src/a.ts', line: 5, body: 'nit', side: 'RIGHT' }],
    });
  });

  it('returns failure details when gh api rejects the review', () => {
    mockGhSpawnSync((args) => {
      if (isReviewApiCall(args)) {
        return { status: 1, stdout: '', stderr: 'validation failed' };
      }
      return { status: 0, stdout: '', stderr: '' };
    });

    const result = postAgentPullRequestReview({
      owner: 'acme',
      repo: 'widgets',
      prNumber: 7,
      headSha: 'deadbeef',
      comments: [{ path: 'src/a.ts', line: 1, body: 'fix' }],
      summary: 'Issues',
    });

    assert.equal(result.success, false);
    assert.equal(result.commentsPosted, 0);
    assert.equal(result.error, 'validation failed');
  });
});

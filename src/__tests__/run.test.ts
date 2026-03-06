import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildPRUrl, buildCompletionComment, buildImplementPrompt } from '../commands/run';
import type { Config } from '../types';
import type { Task } from '../types';

const baseConfig = {
  githubRepo: 'owner/repo',
  githubBaseBranch: 'main',
  clickupInReviewStatus: 'review',
} as Config;

// ─── buildPRUrl ───────────────────────────────────────────────────────────────

describe('buildPRUrl', () => {
  it('returns a GitHub compare URL', () => {
    const url = buildPRUrl(baseConfig, 'abc123/fix-login');
    assert.ok(url.startsWith('https://github.com/owner/repo/compare/'));
    assert.ok(url.includes('main...'));
    assert.ok(url.includes('expand=1'));
  });

  it('URL-encodes the branch name', () => {
    const url = buildPRUrl(baseConfig, 'abc/fix login');
    assert.ok(url.includes('fix%20login'));
  });

  it('returns empty string when githubRepo is not set', () => {
    const url = buildPRUrl({ ...baseConfig, githubRepo: '' }, 'abc/branch');
    assert.equal(url, '');
  });
});

// ─── buildCompletionComment ───────────────────────────────────────────────────

describe('buildCompletionComment', () => {
  it('includes the branch name', () => {
    const comment = buildCompletionComment('abc123/fix-login', '', baseConfig);
    assert.ok(comment.includes('abc123/fix-login'));
  });

  it('includes the in-review status', () => {
    const comment = buildCompletionComment('abc/branch', '', baseConfig);
    assert.ok(comment.includes('review'));
  });

  it('includes PR link when provided', () => {
    const comment = buildCompletionComment('abc/branch', 'https://github.com/pr/1', baseConfig);
    assert.ok(comment.includes('https://github.com/pr/1'));
  });

  it('omits PR link when empty', () => {
    const comment = buildCompletionComment('abc/branch', '', baseConfig);
    assert.ok(!comment.includes('https://'));
  });
});

// ─── buildImplementPrompt ─────────────────────────────────────────────────────

describe('buildImplementPrompt', () => {
  const task: Task = {
    id: 'abc123',
    name: 'Fix login bug',
    description: 'Users cannot log in with email.',
    status: 'open',
    url: 'https://app.clickup.com/t/abc123',
    tags: ['myproject'],
  };

  it('includes the task name', () => {
    const prompt = buildImplementPrompt(task, '');
    assert.ok(prompt.includes('Fix login bug'));
  });

  it('includes the description', () => {
    const prompt = buildImplementPrompt(task, '');
    assert.ok(prompt.includes('Users cannot log in with email.'));
  });

  it('includes context when provided', () => {
    const prompt = buildImplementPrompt(task, 'Use JWT tokens.');
    assert.ok(prompt.includes('Use JWT tokens.'));
  });

  it('handles missing description gracefully', () => {
    const prompt = buildImplementPrompt({ ...task, description: '' }, '');
    assert.ok(prompt.includes('no description provided'));
  });
});

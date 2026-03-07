import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildPRUrl, buildCompletionComment, buildImplementPrompt, hasHumanReply, hasTriggerWord } from '../commands/run';
import type { Config, Comment } from '../types';
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

// ─── hasHumanReply ────────────────────────────────────────────────────────────

function makeComment(text: string): Comment {
  return { id: '1', text, author: 'user', authorId: '100', date: Date.now() };
}

describe('hasHumanReply', () => {
  it('returns false when fewer than 2 comments', () => {
    assert.equal(hasHumanReply([]), false);
    assert.equal(hasHumanReply([makeComment('hello')]), false);
  });

  it('returns true when last comment is from a human', () => {
    const comments = [
      makeComment('[aidev] Starting implementation'),
      makeComment('Please also fix the tests'),
    ];
    assert.equal(hasHumanReply(comments), true);
  });

  it('returns false when last comment is from aidev', () => {
    const comments = [
      makeComment('[aidev] Starting implementation'),
      makeComment('[aidev] All AI runners failed.'),
    ];
    assert.equal(hasHumanReply(comments), false);
  });
});

// ─── hasTriggerWord ───────────────────────────────────────────────────────────

describe('hasTriggerWord', () => {
  it('returns false on empty comments', () => {
    assert.equal(hasTriggerWord([], 'aidev-continue'), false);
  });

  it('returns true when last comment contains the trigger word', () => {
    const comments = [makeComment('aidev-continue please re-run')];
    assert.equal(hasTriggerWord(comments, 'aidev-continue'), true);
  });

  it('is case-insensitive', () => {
    const comments = [makeComment('AIDEV-CONTINUE')];
    assert.equal(hasTriggerWord(comments, 'aidev-continue'), true);
  });

  it('returns false when trigger word is absent', () => {
    const comments = [makeComment('Please fix the tests')];
    assert.equal(hasTriggerWord(comments, 'aidev-continue'), false);
  });

  it('returns false when trigger word is empty', () => {
    const comments = [makeComment('any text')];
    assert.equal(hasTriggerWord(comments, ''), false);
  });
});

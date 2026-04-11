import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildPRUrl, buildPRBody, buildCompletionComment, buildNonCodeCompletionComment, buildNonCodePrompt, buildImplementPrompt, buildConflictResolutionPrompt, hasHumanReply, hasTriggerWord, hasAidevComment, filterAutomatedComments, DEFAULT_TRIGGER_WORD, checkNeedsClarification, sortTasksByPriority, getRunSkipReason } from '../commands/run';
import type { Config, Comment } from '../types';
import type { Task } from '../types';
import type { AIRunner, AIRunResult } from '../ai/base';

const baseConfig = {
  provider: 'clickup',
  githubRepo: 'owner/repo',
  githubBaseBranch: 'main',
  clickupInReviewStatus: 'review',
  commentPrefix: '[aidev]',
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

// ─── buildPRBody ─────────────────────────────────────────────────────────────

describe('buildPRBody', () => {
  const task: Task = {
    id: 'abc123',
    name: 'Fix bug',
    description: 'Fix the login bug',
    status: 'open',
    url: 'https://app.clickup.com/t/abc123',
    tags: ['myproject'],
  };

  it('includes the task URL', () => {
    const body = buildPRBody(task);
    assert.ok(body.includes('https://app.clickup.com/t/abc123'));
  });

  it('uses default signature when PR_SIGNATURE is not set', () => {
    const original = process.env.PR_SIGNATURE;
    delete process.env.PR_SIGNATURE;
    const body = buildPRBody(task);
    assert.ok(body.includes('Automated PR by aidev.'));
    if (original !== undefined) process.env.PR_SIGNATURE = original;
  });

  it('uses PR_SIGNATURE env var when set', () => {
    const original = process.env.PR_SIGNATURE;
    process.env.PR_SIGNATURE = 'Custom signature from CI';
    const body = buildPRBody(task);
    assert.ok(body.includes('Custom signature from CI'));
    assert.ok(!body.includes('Automated PR by aidev.'));
    if (original !== undefined) {
      process.env.PR_SIGNATURE = original;
    } else {
      delete process.env.PR_SIGNATURE;
    }
  });

  it('formats as "Implements: <url>\\n\\n<signature>"', () => {
    const original = process.env.PR_SIGNATURE;
    delete process.env.PR_SIGNATURE;
    const body = buildPRBody(task);
    assert.equal(body, 'Implements: https://app.clickup.com/t/abc123\n\nAutomated PR by aidev.');
    if (original !== undefined) process.env.PR_SIGNATURE = original;
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

  it('uses custom prefix when configured', () => {
    const customConfig = { ...baseConfig, commentPrefix: '[mybot]' } as Config;
    const comment = buildCompletionComment('abc/branch', '', customConfig);
    assert.ok(comment.startsWith('[mybot]'));
    assert.ok(!comment.includes('[aidev]'));
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

  it('uses custom prefix when provided', () => {
    const comments = [
      makeComment('[mybot] Starting implementation'),
      makeComment('Please also fix the tests'),
    ];
    assert.equal(hasHumanReply(comments, '[mybot]'), true);
  });

  it('returns false when last comment has custom prefix', () => {
    const comments = [
      makeComment('[mybot] Starting implementation'),
      makeComment('[mybot] All AI runners failed.'),
    ];
    assert.equal(hasHumanReply(comments, '[mybot]'), false);
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

  it('returns false when trigger word is empty and no default trigger present', () => {
    const comments = [makeComment('any text')];
    assert.equal(hasTriggerWord(comments, ''), false);
  });

  // ── Default trigger word always works regardless of configured triggerWord ──

  it('DEFAULT_TRIGGER_WORD is "aidev-continue"', () => {
    assert.equal(DEFAULT_TRIGGER_WORD, 'aidev-continue');
  });

  it('aidev-continue works even when triggerWord is empty (no env config)', () => {
    const comments = [makeComment('aidev-continue')];
    assert.equal(hasTriggerWord(comments, ''), true);
  });

  it('aidev-continue works even when a different triggerWord is configured', () => {
    const comments = [makeComment('aidev-continue')];
    assert.equal(hasTriggerWord(comments, 'my-custom-word'), true);
  });

  it('configured custom trigger word also works', () => {
    const comments = [makeComment('my-custom-word go ahead')];
    assert.equal(hasTriggerWord(comments, 'my-custom-word'), true);
  });

  it('only checks the last comment — earlier trigger word is ignored', () => {
    const comments = [
      makeComment('aidev-continue'),
      makeComment('Please review my changes'),
    ];
    // last comment has no trigger word
    assert.equal(hasTriggerWord(comments, 'aidev-continue'), false);
  });
});

// ─── checkNeedsClarification ──────────────────────────────────────────────────

function makeRunner(name: string, success: boolean, output: string): AIRunner {
  return {
    name,
    isAvailable: () => true,
    run: async (_prompt: string): Promise<AIRunResult> => ({ success, output, error: success ? '' : 'error' }),
  };
}

const clarificationTask: Task = {
  id: 'abc123',
  name: 'Add dark mode',
  description: 'Support a dark color scheme.',
  status: 'open',
  url: 'https://app.clickup.com/t/abc123',
  tags: ['myproject'],
};

const clarificationConfig = {
  devNotesMode: 'smart',
  clickupPendingStatus: 'pending',
} as unknown as Config;

const mockProvider = {
  fetchTasks: async () => [],
  fetchTasksByStatus: async () => [],
  getComments: async () => [],
  postComment: async () => {},
  updateStatus: async () => {},
  createTask: async () => ({ id: '', url: '' }),
};

describe('checkNeedsClarification', () => {
  it('returns a question when runner says task is not clear', async () => {
    const runner = makeRunner('claude', true, JSON.stringify({ clear: false, question: 'Which color scheme?' }));
    const q = await checkNeedsClarification(clarificationTask, clarificationConfig, mockProvider, [runner]);
    assert.equal(q, 'Which color scheme?');
  });

  it('returns null when runner says task is clear', async () => {
    const runner = makeRunner('claude', true, JSON.stringify({ clear: true, question: null }));
    const q = await checkNeedsClarification(clarificationTask, clarificationConfig, mockProvider, [runner]);
    assert.equal(q, null);
  });

  it('falls back to next runner when first runner fails', async () => {
    const failing = makeRunner('cursor', false, '');
    const working = makeRunner('claude', true, JSON.stringify({ clear: false, question: 'Any preferences?' }));
    const q = await checkNeedsClarification(clarificationTask, clarificationConfig, mockProvider, [failing, working]);
    assert.equal(q, 'Any preferences?');
  });

  it('falls back to next runner when first runner returns unparseable JSON', async () => {
    const bad = makeRunner('cursor', true, 'not json at all');
    const good = makeRunner('claude', true, JSON.stringify({ clear: true, question: null }));
    const q = await checkNeedsClarification(clarificationTask, clarificationConfig, mockProvider, [bad, good]);
    assert.equal(q, null);
  });

  it('returns null when all runners fail', async () => {
    const a = makeRunner('cursor', false, '');
    const b = makeRunner('windsurf', false, '');
    const q = await checkNeedsClarification(clarificationTask, clarificationConfig, mockProvider, [a, b]);
    assert.equal(q, null);
  });

  it('returns null when no runners are available', async () => {
    const unavailable = { name: 'cursor', isAvailable: () => false, run: async () => ({ success: false, output: '', error: '' }) };
    const q = await checkNeedsClarification(clarificationTask, clarificationConfig, mockProvider, [unavailable]);
    assert.equal(q, null);
  });

  it('returns the always-ask clarification prompt when devNotesMode is "always"', async () => {
    const config = { ...clarificationConfig, devNotesMode: 'always' } as unknown as Config;
    const q = await checkNeedsClarification(clarificationTask, config, mockProvider, []);
    assert.ok(q !== null && q.includes('Add dark mode'));
  });
});

// ─── hasAidevComment ──────────────────────────────────────────────────────────

describe('hasAidevComment', () => {
  it('returns false on empty comments', () => {
    assert.equal(hasAidevComment([]), false);
  });

  it('returns true when a comment contains [aidev]', () => {
    const comments = [
      makeComment('[aidev] Starting implementation'),
      makeComment('Some human reply'),
    ];
    assert.equal(hasAidevComment(comments), true);
  });

  it('returns false when no comment contains [aidev]', () => {
    const comments = [
      makeComment('Please fix the tests'),
      makeComment('I agree, this needs work'),
    ];
    assert.equal(hasAidevComment(comments), false);
  });

  it('returns true when only the last comment is from aidev', () => {
    const comments = [
      makeComment('Human wrote this'),
      makeComment('[aidev] Non-code task complete!'),
    ];
    assert.equal(hasAidevComment(comments), true);
  });

  it('detects custom prefix', () => {
    const comments = [
      makeComment('[mybot] Starting implementation'),
    ];
    assert.equal(hasAidevComment(comments, '[mybot]'), true);
  });

  it('returns false when custom prefix is not present', () => {
    const comments = [
      makeComment('[aidev] Starting implementation'),
    ];
    assert.equal(hasAidevComment(comments, '[mybot]'), false);
  });
});

// ─── filterAutomatedComments ──────────────────────────────────────────────────

describe('filterAutomatedComments', () => {
  it('returns empty array for empty input', () => {
    assert.deepEqual(filterAutomatedComments([]), []);
  });

  it('removes comments containing [aidev]', () => {
    const human = makeComment('Please fix the tests');
    const automated = makeComment('[aidev] Starting implementation on branch foo');
    const result = filterAutomatedComments([human, automated]);
    assert.deepEqual(result, [human]);
  });

  it('keeps all comments when none are automated', () => {
    const comments = [
      makeComment('Please fix the tests'),
      makeComment('I agree, this needs work'),
    ];
    assert.deepEqual(filterAutomatedComments(comments), comments);
  });

  it('removes all comments when all are automated', () => {
    const comments = [
      makeComment('[aidev] Starting implementation'),
      makeComment('[aidev] Merge conflicts resolved automatically.'),
    ];
    assert.deepEqual(filterAutomatedComments(comments), []);
  });

  it('filters by custom prefix', () => {
    const human = makeComment('Please fix the tests');
    const automated = makeComment('[mybot] Starting implementation on branch foo');
    const result = filterAutomatedComments([human, automated], '[mybot]');
    assert.deepEqual(result, [human]);
  });
});

// ─── buildNonCodeCompletionComment ────────────────────────────────────────────

describe('buildNonCodeCompletionComment', () => {
  it('includes the in-review status', () => {
    const comment = buildNonCodeCompletionComment(baseConfig);
    assert.ok(comment.includes('review'));
  });

  it('starts with the [aidev] prefix', () => {
    const comment = buildNonCodeCompletionComment(baseConfig);
    assert.ok(comment.startsWith('[aidev]'));
  });

  it('mentions non-code task', () => {
    const comment = buildNonCodeCompletionComment(baseConfig);
    assert.ok(comment.includes('Non-code task complete'));
  });

  it('does not include branch or PR info', () => {
    const comment = buildNonCodeCompletionComment(baseConfig);
    assert.ok(!comment.includes('Branch:'));
    assert.ok(!comment.includes('PR'));
  });

  it('includes agent response when provided', () => {
    const comment = buildNonCodeCompletionComment(baseConfig, 'The answer to your question is 42.');
    assert.ok(comment.includes('The answer to your question is 42.'));
    assert.ok(comment.includes('[aidev] Non-code task complete'));
  });

  it('omits agent response section when not provided', () => {
    const comment = buildNonCodeCompletionComment(baseConfig);
    assert.ok(!comment.includes('---'));
  });

  it('uses custom prefix when configured', () => {
    const customConfig = { ...baseConfig, commentPrefix: '[mybot]' } as Config;
    const comment = buildNonCodeCompletionComment(customConfig);
    assert.ok(comment.startsWith('[mybot]'));
    assert.ok(!comment.includes('[aidev]'));
  });

  it('filters out instructional text from agent response', () => {
    const agentResponse = `Here's text you can paste as the **task ticket comment** (addresses your latest ask: do it + push):

---

**Done — publish + push**

I published **one English post** from the LinkedIn drafts, using the **oldest draft by git history** (first commit that added the file): \`qelos-plugins-microfrontends.md\` (committed 2026-03-11 00:51, before \`qelos-netlify-plugin.md\`). The body sent to LinkedIn was the **\`## Post (English)\`** section, **without markdown** (no \`**\`, \`\`\`, or \`#\` headings) so it matches what the text webhook expects.`;
    
    const comment = buildNonCodeCompletionComment(baseConfig, agentResponse);
    
    // Should not include the instructional text
    assert.ok(!comment.includes('Here\'s text you can paste as the'));
    assert.ok(!comment.includes('task ticket comment'));
    assert.ok(!comment.includes('addresses your latest ask'));
    
    // Should include the actual content
    assert.ok(comment.includes('Done — publish + push'));
    assert.ok(comment.includes('I published **one English post** from the LinkedIn drafts'));
    assert.ok(comment.includes('qelos-plugins-microfrontends.md'));
  });
});

// ─── buildNonCodePrompt ──────────────────────────────────────────────────────

describe('buildNonCodePrompt', () => {
  const task = { id: '1', name: 'Research question', description: 'What is X?', status: 'open', url: 'http://example.com', tags: [] };

  it('includes task name and description', () => {
    const prompt = buildNonCodePrompt(task, '');
    assert.ok(prompt.includes('Research question'));
    assert.ok(prompt.includes('What is X?'));
  });

  it('includes conversation context when provided', () => {
    const prompt = buildNonCodePrompt(task, '\n\nConversation context:\nAlice: Please clarify');
    assert.ok(prompt.includes('Alice: Please clarify'));
  });

  it('instructs AI to focus on latest comment when comments exist', () => {
    const prompt = buildNonCodePrompt(task, '\n\nConversation context:\nAlice: Change the env file');
    assert.ok(prompt.includes('LATEST comment'));
    assert.ok(prompt.includes('Original description'));
    assert.ok(prompt.includes('CRITICAL'));
    assert.ok(prompt.includes('FOLLOW-UP request'));
    assert.ok(prompt.includes('DO NOT repeat what was already done'));
  });

  it('does not mention latest comment when no comments', () => {
    const prompt = buildNonCodePrompt(task, '');
    assert.ok(!prompt.includes('LATEST comment'));
    assert.ok(!prompt.includes('Original description'));
  });
});

// ─── sortTasksByPriority ─────────────────────────────────────────────────────

function makeTask(id: string, priority?: number): Task {
  return { id, name: `task-${id}`, description: '', status: 'open', url: '', tags: [], priority };
}

describe('sortTasksByPriority', () => {
  it('sorts tasks by priority ascending (urgent first)', () => {
    const tasks = [makeTask('a', 4), makeTask('b', 1), makeTask('c', 2)];
    const sorted = sortTasksByPriority(tasks);
    assert.deepEqual(sorted.map((t) => t.id), ['b', 'c', 'a']);
  });

  it('puts tasks without priority last', () => {
    const tasks = [makeTask('a'), makeTask('b', 2), makeTask('c', 1)];
    const sorted = sortTasksByPriority(tasks);
    assert.deepEqual(sorted.map((t) => t.id), ['c', 'b', 'a']);
  });

  it('preserves relative order among tasks with the same priority', () => {
    const tasks = [makeTask('a', 2), makeTask('b', 2), makeTask('c', 2)];
    const sorted = sortTasksByPriority(tasks);
    assert.deepEqual(sorted.map((t) => t.id), ['a', 'b', 'c']);
  });

  it('preserves relative order among tasks without priority', () => {
    const tasks = [makeTask('a'), makeTask('b'), makeTask('c')];
    const sorted = sortTasksByPriority(tasks);
    assert.deepEqual(sorted.map((t) => t.id), ['a', 'b', 'c']);
  });

  it('does not mutate the original array', () => {
    const tasks = [makeTask('a', 3), makeTask('b', 1)];
    const sorted = sortTasksByPriority(tasks);
    assert.equal(tasks[0].id, 'a');
    assert.equal(sorted[0].id, 'b');
  });

  it('handles empty array', () => {
    assert.deepEqual(sortTasksByPriority([]), []);
  });

  it('handles single task', () => {
    const sorted = sortTasksByPriority([makeTask('a', 1)]);
    assert.equal(sorted.length, 1);
    assert.equal(sorted[0].id, 'a');
  });
});

// ─── getRunSkipReason ─────────────────────────────────────────────────────────

describe('getRunSkipReason', () => {
  it('allows open tasks for the default all filter', () => {
    assert.equal(getRunSkipReason('open', 'all', 'pending'), null);
  });

  it('allows configured pending tasks for the default all filter', () => {
    assert.equal(getRunSkipReason('Pending Review', 'all', 'pending review'), null);
  });

  it('skips statuses that are neither open nor pending', () => {
    assert.equal(getRunSkipReason('failed', 'all', 'pending'), 'status "failed" is not open or pending');
  });

  it('skips pending tasks for the open filter', () => {
    assert.equal(getRunSkipReason('pending', 'open', 'pending'), 'filter=open but task is pending');
  });

  it('skips open tasks for the pending filter', () => {
    assert.equal(getRunSkipReason('open', 'pending', 'pending'), 'filter=pending but task is not pending');
  });
});

// ─── buildConflictResolutionPrompt ───────────────────────────────────────────

describe('buildConflictResolutionPrompt', () => {
  const task: Task = {
    id: 'abc123',
    name: 'Add user settings page',
    description: 'Create a settings page where users can update their profile.',
    status: 'pending',
    url: 'https://app.clickup.com/t/abc123',
    tags: ['myproject'],
  };

  it('includes the task name and description so the agent understands the task', () => {
    const prompt = buildConflictResolutionPrompt(task, ['src/app.ts'], '');
    assert.ok(prompt.includes('Add user settings page'));
    assert.ok(prompt.includes('Create a settings page'));
  });

  it('lists all conflicting files', () => {
    const files = ['src/app.ts', 'src/config.ts', 'package.json'];
    const prompt = buildConflictResolutionPrompt(task, files, '');
    for (const f of files) {
      assert.ok(prompt.includes(f));
    }
  });

  it('includes conversation context when provided', () => {
    const prompt = buildConflictResolutionPrompt(task, ['src/app.ts'], '\n\nConversation context:\nAlice: Use tabs not spaces');
    assert.ok(prompt.includes('Alice: Use tabs not spaces'));
  });

  it('instructs to preserve the task intent', () => {
    const prompt = buildConflictResolutionPrompt(task, ['src/app.ts'], '');
    assert.ok(prompt.includes("task's intent") || prompt.includes("task's changes"));
  });

  it('instructs to remove conflict markers', () => {
    const prompt = buildConflictResolutionPrompt(task, ['src/app.ts'], '');
    assert.ok(prompt.includes('<<<<<<'));
    assert.ok(prompt.includes('>>>>>>>'));
  });

  it('handles missing description gracefully', () => {
    const prompt = buildConflictResolutionPrompt({ ...task, description: '' }, ['a.ts'], '');
    assert.ok(prompt.includes('no description provided'));
  });
});

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildPRUrl, buildPRBody, buildCompletionComment, buildNonCodeCompletionComment, buildNonCodePrompt, buildImplementPrompt, buildConflictResolutionPrompt, hasHumanReply, hasTriggerWord, hasAidevComment, filterAutomatedComments, DEFAULT_TRIGGER_WORD, checkNeedsClarification, sortTasksByPriority, getRunSkipReason, buildReviewPrompt, buildReviewCompletionComment, parseReplyDirectives } from '../commands/run';
import { filterUnresolvedByNonAidev, ReviewThread } from '../github';
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

  it('returns true when human comment quotes the aidev prefix mid-text', () => {
    const comments = [
      makeComment('[aidev] Starting implementation'),
      makeComment('Re: [aidev] please retry — the change you proposed is wrong'),
    ];
    assert.equal(hasHumanReply(comments), true);
  });

  it('treats aidev comments as such even with leading whitespace', () => {
    const comments = [
      makeComment('Initial human request'),
      makeComment('   [aidev] Implementation complete!'),
    ];
    assert.equal(hasHumanReply(comments), false);
  });

  it('returns true when a human commented after aidev even if a later comment is again from aidev', () => {
    const comments = [
      makeComment('[aidev] Implementation complete!'),
      makeComment('Please address review feedback'),
      makeComment('[aidev] Merge conflicts resolved automatically.'),
    ];
    assert.equal(hasHumanReply(comments), true);
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

  it('does not treat human comments quoting the prefix as aidev comments', () => {
    const comments = [
      makeComment('Earlier you said: "[aidev] foo" — that was wrong'),
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

  it('keeps human comments that quote the aidev prefix', () => {
    const quotingHuman = makeComment('You said "[aidev] xyz" — please redo it');
    const automated = makeComment('[aidev] Starting implementation');
    const result = filterAutomatedComments([quotingHuman, automated]);
    assert.deepEqual(result, [quotingHuman]);
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

// ─── buildReviewPrompt ──────────────────────────────────────────────────────

describe('buildReviewPrompt', () => {
  const reviewTask: Task = {
    id: 'rev1',
    name: 'Add caching layer',
    description: 'Add Redis caching to the API endpoints.',
    status: 'review',
    url: 'https://app.clickup.com/t/rev1',
    tags: ['myproject'],
  };

  const sampleThreads: ReviewThread[] = [
    {
      id: 'thread_1',
      path: 'src/cache.ts',
      line: 42,
      comments: [
        { author: 'alice', body: 'This TTL should be configurable' },
        { author: 'bob', body: 'Agreed, hardcoded values are fragile' },
      ],
    },
    {
      id: 'thread_2',
      path: 'src/api.ts',
      line: 10,
      comments: [
        { author: 'alice', body: 'Missing error handling for cache miss' },
      ],
    },
  ];

  it('includes task name and description', () => {
    const prompt = buildReviewPrompt(reviewTask, sampleThreads);
    assert.ok(prompt.includes('Add caching layer'));
    assert.ok(prompt.includes('Add Redis caching to the API endpoints.'));
  });

  it('includes all thread file paths and line numbers', () => {
    const prompt = buildReviewPrompt(reviewTask, sampleThreads);
    assert.ok(prompt.includes('`src/cache.ts` (line 42)'));
    assert.ok(prompt.includes('`src/api.ts` (line 10)'));
  });

  it('includes all comment bodies', () => {
    const prompt = buildReviewPrompt(reviewTask, sampleThreads);
    assert.ok(prompt.includes('This TTL should be configurable'));
    assert.ok(prompt.includes('Agreed, hardcoded values are fragile'));
    assert.ok(prompt.includes('Missing error handling for cache miss'));
  });

  it('includes comment authors', () => {
    const prompt = buildReviewPrompt(reviewTask, sampleThreads);
    assert.ok(prompt.includes('**alice**'));
    assert.ok(prompt.includes('**bob**'));
  });

  it('includes thread IDs', () => {
    const prompt = buildReviewPrompt(reviewTask, sampleThreads);
    assert.ok(prompt.includes('Thread thread_1'));
    assert.ok(prompt.includes('Thread thread_2'));
  });

  it('handles threads with no line number', () => {
    const threads: ReviewThread[] = [
      {
        id: 'thread_no_line',
        path: 'README.md',
        line: null,
        comments: [{ author: 'alice', body: 'Update the docs' }],
      },
    ];
    const prompt = buildReviewPrompt(reviewTask, threads);
    assert.ok(prompt.includes('`README.md`'));
    assert.ok(!prompt.includes('(line'));
  });

  it('handles empty threads array', () => {
    const prompt = buildReviewPrompt(reviewTask, []);
    assert.ok(prompt.includes('Add caching layer'));
    // Should still produce a valid prompt, just with no thread sections
    assert.ok(!prompt.includes('Thread '));
  });

  it('handles missing description gracefully', () => {
    const prompt = buildReviewPrompt({ ...reviewTask, description: '' }, sampleThreads);
    assert.ok(prompt.includes('no description provided'));
  });

  it('includes AIDEV-REPLY instruction', () => {
    const prompt = buildReviewPrompt(reviewTask, sampleThreads);
    assert.ok(prompt.includes('AIDEV-REPLY'));
  });
});

// ─── buildReviewCompletionComment ───────────────────────────────────────────

describe('buildReviewCompletionComment', () => {
  it('includes resolved count', () => {
    const comment = buildReviewCompletionComment(baseConfig, 3, 0);
    assert.ok(comment.includes('Resolved 3 thread(s)'));
  });

  it('includes replied count', () => {
    const comment = buildReviewCompletionComment(baseConfig, 0, 2);
    assert.ok(comment.includes('Replied to 2 thread(s)'));
  });

  it('includes both resolved and replied counts', () => {
    const comment = buildReviewCompletionComment(baseConfig, 2, 1);
    assert.ok(comment.includes('Resolved 2 thread(s)'));
    assert.ok(comment.includes('Replied to 1 thread(s)'));
  });

  it('uses correct commentPrefix', () => {
    const comment = buildReviewCompletionComment(baseConfig, 1, 0);
    assert.ok(comment.startsWith('[aidev]'));
  });

  it('uses custom commentPrefix', () => {
    const customConfig = { ...baseConfig, commentPrefix: '[mybot]' } as Config;
    const comment = buildReviewCompletionComment(customConfig, 1, 1);
    assert.ok(comment.startsWith('[mybot]'));
    assert.ok(!comment.includes('[aidev]'));
  });

  it('mentions code review in the message', () => {
    const comment = buildReviewCompletionComment(baseConfig, 1, 0);
    assert.ok(comment.includes('Code review comments addressed'));
  });

  it('omits resolved line when count is zero', () => {
    const comment = buildReviewCompletionComment(baseConfig, 0, 2);
    assert.ok(!comment.includes('Resolved'));
  });

  it('omits replied line when count is zero', () => {
    const comment = buildReviewCompletionComment(baseConfig, 3, 0);
    assert.ok(!comment.includes('Replied'));
  });
});

// ─── parseReplyDirectives ───────────────────────────────────────────────────

describe('parseReplyDirectives', () => {
  it('extracts a single AIDEV-REPLY block', () => {
    const output = 'Some text\n<!-- AIDEV-REPLY thread_abc -->This is my reply<!-- /AIDEV-REPLY -->\nMore text';
    const replies = parseReplyDirectives(output);
    assert.equal(replies.length, 1);
    assert.equal(replies[0].threadId, 'thread_abc');
    assert.equal(replies[0].body, 'This is my reply');
  });

  it('extracts multiple AIDEV-REPLY blocks', () => {
    const output = `<!-- AIDEV-REPLY id1 -->Reply one<!-- /AIDEV-REPLY -->
Some middle text
<!-- AIDEV-REPLY id2 -->Reply two<!-- /AIDEV-REPLY -->`;
    const replies = parseReplyDirectives(output);
    assert.equal(replies.length, 2);
    assert.equal(replies[0].threadId, 'id1');
    assert.equal(replies[0].body, 'Reply one');
    assert.equal(replies[1].threadId, 'id2');
    assert.equal(replies[1].body, 'Reply two');
  });

  it('returns empty array when no AIDEV-REPLY blocks present', () => {
    const output = 'Just regular agent output with no reply directives';
    const replies = parseReplyDirectives(output);
    assert.equal(replies.length, 0);
  });

  it('trims whitespace from reply body', () => {
    const output = '<!-- AIDEV-REPLY thread_x -->\n  This has whitespace  \n<!-- /AIDEV-REPLY -->';
    const replies = parseReplyDirectives(output);
    assert.equal(replies.length, 1);
    assert.equal(replies[0].body, 'This has whitespace');
  });

  it('handles multiline reply bodies', () => {
    const output = '<!-- AIDEV-REPLY thread_y -->Line one\nLine two\nLine three<!-- /AIDEV-REPLY -->';
    const replies = parseReplyDirectives(output);
    assert.equal(replies.length, 1);
    assert.ok(replies[0].body.includes('Line one'));
    assert.ok(replies[0].body.includes('Line three'));
  });

  it('handles thread IDs with base64 characters', () => {
    const output = '<!-- AIDEV-REPLY abc+/def= -->Reply<!-- /AIDEV-REPLY -->';
    const replies = parseReplyDirectives(output);
    assert.equal(replies.length, 1);
    assert.equal(replies[0].threadId, 'abc+/def=');
  });
});

// ─── filterUnresolvedByNonAidev ─────────────────────────────────────────────

describe('filterUnresolvedByNonAidev', () => {
  function makeThread(id: string, comments: Array<{ author: string; body: string }>): ReviewThread {
    return { id, path: 'src/file.ts', line: 1, comments };
  }

  it('includes thread where last comment is from a human', () => {
    const threads = [
      makeThread('t1', [
        { author: 'alice', body: 'Fix this bug' },
      ]),
    ];
    const result = filterUnresolvedByNonAidev(threads, '[aidev]');
    assert.equal(result.length, 1);
    assert.equal(result[0].id, 't1');
  });

  it('filters out thread where last comment is from aidev', () => {
    const threads = [
      makeThread('t1', [
        { author: 'alice', body: 'Fix this bug' },
        { author: 'bot', body: '[aidev] I have addressed this issue' },
      ]),
    ];
    const result = filterUnresolvedByNonAidev(threads, '[aidev]');
    assert.equal(result.length, 0);
  });

  it('handles mixed threads — keeps human-last, filters aidev-last', () => {
    const threads = [
      makeThread('t1', [
        { author: 'alice', body: 'Please refactor this' },
      ]),
      makeThread('t2', [
        { author: 'alice', body: 'Fix the typo' },
        { author: 'bot', body: '[aidev] Fixed the typo' },
      ]),
      makeThread('t3', [
        { author: 'bot', body: '[aidev] Done' },
        { author: 'bob', body: 'Actually, this is still wrong' },
      ]),
    ];
    const result = filterUnresolvedByNonAidev(threads, '[aidev]');
    assert.equal(result.length, 2);
    assert.deepEqual(result.map((t) => t.id), ['t1', 't3']);
  });

  it('includes thread with empty comments array', () => {
    const threads = [makeThread('t1', [])];
    const result = filterUnresolvedByNonAidev(threads, '[aidev]');
    assert.equal(result.length, 1);
  });

  it('works with custom comment prefix', () => {
    const threads = [
      makeThread('t1', [
        { author: 'bot', body: '[mybot] I fixed this' },
      ]),
      makeThread('t2', [
        { author: 'alice', body: 'Needs work' },
      ]),
    ];
    const result = filterUnresolvedByNonAidev(threads, '[mybot]');
    assert.equal(result.length, 1);
    assert.equal(result[0].id, 't2');
  });

  it('does not filter when aidev prefix appears mid-comment (not at start)', () => {
    const threads = [
      makeThread('t1', [
        { author: 'alice', body: 'The [aidev] tool did something wrong' },
      ]),
    ];
    const result = filterUnresolvedByNonAidev(threads, '[aidev]');
    assert.equal(result.length, 1);
  });
});

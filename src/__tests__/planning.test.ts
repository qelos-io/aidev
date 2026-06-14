import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  isPlanningTask,
  isThinkingTask,
  buildPlanningAnalysisPrompt,
  parsePlanningResponse,
  implementPlanningTask,
} from '../commands/run';
import type { Config, Task, Comment, CreateTaskParams, CreateTaskResult } from '../types';
import type { TaskProvider } from '../providers';
import type { AIRunner, AIRunResult } from '../ai/base';

// ─── helpers ──────────────────────────────────────────────────────────────────

function stubTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'TASK-1',
    name: 'Break down feature X',
    description: 'Plan sub-tickets for feature X.',
    status: 'open',
    url: 'https://example.test/t/TASK-1',
    tags: ['planning'],
    ...overrides,
  };
}

function stubConfig(overrides: Partial<Config> = {}): Config {
  return {
    provider: 'clickup',
    clickupApiKey: '',
    clickupTeamId: '',
    clickupTag: '',
    clickupPendingStatus: 'pending',
    clickupOpenStatus: 'open',
    clickupInReviewStatus: 'review',
    jiraBaseUrl: '',
    jiraEmail: '',
    jiraApiToken: '',
    jiraProject: '',
    jiraLabel: '',
    jiraPendingStatus: '',
    jiraInReviewStatus: '',
    linearApiKey: '',
    linearTeamId: '',
    linearLabel: '',
    linearPendingStatus: '',
    linearInReviewStatus: '',
    mondayApiToken: '',
    mondayBoardId: '',
    mondayStatusColumnId: '',
    mondayGroupId: '',
    notionApiKey: '',
    notionDatabaseId: '',
    notionStatusProperty: '',
    notionPendingStatus: '',
    notionInReviewStatus: '',
    trelloApiKey: '',
    trelloToken: '',
    trelloBoardId: '',
    trelloLabel: '',
    trelloOpenList: '',
    trelloPendingList: '',
    trelloInProgressList: '',
    trelloInReviewList: '',
    trelloOpenStatus: '',
    trelloPendingStatus: '',
    trelloInReviewStatus: '',
    nonCodeTag: '',
    nonCodeClickupTeamId: '',
    nonCodeJiraProject: '',
    nonCodeLinearTeamId: '',
    clickupListId: '',
    assigneeTag: '',
    gitRemote: 'origin',
    githubBaseBranch: 'main',
    githubRepo: '',
    agents: ['claude'],
    devNotesMode: 'smart',
    triggerWord: 'aidev-continue',
    thinkingTag: 'thinking',
    planningTag: 'planning',
    commentPrefix: '[aidev]',
    hooksPath: '',
    acceptedTag: '',
    doneStatus: '',
    autoCompress: false,
    compressThreshold: 0,
    ...overrides,
  };
}

interface RecordedCreate {
  params: CreateTaskParams;
}

interface RecordedSetBlockedBy {
  taskId: string;
  blockedByIds: string[];
}

interface MockProviderOptions {
  createTaskImpl?: (params: CreateTaskParams) => Promise<CreateTaskResult>;
  comments?: Comment[];
  availableStatuses?: string[];
  hasRemoveTag?: boolean;
  hasSetBlockedBy?: boolean;
  setBlockedByImpl?: (taskId: string, blockedByIds: string[]) => Promise<void>;
}

interface MockProvider extends TaskProvider {
  statusUpdates: string[];
  postedComments: string[];
  createdTasks: RecordedCreate[];
  removedTags: Array<{ taskId: string; tag: string }>;
  setBlockedByCalls: RecordedSetBlockedBy[];
}

function makeMockProvider(opts: MockProviderOptions = {}): MockProvider {
  const statusUpdates: string[] = [];
  const postedComments: string[] = [];
  const createdTasks: RecordedCreate[] = [];
  const removedTags: Array<{ taskId: string; tag: string }> = [];
  const setBlockedByCalls: RecordedSetBlockedBy[] = [];

  const provider: Partial<MockProvider> = {
    statusUpdates,
    postedComments,
    createdTasks,
    removedTags,
    setBlockedByCalls,
    fetchTasks: async () => [],
    fetchTasksByStatus: async () => [],
    getComments: async () => opts.comments ?? [],
    postComment: async (_taskId: string, text: string) => {
      postedComments.push(text);
    },
    updateStatus: async (_taskId: string, status: string) => {
      statusUpdates.push(status);
    },
    createTask: async (params: CreateTaskParams) => {
      if (opts.createTaskImpl) return opts.createTaskImpl(params);
      const id = `sub-${createdTasks.length + 1}`;
      createdTasks.push({ params });
      return { id, url: `https://example.test/t/${id}` };
    },
  };

  if (opts.availableStatuses) {
    provider.fetchAvailableStatuses = async () => opts.availableStatuses!;
  }
  if (opts.hasRemoveTag !== false) {
    provider.removeTag = async (taskId: string, tag: string) => {
      removedTags.push({ taskId, tag });
    };
  }
  if (opts.hasSetBlockedBy !== false) {
    provider.setBlockedBy = async (taskId: string, blockedByIds: string[]) => {
      if (opts.setBlockedByImpl) return opts.setBlockedByImpl(taskId, blockedByIds);
      setBlockedByCalls.push({ taskId, blockedByIds });
    };
  }

  // Wrap createTask to also record params even when impl is provided
  // (including when impl throws — we still want to know it was attempted).
  if (opts.createTaskImpl) {
    const impl = opts.createTaskImpl;
    provider.createTask = async (params: CreateTaskParams) => {
      createdTasks.push({ params });
      return impl(params);
    };
  }

  return provider as MockProvider;
}

function stubRunner(output: string, opts: { available?: boolean; success?: boolean } = {}): AIRunner {
  return {
    name: 'stub',
    isAvailable: () => opts.available ?? true,
    run: async (): Promise<AIRunResult> => ({
      success: opts.success ?? true,
      output,
      error: '',
    }),
  };
}

// ─── isPlanningTask ───────────────────────────────────────────────────────────

describe('isPlanningTask', () => {
  it('returns true when task has the configured planning tag', () => {
    const task = stubTask({ tags: ['planning', 'frontend'] });
    const config = stubConfig({ planningTag: 'planning' });
    assert.equal(isPlanningTask(task, config), true);
  });

  it('returns false when task does not have the planning tag', () => {
    const task = stubTask({ tags: ['frontend', 'urgent'] });
    const config = stubConfig({ planningTag: 'planning' });
    assert.equal(isPlanningTask(task, config), false);
  });

  it('is case-insensitive on the planning tag', () => {
    const task = stubTask({ tags: ['PLANNING'] });
    const config = stubConfig({ planningTag: 'planning' });
    assert.equal(isPlanningTask(task, config), true);
  });

  it('is case-insensitive on the configured tag value', () => {
    const task = stubTask({ tags: ['breakdown'] });
    const config = stubConfig({ planningTag: 'BREAKDOWN' });
    assert.equal(isPlanningTask(task, config), true);
  });

  it('returns false when planningTag is missing/empty in config', () => {
    const task = stubTask({ tags: ['planning'] });
    const config = stubConfig({ planningTag: '' });
    assert.equal(isPlanningTask(task, config), false);
  });

  it('returns false when task has no tags', () => {
    const task = stubTask({ tags: [] });
    const config = stubConfig({ planningTag: 'planning' });
    assert.equal(isPlanningTask(task, config), false);
  });
});

// ─── buildPlanningAnalysisPrompt ──────────────────────────────────────────────

describe('buildPlanningAnalysisPrompt', () => {
  it('includes the task name', () => {
    const task = stubTask({ name: 'Migrate auth to JWT' });
    const prompt = buildPlanningAnalysisPrompt(task, '');
    assert.ok(prompt.includes('Migrate auth to JWT'));
  });

  it('includes the task description', () => {
    const task = stubTask({ description: 'Replace session cookies with JWT tokens.' });
    const prompt = buildPlanningAnalysisPrompt(task, '');
    assert.ok(prompt.includes('Replace session cookies with JWT tokens.'));
  });

  it('falls back to a placeholder when description is empty', () => {
    const task = stubTask({ description: '' });
    const prompt = buildPlanningAnalysisPrompt(task, '');
    assert.ok(prompt.includes('no description provided'));
  });

  it('includes the parent task tags', () => {
    const task = stubTask({ tags: ['planning', 'frontend', 'urgent'] });
    const prompt = buildPlanningAnalysisPrompt(task, '');
    assert.ok(prompt.includes('Parent task tags:'));
    assert.ok(prompt.includes('planning'));
    assert.ok(prompt.includes('frontend'));
    assert.ok(prompt.includes('urgent'));
  });

  it('omits the tags line when the task has no tags', () => {
    const task = stubTask({ tags: [] });
    const prompt = buildPlanningAnalysisPrompt(task, '');
    assert.ok(!prompt.includes('Parent task tags:'));
  });

  it('includes the conversation context when provided', () => {
    const task = stubTask();
    const prompt = buildPlanningAnalysisPrompt(task, '\n\nConversation context:\nuser: do it carefully');
    assert.ok(prompt.includes('do it carefully'));
  });

  it('instructs the AI that sub-tasks must be self-contained', () => {
    const prompt = buildPlanningAnalysisPrompt(stubTask(), '');
    assert.ok(/self-contained|isolated/i.test(prompt));
  });

  it('describes the JSON response schema', () => {
    const prompt = buildPlanningAnalysisPrompt(stubTask(), '');
    assert.ok(prompt.includes('"clarification"'));
    assert.ok(prompt.includes('"subtasks"'));
  });
});

// ─── parsePlanningResponse ────────────────────────────────────────────────────

describe('parsePlanningResponse', () => {
  it('parses a well-formed list of sub-tasks', () => {
    const output = JSON.stringify({
      clarification: null,
      subtasks: [
        { title: 'Add login form', description: 'Build the login UI in src/login.tsx.', priority: 2 },
        { title: 'Add server route', description: 'Add POST /auth/login in server/auth.ts.' },
      ],
    });
    const parsed = parsePlanningResponse(output);
    assert.ok(parsed !== null);
    assert.equal(parsed!.clarification, undefined);
    assert.equal(parsed!.subtasks.length, 2);
    assert.equal(parsed!.subtasks[0].title, 'Add login form');
    assert.equal(parsed!.subtasks[0].priority, 2);
    assert.equal(parsed!.subtasks[1].priority, undefined);
  });

  it('returns a clarification when the AI asks one', () => {
    const output = JSON.stringify({
      clarification: 'Which auth provider should be used?',
      subtasks: [],
    });
    const parsed = parsePlanningResponse(output);
    assert.ok(parsed !== null);
    assert.equal(parsed!.clarification, 'Which auth provider should be used?');
    assert.equal(parsed!.subtasks.length, 0);
  });

  it('returns null on malformed JSON', () => {
    assert.equal(parsePlanningResponse('this is not json at all'), null);
    assert.equal(parsePlanningResponse('{ unterminated'), null);
  });

  it('returns null on empty sub-tasks with no clarification', () => {
    const output = JSON.stringify({ clarification: null, subtasks: [] });
    assert.equal(parsePlanningResponse(output), null);
  });

  it('returns null when "null" string is given as clarification and subtasks are empty', () => {
    const output = JSON.stringify({ clarification: 'null', subtasks: [] });
    assert.equal(parsePlanningResponse(output), null);
  });

  it('skips sub-tasks missing a title or description', () => {
    const output = JSON.stringify({
      clarification: null,
      subtasks: [
        { title: 'Valid', description: 'Has a body.' },
        { title: '', description: 'No title' },
        { title: 'No description', description: '' },
        { description: 'Title missing entirely' },
      ],
    });
    const parsed = parsePlanningResponse(output);
    assert.ok(parsed !== null);
    assert.equal(parsed!.subtasks.length, 1);
    assert.equal(parsed!.subtasks[0].title, 'Valid');
  });

  it('extracts JSON from output that has surrounding text', () => {
    const output = `Here is the plan:\n${JSON.stringify({
      clarification: null,
      subtasks: [{ title: 'A', description: 'B' }],
    })}\nLet me know!`;
    const parsed = parsePlanningResponse(output);
    assert.ok(parsed !== null);
    assert.equal(parsed!.subtasks.length, 1);
  });
});

// ─── implementPlanningTask: happy path ────────────────────────────────────────

describe('implementPlanningTask — happy path', () => {
  it('creates tasks, strips planning tag, threads listId, removes tag, transitions to done', async () => {
    const task = stubTask({
      id: 'T-100',
      tags: ['Planning', 'Frontend', 'urgent'],
      sourceListId: 'LIST-42',
    });
    const config = stubConfig({ planningTag: 'planning', doneStatus: 'closed' });
    const provider = makeMockProvider();
    const runner = stubRunner(JSON.stringify({
      clarification: null,
      subtasks: [
        { title: 'Sub A', description: 'Implement A in src/a.ts.', priority: 2 },
        { title: 'Sub B', description: 'Implement B in src/b.ts.' },
      ],
    }));

    await implementPlanningTask(task, config, provider, [runner]);

    assert.equal(provider.createdTasks.length, 2);

    // planning tag stripped (case-insensitive), other tags preserved with original casing.
    for (const rec of provider.createdTasks) {
      assert.ok(!rec.params.tags.some((t) => t.toLowerCase() === 'planning'));
      assert.deepEqual(rec.params.tags, ['Frontend', 'urgent']);
      assert.equal(rec.params.listId, 'LIST-42');
    }

    assert.equal(provider.createdTasks[0].params.title, 'Sub A');
    assert.equal(provider.createdTasks[0].params.priority, 2);
    assert.equal(provider.createdTasks[1].params.priority, undefined);

    // parent planning tag removed.
    assert.equal(provider.removedTags.length, 1);
    assert.equal(provider.removedTags[0].taskId, 'T-100');
    assert.equal(provider.removedTags[0].tag, 'planning');

    // status transitions: first "in progress", last "closed" (done).
    assert.equal(provider.statusUpdates[0], 'in progress');
    assert.equal(provider.statusUpdates[provider.statusUpdates.length - 1], 'closed');

    // a summary comment listing both tickets was posted.
    const summary = provider.postedComments.find((c) => c.includes('Planning complete'));
    assert.ok(summary, 'expected planning summary comment');
    assert.ok(summary!.includes('Sub A'));
    assert.ok(summary!.includes('Sub B'));
  });

  it('auto-detects done status via fetchAvailableStatuses when doneStatus is empty', async () => {
    const task = stubTask({ sourceListId: 'L1' });
    const config = stubConfig({ planningTag: 'planning', doneStatus: '' });
    const provider = makeMockProvider({ availableStatuses: ['open', 'in progress', 'Done'] });
    const runner = stubRunner(JSON.stringify({
      clarification: null,
      subtasks: [{ title: 'X', description: 'Y' }],
    }));

    await implementPlanningTask(task, config, provider, [runner]);

    assert.equal(provider.statusUpdates[provider.statusUpdates.length - 1], 'Done');
  });

  it('omits removeTag silently when the provider does not implement it', async () => {
    const task = stubTask({ sourceListId: 'L1' });
    const config = stubConfig({ planningTag: 'planning', doneStatus: 'closed' });
    const provider = makeMockProvider({ hasRemoveTag: false });
    const runner = stubRunner(JSON.stringify({
      clarification: null,
      subtasks: [{ title: 'X', description: 'Y' }],
    }));

    await implementPlanningTask(task, config, provider, [runner]);

    assert.equal(provider.removedTags.length, 0);
    assert.equal(provider.statusUpdates[provider.statusUpdates.length - 1], 'closed');
  });

  it('passes undefined listId when task.sourceListId is unset', async () => {
    const task = stubTask({ sourceListId: undefined });
    const config = stubConfig({ planningTag: 'planning', doneStatus: 'closed' });
    const provider = makeMockProvider();
    const runner = stubRunner(JSON.stringify({
      clarification: null,
      subtasks: [{ title: 'X', description: 'Y' }],
    }));

    await implementPlanningTask(task, config, provider, [runner]);

    assert.equal(provider.createdTasks.length, 1);
    assert.equal(provider.createdTasks[0].params.listId, undefined);
  });
});

// ─── implementPlanningTask: clarification path ────────────────────────────────

describe('implementPlanningTask — clarification path', () => {
  it('posts the clarification, moves to pending, does not create sub-tasks', async () => {
    const task = stubTask();
    const config = stubConfig({ planningTag: 'planning', clickupPendingStatus: 'pending' });
    const provider = makeMockProvider();
    const runner = stubRunner(JSON.stringify({
      clarification: 'Which database driver should be used?',
      subtasks: [],
    }));

    await implementPlanningTask(task, config, provider, [runner]);

    assert.equal(provider.createdTasks.length, 0);
    assert.equal(provider.removedTags.length, 0);

    // status order: in progress, then pending. No transition to done.
    assert.deepEqual(provider.statusUpdates, ['in progress', 'pending']);

    const clarification = provider.postedComments.find((c) =>
      c.includes('Which database driver should be used?')
    );
    assert.ok(clarification, 'expected clarification comment');
    assert.ok(clarification!.startsWith('[aidev]'));
  });
});

// ─── implementPlanningTask: per-subtask failure path ──────────────────────────

describe('implementPlanningTask — per-subtask failure', () => {
  it('continues after a createTask failure and still transitions parent to done', async () => {
    const task = stubTask({ sourceListId: 'L1' });
    const config = stubConfig({ planningTag: 'planning', doneStatus: 'closed' });

    let calls = 0;
    const provider = makeMockProvider({
      createTaskImpl: async (_params) => {
        calls++;
        if (calls === 2) throw new Error('boom — provider rejected ticket');
        return { id: `s-${calls}`, url: `https://example.test/t/s-${calls}` };
      },
    });

    const runner = stubRunner(JSON.stringify({
      clarification: null,
      subtasks: [
        { title: 'First', description: 'do first' },
        { title: 'Second', description: 'do second' },
        { title: 'Third', description: 'do third' },
      ],
    }));

    await implementPlanningTask(task, config, provider, [runner]);

    // All three drafts attempted.
    assert.equal(provider.createdTasks.length, 3);

    // Parent still transitions to done despite mid-loop failure.
    assert.equal(provider.statusUpdates[provider.statusUpdates.length - 1], 'closed');

    // Planning tag removed.
    assert.equal(provider.removedTags.length, 1);

    // Summary mentions the failure.
    const summary = provider.postedComments.find((c) => c.includes('Planning complete'));
    assert.ok(summary, 'expected planning summary comment');
    assert.ok(summary!.includes('Second'), 'failed sub-task should be listed in summary');
    assert.ok(summary!.includes('boom'), 'failure reason should be surfaced');
    assert.ok(/Failed to create/.test(summary!));
  });
});

// ─── routing precedence ──────────────────────────────────────────────────────

describe('routing precedence', () => {
  it('a task tagged with both planning and thinking routes to planning', () => {
    const task = stubTask({ tags: ['planning', 'thinking'] });
    const config = stubConfig({ planningTag: 'planning', thinkingTag: 'thinking' });

    assert.equal(isPlanningTask(task, config), true);
    assert.equal(isThinkingTask(task, config), true);

    // Mirrors processTask / processNonCodeTask:
    //   if (isPlanningTask) implementPlanningTask
    //   else if (isThinkingTask) implementThinkingTask
    //   else implementTask
    const route = isPlanningTask(task, config)
      ? 'planning'
      : isThinkingTask(task, config)
        ? 'thinking'
        : 'normal';
    assert.equal(route, 'planning');
  });

  it('a thinking-only task routes to thinking', () => {
    const task = stubTask({ tags: ['thinking'] });
    const config = stubConfig({ planningTag: 'planning', thinkingTag: 'thinking' });

    assert.equal(isPlanningTask(task, config), false);
    assert.equal(isThinkingTask(task, config), true);
  });
});

// ─── parsePlanningResponse: blockedBy ─────────────────────────────────────────

describe('parsePlanningResponse — blockedBy', () => {
  it('parses valid blockedBy indices', () => {
    const output = JSON.stringify({
      clarification: null,
      subtasks: [
        { title: 'A', description: 'First task.' },
        { title: 'B', description: 'Second task.', blockedBy: [0] },
        { title: 'C', description: 'Third task.', blockedBy: [0, 1] },
      ],
    });
    const parsed = parsePlanningResponse(output);
    assert.ok(parsed !== null);
    assert.equal(parsed!.subtasks[0].blockedBy, undefined);
    assert.deepEqual(parsed!.subtasks[1].blockedBy, [0]);
    assert.deepEqual(parsed!.subtasks[2].blockedBy, [0, 1]);
  });

  it('strips out-of-range indices without rejecting the subtask', () => {
    const output = JSON.stringify({
      clarification: null,
      subtasks: [
        { title: 'A', description: 'First.' },
        { title: 'B', description: 'Second.', blockedBy: [0, 5, 99] },
      ],
    });
    const parsed = parsePlanningResponse(output);
    assert.ok(parsed !== null);
    assert.equal(parsed!.subtasks.length, 2);
    assert.deepEqual(parsed!.subtasks[1].blockedBy, [0]);
  });

  it('strips self-referential indices without rejecting the subtask', () => {
    const output = JSON.stringify({
      clarification: null,
      subtasks: [
        { title: 'A', description: 'First.' },
        { title: 'B', description: 'Second.', blockedBy: [1] },
      ],
    });
    const parsed = parsePlanningResponse(output);
    assert.ok(parsed !== null);
    assert.equal(parsed!.subtasks.length, 2);
    assert.equal(parsed!.subtasks[1].blockedBy, undefined);
  });

  it('strips non-integer and negative values from blockedBy', () => {
    const output = JSON.stringify({
      clarification: null,
      subtasks: [
        { title: 'A', description: 'First.' },
        { title: 'B', description: 'Second.', blockedBy: [-1, 0.5, 'foo', 0] },
      ],
    });
    const parsed = parsePlanningResponse(output);
    assert.ok(parsed !== null);
    assert.deepEqual(parsed!.subtasks[1].blockedBy, [0]);
  });

  it('allows circular indices at parse time (AI responsibility to avoid)', () => {
    const output = JSON.stringify({
      clarification: null,
      subtasks: [
        { title: 'A', description: 'First.', blockedBy: [1] },
        { title: 'B', description: 'Second.', blockedBy: [0] },
      ],
    });
    const parsed = parsePlanningResponse(output);
    assert.ok(parsed !== null);
    assert.deepEqual(parsed!.subtasks[0].blockedBy, [1]);
    assert.deepEqual(parsed!.subtasks[1].blockedBy, [0]);
  });

  it('omits blockedBy entirely when cleaned list is empty', () => {
    const output = JSON.stringify({
      clarification: null,
      subtasks: [
        { title: 'A', description: 'First.', blockedBy: [] },
        { title: 'B', description: 'Second.', blockedBy: [99] },
      ],
    });
    const parsed = parsePlanningResponse(output);
    assert.ok(parsed !== null);
    assert.equal(parsed!.subtasks[0].blockedBy, undefined);
    assert.equal(parsed!.subtasks[1].blockedBy, undefined);
  });
});

// ─── implementPlanningTask: setBlockedBy ──────────────────────────────────────

describe('implementPlanningTask — setBlockedBy', () => {
  it('calls setBlockedBy with resolved task IDs after creation', async () => {
    const task = stubTask({ sourceListId: 'L1' });
    const config = stubConfig({ planningTag: 'planning', doneStatus: 'closed' });
    const provider = makeMockProvider();
    const runner = stubRunner(JSON.stringify({
      clarification: null,
      subtasks: [
        { title: 'A', description: 'First task.' },
        { title: 'B', description: 'Second task.', blockedBy: [0] },
        { title: 'C', description: 'Third task.', blockedBy: [0, 1] },
      ],
    }));

    await implementPlanningTask(task, config, provider, [runner]);

    assert.equal(provider.createdTasks.length, 3);
    assert.equal(provider.setBlockedByCalls.length, 2);

    // sub-2 is blocked by sub-1
    assert.equal(provider.setBlockedByCalls[0].taskId, 'sub-2');
    assert.deepEqual(provider.setBlockedByCalls[0].blockedByIds, ['sub-1']);

    // sub-3 is blocked by sub-1 and sub-2
    assert.equal(provider.setBlockedByCalls[1].taskId, 'sub-3');
    assert.deepEqual(provider.setBlockedByCalls[1].blockedByIds, ['sub-1', 'sub-2']);
  });

  it('skips setBlockedBy for tasks whose blocker failed to create', async () => {
    const task = stubTask({ sourceListId: 'L1' });
    const config = stubConfig({ planningTag: 'planning', doneStatus: 'closed' });

    let calls = 0;
    const provider = makeMockProvider({
      createTaskImpl: async (_params) => {
        calls++;
        if (calls === 1) throw new Error('create failed');
        return { id: `s-${calls}`, url: `https://example.test/t/s-${calls}` };
      },
    });

    const runner = stubRunner(JSON.stringify({
      clarification: null,
      subtasks: [
        { title: 'A', description: 'Fails to create.' },
        { title: 'B', description: 'Blocked by A.', blockedBy: [0] },
      ],
    }));

    await implementPlanningTask(task, config, provider, [runner]);

    // B is blocked by A but A failed — resolvedIds should be empty so setBlockedBy is not called
    assert.equal(provider.setBlockedByCalls.length, 0);
  });

  it('does not call setBlockedBy when provider does not implement it', async () => {
    const task = stubTask({ sourceListId: 'L1' });
    const config = stubConfig({ planningTag: 'planning', doneStatus: 'closed' });
    const provider = makeMockProvider({ hasSetBlockedBy: false });
    const runner = stubRunner(JSON.stringify({
      clarification: null,
      subtasks: [
        { title: 'A', description: 'First.' },
        { title: 'B', description: 'Second.', blockedBy: [0] },
      ],
    }));

    await implementPlanningTask(task, config, provider, [runner]);

    assert.equal(provider.setBlockedByCalls.length, 0);
    // everything else should still work normally
    assert.equal(provider.createdTasks.length, 2);
    assert.equal(provider.statusUpdates[provider.statusUpdates.length - 1], 'closed');
  });

  it('includes blocker failures in the summary comment', async () => {
    const task = stubTask({ sourceListId: 'L1' });
    const config = stubConfig({ planningTag: 'planning', doneStatus: 'closed' });
    const provider = makeMockProvider({
      setBlockedByImpl: async (_taskId, _ids) => {
        throw new Error('dependency API unavailable');
      },
    });
    const runner = stubRunner(JSON.stringify({
      clarification: null,
      subtasks: [
        { title: 'A', description: 'First.' },
        { title: 'B', description: 'Second.', blockedBy: [0] },
      ],
    }));

    await implementPlanningTask(task, config, provider, [runner]);

    const summary = provider.postedComments.find((c) => c.includes('Planning complete'));
    assert.ok(summary, 'expected planning summary comment');
    assert.ok(summary!.includes('Failed to set blockers'));
    assert.ok(summary!.includes('B'));
    assert.ok(summary!.includes('dependency API unavailable'));
  });
});

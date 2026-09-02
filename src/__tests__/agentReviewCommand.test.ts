import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  agentReviewCommand,
  buildAgentReviewCompletionComment,
  buildAgentReviewFailureComment,
  buildAgentReviewStartComment,
  type AgentReviewDeps,
} from '../commands/agentReview';
import type { Config, Task } from '../types';
import type { TaskProvider } from '../providers';
import type { AIRunner, AIRunResult } from '../ai/base';

function stubTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'TASK-1',
    name: 'Add feature',
    description: 'Implement the feature.',
    status: 'review',
    url: 'https://example.test/t/TASK-1',
    tags: ['agent review'],
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
    githubRepo: 'acme/widgets',
    agents: ['claude'],
    devNotesMode: 'smart',
    triggerWord: 'aidev-continue',
    thinkingTag: 'thinking',
    planningTag: 'planning',
    commentPrefix: '[aidev]',
    hooksPath: '',
    acceptedTag: '',
    autoApprove: false,
    doneStatus: '',
    autoCompress: false,
    compressThreshold: 0,
    agentReviewTag: 'agent review',
    autoReview: false,
    safeMode: false,
    ...overrides,
  };
}

interface MockProvider extends TaskProvider {
  postedComments: string[];
  removedTags: Array<{ taskId: string; tag: string }>;
}

function makeMockProvider(tasks: Task[], opts: { hasRemoveTag?: boolean } = {}): MockProvider {
  const postedComments: string[] = [];
  const removedTags: Array<{ taskId: string; tag: string }> = [];

  const provider: Partial<MockProvider> = {
    postedComments,
    removedTags,
    fetchTasks: async () => tasks,
    fetchTasksByStatus: async () => tasks,
    getComments: async () => [],
    postComment: async (_taskId: string, text: string) => {
      postedComments.push(text);
    },
    updateStatus: async () => {},
    createTask: async () => ({ id: 'x', url: 'https://example.test/t/x' }),
  };

  if (opts.hasRemoveTag !== false) {
    provider.removeTag = async (taskId: string, tag: string) => {
      removedTags.push({ taskId, tag });
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

function stubDeps(overrides: Partial<AgentReviewDeps> = {}): AgentReviewDeps {
  return {
    isGhInstalled: () => true,
    isGhAuthenticated: () => true,
    getPrNumberForBranch: () => 42,
    fetchPrDiff: () => ({ diff: 'diff --git a/foo.ts b/foo.ts\n', error: '' }),
    getPrHeadSha: () => 'abc123',
    postAgentPullRequestReview: () => ({ success: true, error: '', commentsPosted: 1 }),
    resolveSkillContent: () => null,
    ...overrides,
  };
}

describe('buildAgentReviewStartComment', () => {
  it('includes comment prefix and branch name', () => {
    const config = { commentPrefix: '[aidev]' } as Config;
    const text = buildAgentReviewStartComment(config, 'TASK-1/add-feature');
    assert.equal(
      text,
      '[aidev] Starting automated code review for pull request on branch `TASK-1/add-feature`.',
    );
  });
});

describe('buildAgentReviewCompletionComment', () => {
  const config = { commentPrefix: '[aidev]' } as Config;

  it('reports a clean review when commentCount is zero', () => {
    const text = buildAgentReviewCompletionComment(config, 'TASK-1/add-feature', 0);
    assert.ok(text.includes('no issues found'));
    assert.ok(text.includes('`TASK-1/add-feature`'));
  });

  it('reports inline comment count when issues were posted', () => {
    const text = buildAgentReviewCompletionComment(config, 'TASK-1/add-feature', 3);
    assert.ok(text.includes('posted 3 comment(s)'));
  });
});

describe('buildAgentReviewFailureComment', () => {
  const config = { commentPrefix: '[aidev]' } as Config;

  it('includes the reason inside a fenced code block', () => {
    const text = buildAgentReviewFailureComment(config, 'TASK-1/add-feature', 'gh api failed');
    assert.ok(text.includes('`TASK-1/add-feature`'));
    assert.ok(text.includes('```\ngh api failed\n```'));
  });
});

describe('agentReviewCommand', () => {
  it('removes the tag only after a successful gh review post', async () => {
    const task = stubTask();
    const provider = makeMockProvider([task]);
    const config = stubConfig();
    let ghCalled = false;

    const deps = stubDeps({
      postAgentPullRequestReview: (options) => {
        ghCalled = true;
        assert.equal(options.comments.length, 1);
        return { success: true, error: '', commentsPosted: 1 };
      },
    });

    const runners = [stubRunner(JSON.stringify([
      { path: 'src/foo.ts', line: 10, body: 'Use const here.' },
    ]))];

    await agentReviewCommand(config, provider, runners, true, deps);

    assert.equal(ghCalled, true);
    assert.deepEqual(provider.removedTags, [{ taskId: 'TASK-1', tag: 'agent review' }]);
    assert.ok(provider.postedComments.some((c) => c.includes('Starting automated code review')));
    assert.ok(provider.postedComments.some((c) => c.includes('posted 1 comment(s)')));
  });

  it('retains the tag when AI output cannot be parsed', async () => {
    const task = stubTask();
    const provider = makeMockProvider([task]);
    const config = stubConfig();
    let ghCalled = false;

    const deps = stubDeps({
      postAgentPullRequestReview: () => {
        ghCalled = true;
        return { success: true, error: '', commentsPosted: 0 };
      },
    });

    await agentReviewCommand(config, provider, [stubRunner('not valid json')], true, deps);

    assert.equal(ghCalled, false);
    assert.deepEqual(provider.removedTags, []);
    assert.ok(provider.postedComments.some((c) => c.includes('could not be parsed')));
  });

  it('treats an empty review array as success and posts APPROVE via gh', async () => {
    const task = stubTask();
    const provider = makeMockProvider([task]);
    const config = stubConfig();
    let postedComments: unknown;

    const deps = stubDeps({
      postAgentPullRequestReview: (options) => {
        postedComments = options.comments;
        return { success: true, error: '', commentsPosted: 0 };
      },
    });

    await agentReviewCommand(config, provider, [stubRunner('[]')], true, deps);

    assert.deepEqual(postedComments, []);
    assert.deepEqual(provider.removedTags, [{ taskId: 'TASK-1', tag: 'agent review' }]);
    assert.ok(provider.postedComments.some((c) => c.includes('no issues found')));
  });

  it('skips tasks without a PR and does not remove the tag', async () => {
    const task = stubTask();
    const provider = makeMockProvider([task]);
    const config = stubConfig();
    let ghCalled = false;

    const deps = stubDeps({
      getPrNumberForBranch: () => null,
      postAgentPullRequestReview: () => {
        ghCalled = true;
        return { success: true, error: '', commentsPosted: 0 };
      },
    });

    await agentReviewCommand(config, provider, [stubRunner('[]')], true, deps);

    assert.equal(ghCalled, false);
    assert.deepEqual(provider.removedTags, []);
    assert.equal(provider.postedComments.length, 0);
  });

  it('retains the tag when gh review posting fails', async () => {
    const task = stubTask();
    const provider = makeMockProvider([task]);
    const config = stubConfig();

    const deps = stubDeps({
      postAgentPullRequestReview: () => ({
        success: false,
        error: 'validation failed',
        commentsPosted: 0,
      }),
    });

    await agentReviewCommand(config, provider, [stubRunner('[]')], true, deps);

    assert.deepEqual(provider.removedTags, []);
    assert.ok(provider.postedComments.some((c) => c.includes('validation failed')));
  });
});

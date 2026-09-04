import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildThinkingAnalysisPrompt } from '../prompts/code';
import { buildNonCodeAnalysisPrompt } from '../prompts/nonCode';
import { buildThinkingEscalationContext } from '../prompts/shared';
import { canEscalateToThinkingMode, escalateTaskToThinkingMode } from '../commands/run';
import type { Config, Task } from '../types';
import type { TaskProvider } from '../providers/base';

function stubAnalysisTask(): Task {
  return {
    id: 'TASK-1',
    name: 'Fix bug',
    description: 'Fix the login bug',
    status: 'in progress',
    url: 'https://example.test/t/TASK-1',
    tags: ['myproject', 'thinking'],
  };
}

function stubTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'TASK-1',
    name: 'Fix bug',
    description: 'Fix the login bug',
    status: 'in progress',
    url: 'https://example.test/t/TASK-1',
    tags: ['myproject'],
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
    autoApprove: false,
    doneStatus: '',
    autoCompress: false,
    compressThreshold: 0,
    ...overrides,
  };
}

describe('buildThinkingEscalationContext', () => {
  it('includes failure diagnostics in the previous direct-run section', () => {
    const diagnostics = 'Runner claude failed: timeout after 300s';
    const context = buildThinkingEscalationContext(diagnostics, []);

    assert.match(context, /## Previous direct-run failure/);
    assert.match(context, /Runner claude failed: timeout after 300s/);
  });

  it('lists uncommitted files when paths are provided', () => {
    const context = buildThinkingEscalationContext('all runners failed', [
      'src/foo.ts',
      'src/bar.ts',
    ]);

    assert.match(context, /## Uncommitted working-tree changes/);
    assert.match(context, /partial work in your breakdown/);
    assert.match(context, /- src\/foo\.ts/);
    assert.match(context, /- src\/bar\.ts/);
  });

  it('omits the uncommitted files section when no paths are provided', () => {
    const context = buildThinkingEscalationContext('all runners failed', []);

    assert.match(context, /## Previous direct-run failure/);
    assert.doesNotMatch(context, /## Uncommitted working-tree changes/);
  });
});

describe('canEscalateToThinkingMode', () => {
  const config = stubConfig();
  const provider = {
    addTag: async () => {},
  } as TaskProvider;

  it('returns true when all eligibility conditions are met', () => {
    const task = stubTask();
    assert.equal(
      canEscalateToThinkingMode(task, config, provider, { hadExplicitRunnerFailure: true }),
      true,
    );
  });

  it('returns false when there was no explicit runner failure', () => {
    const task = stubTask();
    assert.equal(
      canEscalateToThinkingMode(task, config, provider, { hadExplicitRunnerFailure: false }),
      false,
    );
  });

  it('returns false for planning-tagged tasks', () => {
    const task = stubTask({ tags: ['myproject', 'planning'] });
    assert.equal(
      canEscalateToThinkingMode(task, config, provider, { hadExplicitRunnerFailure: true }),
      false,
    );
  });

  it('returns false for thinking-tagged tasks', () => {
    const task = stubTask({ tags: ['myproject', 'thinking'] });
    assert.equal(
      canEscalateToThinkingMode(task, config, provider, { hadExplicitRunnerFailure: true }),
      false,
    );
  });

  it('returns false when THINKING_TAG is unset', () => {
    const task = stubTask();
    const noThinkingConfig = stubConfig({ thinkingTag: '' });
    assert.equal(
      canEscalateToThinkingMode(task, noThinkingConfig, provider, { hadExplicitRunnerFailure: true }),
      false,
    );
  });

  it('returns false when provider lacks addTag', () => {
    const task = stubTask();
    const providerWithoutAddTag = {} as TaskProvider;
    assert.equal(
      canEscalateToThinkingMode(task, config, providerWithoutAddTag, { hadExplicitRunnerFailure: true }),
      false,
    );
  });
});

describe('escalateTaskToThinkingMode', () => {
  const config = stubConfig();
  const diagnostics = 'Runner claude failed: timeout after 300s';

  it('adds thinking tag, posts escalation comment, and returns context', async () => {
    const addedTags: string[] = [];
    const comments: string[] = [];
    const task = stubTask();
    const provider = {
      addTag: async (_taskId: string, tag: string) => { addedTags.push(tag); },
      postComment: async (_taskId: string, text: string) => { comments.push(text); },
    } as TaskProvider;

    const context = await escalateTaskToThinkingMode(task, provider, config, {}, undefined, diagnostics);

    assert.deepEqual(addedTags, ['thinking']);
    assert.ok(task.tags.includes('thinking'));
    assert.equal(comments.length, 1);
    assert.match(comments[0], /escalating to thinking mode for automatic breakdown and retry/);
    assert.match(comments[0], /Runner claude failed: timeout after 300s/);
    assert.match(context ?? '', /## Previous direct-run failure/);
    assert.match(context ?? '', /Runner claude failed: timeout after 300s/);
  });

  it('returns null when addTag fails', async () => {
    const task = stubTask();
    const provider = {
      addTag: async () => { throw new Error('provider error'); },
      postComment: async () => {},
    } as TaskProvider;

    const context = await escalateTaskToThinkingMode(task, provider, config, {}, undefined, diagnostics);

    assert.equal(context, null);
    assert.ok(!task.tags.includes('thinking'));
  });
});

describe('thinking analysis escalation context in prompts', () => {
  it('buildThinkingAnalysisPrompt includes escalation block and guidance when context has escalation', () => {
    const escalation = buildThinkingEscalationContext('Runner failed: timeout', ['src/foo.ts']);
    const context = `\n\nConversation context:\n\n${escalation}`;
    const prompt = buildThinkingAnalysisPrompt(stubAnalysisTask(), context);

    assert.match(prompt, /## Previous direct-run failure/);
    assert.match(prompt, /Runner failed: timeout/);
    assert.match(prompt, /src\/foo\.ts/);
    assert.match(prompt, /escalated to thinking mode/i);
    assert.match(prompt, /uncommitted working-tree changes/i);
  });

  it('buildNonCodeAnalysisPrompt includes escalation block and guidance when context has escalation', () => {
    const escalation = buildThinkingEscalationContext('Runner claude failed: timeout', ['notes/draft.md']);
    const context = `\n\nConversation context:\n\n${escalation}`;
    const prompt = buildNonCodeAnalysisPrompt(stubAnalysisTask(), context);

    assert.match(prompt, /## Previous direct-run failure/);
    assert.match(prompt, /Runner claude failed: timeout/);
    assert.match(prompt, /notes\/draft\.md/);
    assert.match(prompt, /escalated to thinking mode/i);
    assert.match(prompt, /uncommitted working-tree changes/i);
  });

  it('omits escalation guidance when context has no escalation block', () => {
    const context = '\n\nConversation context:\nAlice: Please prioritize this';
    const codePrompt = buildThinkingAnalysisPrompt(stubAnalysisTask(), context);
    const nonCodePrompt = buildNonCodeAnalysisPrompt(stubAnalysisTask(), context);

    assert.doesNotMatch(codePrompt, /escalated to thinking mode/i);
    assert.doesNotMatch(nonCodePrompt, /escalated to thinking mode/i);
  });
});

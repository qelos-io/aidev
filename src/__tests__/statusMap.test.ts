import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveStatus } from '../statusMap';
import { Config } from '../types';

function baseConfig(overrides: Partial<Config> = {}): Config {
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
    jiraPendingStatus: 'To Do',
    jiraInReviewStatus: 'In Review',
    linearApiKey: '',
    linearTeamId: '',
    linearLabel: '',
    linearPendingStatus: 'Pending',
    linearInReviewStatus: 'In Review',
    mondayApiToken: '',
    mondayBoardId: '',
    mondayStatusColumnId: '',
    mondayGroupId: '',
    mondayTagColumnId: '',
    notionApiKey: '',
    notionDatabaseId: '',
    notionStatusProperty: '',
    notionPendingStatus: 'pending',
    notionInReviewStatus: 'review',
    trelloApiKey: '',
    trelloToken: '',
    trelloBoardId: '',
    trelloLabel: '',
    trelloOpenList: '',
    trelloPendingList: '',
    trelloInProgressList: '',
    trelloInReviewList: '',
    trelloOpenStatus: 'open',
    trelloPendingStatus: 'pending',
    trelloInReviewStatus: 'review',
    nonCodeTag: '',
    nonCodeClickupTeamId: '',
    nonCodeJiraProject: '',
    nonCodeLinearTeamId: '',
    consultTag: '',
    consultedTag: '',
    projectName: '',
    clickupListId: '',
    assigneeTag: '',
    gitRemote: '',
    githubBaseBranch: '',
    githubRepo: '',
    agents: [],
    devNotesMode: 'smart',
    triggerWord: '',
    thinkingTag: '',
    planningTag: '',
    commentPrefix: '',
    hooksPath: '',
    acceptedTag: '',
    autoApprove: false,
    agentReviewTag: '',
    autoReview: false,
    doneStatus: '',
    autoCompress: false,
    compressThreshold: 0,
    logTtlDays: 0,
    doneStatuses: [],
    ...overrides,
  } as Config;
}

describe('resolveStatus', () => {
  it('resolves logical statuses for clickup provider', () => {
    const config = baseConfig({ provider: 'clickup' });
    assert.equal(resolveStatus(config, 'open'), 'open');
    assert.equal(resolveStatus(config, 'pending'), 'pending');
    assert.equal(resolveStatus(config, 'review'), 'review');
    assert.equal(resolveStatus(config, 'done'), 'done');
  });

  it('resolves logical statuses for clickup provider with custom raw values', () => {
    const config = baseConfig({
      provider: 'clickup',
      clickupOpenStatus: 'to do',
      clickupPendingStatus: 'backlog',
      clickupInReviewStatus: 'in review',
      doneStatus: 'complete',
    });
    assert.equal(resolveStatus(config, 'open'), 'to do');
    assert.equal(resolveStatus(config, 'pending'), 'backlog');
    assert.equal(resolveStatus(config, 'review'), 'in review');
    assert.equal(resolveStatus(config, 'done'), 'complete');
  });

  it('passes logical statuses through unchanged for the local provider', () => {
    const config = baseConfig({ provider: 'local' });
    assert.equal(resolveStatus(config, 'open'), 'open');
    assert.equal(resolveStatus(config, 'pending'), 'pending');
    assert.equal(resolveStatus(config, 'review'), 'review');
    assert.equal(resolveStatus(config, 'done'), 'done');
  });

  it('falls back to the literal "done" when doneStatus is empty', () => {
    const config = baseConfig({ provider: 'clickup', doneStatus: '' });
    assert.equal(resolveStatus(config, 'done'), 'done');
  });

  it('passes raw, non-logical status strings through unchanged', () => {
    const config = baseConfig({ provider: 'clickup' });
    assert.equal(resolveStatus(config, 'blocked'), 'blocked');
    assert.equal(resolveStatus(config, 'custom status'), 'custom status');
  });
});

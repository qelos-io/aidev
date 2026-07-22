import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyTaskTagToProviderConfig,
  buildConsultProviderConfig,
  buildNonCodeProviderConfig,
  taskMatchesTag,
} from '../providerViews';
import type { Config } from '../types';

const baseConfig = {
  clickupTag: 'qelos',
  clickupTeamId: 'team-main',
  jiraLabel: 'qelos',
  jiraProject: 'MAIN',
  linearLabel: 'qelos',
  linearTeamId: 'linear-main',
  trelloLabel: 'qelos',
  nonCodeTag: 'qelos-other',
  nonCodeClickupTeamId: 'team-ops',
  nonCodeJiraProject: 'OPS',
  nonCodeLinearTeamId: 'linear-ops',
  consultTag: 'isaac-consult',
  consultedTag: 'isaac-consulted',
} as Config;

describe('taskMatchesTag', () => {
  it('matches when tag is present case-insensitively', () => {
    assert.equal(taskMatchesTag(['Qelos', 'other'], 'qelos'), true);
  });

  it('returns true when filter tag is empty or wildcard', () => {
    assert.equal(taskMatchesTag([], ''), true);
    assert.equal(taskMatchesTag(['x'], '*'), true);
  });

  it('returns false when tag is missing', () => {
    assert.equal(taskMatchesTag(['qelos-other'], 'isaac-consult'), false);
  });
});

describe('applyTaskTagToProviderConfig', () => {
  it('sets tag fields across providers', () => {
    const next = applyTaskTagToProviderConfig(baseConfig, 'isaac-consult');
    assert.equal(next.clickupTag, 'isaac-consult');
    assert.equal(next.jiraLabel, 'isaac-consult');
    assert.equal(next.linearLabel, 'isaac-consult');
    assert.equal(next.trelloLabel, 'isaac-consult');
  });
});

describe('buildNonCodeProviderConfig', () => {
  it('applies non-code tag and destination overrides', () => {
    const next = buildNonCodeProviderConfig(baseConfig);
    assert.equal(next.clickupTag, 'qelos-other');
    assert.equal(next.clickupTeamId, 'team-ops');
    assert.equal(next.jiraProject, 'OPS');
    assert.equal(next.linearTeamId, 'linear-ops');
  });
});

describe('buildConsultProviderConfig', () => {
  it('applies consult tag without team/project overrides', () => {
    const next = buildConsultProviderConfig(baseConfig);
    assert.equal(next.clickupTag, 'isaac-consult');
    assert.equal(next.clickupTeamId, 'team-main');
    assert.equal(next.jiraProject, 'MAIN');
  });
});

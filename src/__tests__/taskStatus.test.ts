import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  getInProgressStatus,
  getOpenStatus,
  getPendingStatus,
  isActiveImplementationStatus,
} from '../taskStatus';
import { Config } from '../types';

function makeConfig(overrides: Partial<Config> = {}): Config {
  return {
    provider: 'clickup',
    clickupPendingStatus: 'waiting',
    clickupOpenStatus: 'to do',
    ...overrides,
  } as Config;
}

describe('taskStatus', () => {
  it('resolves provider-specific open and pending statuses', () => {
    const config = makeConfig();
    assert.equal(getOpenStatus(config), 'to do');
    assert.equal(getPendingStatus(config), 'waiting');
    assert.equal(getInProgressStatus(config), 'in progress');
  });

  it('treats only open, pending, and in progress as active implementation statuses', () => {
    const config = makeConfig();
    assert.equal(isActiveImplementationStatus('to do', config), true);
    assert.equal(isActiveImplementationStatus('waiting', config), true);
    assert.equal(isActiveImplementationStatus('in progress', config), true);
    assert.equal(isActiveImplementationStatus('review', config), false);
  });
});

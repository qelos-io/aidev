import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Config, Task } from '../types';
import { TaskProvider } from '../providers';
import { AIRunner } from '../ai/base';
import {
  checkImplementationStillActive,
  isActiveImplementationStatus,
  runRunnerWithStatusWatch,
} from '../statusWatch';

function makeConfig(overrides: Partial<Config> = {}): Config {
  return {
    provider: 'clickup',
    clickupPendingStatus: 'pending',
    clickupOpenStatus: 'open',
    clickupInReviewStatus: 'review',
    ...overrides,
  } as Config;
}

function makeTask(status: string): Task {
  return {
    id: 'task-1',
    name: 'Test task',
    description: 'desc',
    status,
    url: 'https://example.com/task-1',
    tags: [],
  };
}

function makeRunner(): AIRunner {
  return {
    name: 'mock-runner',
    isAvailable: () => true,
    run: async () => ({ success: true, output: 'done', error: '' }),
  };
}

describe('isActiveImplementationStatus', () => {
  const config = makeConfig();

  it('returns true for open, pending, and in progress', () => {
    assert.equal(isActiveImplementationStatus('open', config), true);
    assert.equal(isActiveImplementationStatus('pending', config), true);
    assert.equal(isActiveImplementationStatus('in progress', config), true);
  });

  it('returns false for review, closed, and failed', () => {
    assert.equal(isActiveImplementationStatus('review', config), false);
    assert.equal(isActiveImplementationStatus('closed', config), false);
    assert.equal(isActiveImplementationStatus('failed', config), false);
  });
});

describe('checkImplementationStillActive', () => {
  it('returns active when provider lacks fetchTaskById', async () => {
    const provider: TaskProvider = {
      fetchTasks: async () => [],
      fetchTasksByStatus: async () => [],
      postComment: async () => {},
      getComments: async () => [],
      updateStatus: async () => {},
      createTask: async () => ({ id: 'x', url: '' }),
    };

    const result = await checkImplementationStillActive(provider, 'task-1', makeConfig());
    assert.deepEqual(result, { active: true });
  });

  it('returns inactive when task is deleted', async () => {
    const provider: TaskProvider = {
      fetchTasks: async () => [],
      fetchTasksByStatus: async () => [],
      fetchTaskById: async () => null,
      postComment: async () => {},
      getComments: async () => [],
      updateStatus: async () => {},
      createTask: async () => ({ id: 'x', url: '' }),
    };

    const result = await checkImplementationStillActive(provider, 'task-1', makeConfig());
    assert.equal(result.active, false);
    if (!result.active) {
      assert.match(result.reason, /deleted or archived/);
    }
  });

  it('returns inactive when status is no longer active', async () => {
    const provider: TaskProvider = {
      fetchTasks: async () => [],
      fetchTasksByStatus: async () => [],
      fetchTaskById: async () => makeTask('review'),
      postComment: async () => {},
      getComments: async () => [],
      updateStatus: async () => {},
      createTask: async () => ({ id: 'x', url: '' }),
    };

    const result = await checkImplementationStillActive(provider, 'task-1', makeConfig());
    assert.equal(result.active, false);
    if (!result.active) {
      assert.match(result.reason, /review/);
    }
  });
});

describe('runRunnerWithStatusWatch', () => {
  it('passes through when provider cannot fetch task by id', async () => {
    const provider: TaskProvider = {
      fetchTasks: async () => [],
      fetchTasksByStatus: async () => [],
      postComment: async () => {},
      getComments: async () => [],
      updateStatus: async () => {},
      createTask: async () => ({ id: 'x', url: '' }),
    };

    const result = await runRunnerWithStatusWatch(
      makeRunner(),
      'prompt',
      undefined,
      provider,
      'task-1',
      makeConfig(),
    );

    assert.equal(result.success, true);
    assert.equal(result.stoppedByStatus, undefined);
  });
});

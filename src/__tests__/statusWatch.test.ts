import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Config, Task } from '../types';
import { TaskProvider } from '../providers';
import { AIRunner, AIRunOptions } from '../ai/base';
import {
  checkImplementationStillActive,
  isActiveImplementationStatus,
  resolveImplementationTag,
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

function makeTask(status: string, tags: string[] = []): Task {
  return {
    id: 'task-1',
    name: 'Test task',
    description: 'desc',
    status,
    url: 'https://example.com/task-1',
    tags,
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

  it('returns inactive when the code tag was removed', async () => {
    const provider: TaskProvider = {
      fetchTasks: async () => [],
      fetchTasksByStatus: async () => [],
      fetchTaskById: async () => makeTask('open', ['other-tag']),
      postComment: async () => {},
      getComments: async () => [],
      updateStatus: async () => {},
      createTask: async () => ({ id: 'x', url: '' }),
    };

    const result = await checkImplementationStillActive(
      provider,
      'task-1',
      makeConfig({ clickupTag: 'myproject' }),
    );
    assert.equal(result.active, false);
    if (!result.active) {
      assert.match(result.reason, /required tag "myproject" was removed/);
    }
  });

  it('returns inactive when the non-code tag was removed', async () => {
    const provider: TaskProvider = {
      fetchTasks: async () => [],
      fetchTasksByStatus: async () => [],
      fetchTaskById: async () => makeTask('open', ['myproject']),
      postComment: async () => {},
      getComments: async () => [],
      updateStatus: async () => {},
      createTask: async () => ({ id: 'x', url: '' }),
    };

    const result = await checkImplementationStillActive(
      provider,
      'task-1',
      makeConfig({ clickupTag: 'myproject', nonCodeTag: 'myproject-other' }),
      'non-code',
    );
    assert.equal(result.active, false);
    if (!result.active) {
      assert.match(result.reason, /required tag "myproject-other" was removed/);
    }
  });

  it('matches tags case-insensitively', async () => {
    const provider: TaskProvider = {
      fetchTasks: async () => [],
      fetchTasksByStatus: async () => [],
      fetchTaskById: async () => makeTask('open', ['MyProject']),
      postComment: async () => {},
      getComments: async () => [],
      updateStatus: async () => {},
      createTask: async () => ({ id: 'x', url: '' }),
    };

    const result = await checkImplementationStillActive(
      provider,
      'task-1',
      makeConfig({ clickupTag: 'myproject' }),
    );
    assert.deepEqual(result, { active: true });
  });
});

describe('resolveImplementationTag', () => {
  it('returns clickupTag for code tasks', () => {
    const config = makeConfig({ clickupTag: 'code-tag', nonCodeTag: 'nc-tag' });
    assert.equal(resolveImplementationTag(config, 'code'), 'code-tag');
  });

  it('returns nonCodeTag for non-code tasks', () => {
    const config = makeConfig({ clickupTag: 'code-tag', nonCodeTag: 'nc-tag' });
    assert.equal(resolveImplementationTag(config, 'non-code'), 'nc-tag');
  });

  it('falls back to clickupTag when nonCodeTag is empty', () => {
    const config = makeConfig({ clickupTag: 'code-tag', nonCodeTag: '' });
    assert.equal(resolveImplementationTag(config, 'non-code'), 'code-tag');
  });

  it('returns consultTag for consult tasks', () => {
    const config = makeConfig({ clickupTag: 'code-tag', consultTag: 'isaac-consult' });
    assert.equal(resolveImplementationTag(config, 'consult'), 'isaac-consult');
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

  it('forwards assetDirs to runner.run when provider cannot fetch task by id', async () => {
    const provider: TaskProvider = {
      fetchTasks: async () => [],
      fetchTasksByStatus: async () => [],
      postComment: async () => {},
      getComments: async () => [],
      updateStatus: async () => {},
      createTask: async () => ({ id: 'x', url: '' }),
    };

    const assetDirs = ['/tmp/.aidev/assets', '/tmp/.aidev/assets/task-1'];
    let receivedOptions: AIRunOptions | undefined;

    const runner: AIRunner = {
      name: 'mock-runner',
      isAvailable: () => true,
      run: async (_prompt, _notes, options) => {
        receivedOptions = options;
        return { success: true, output: 'done', error: '' };
      },
    };

    await runRunnerWithStatusWatch(
      runner,
      'prompt',
      undefined,
      provider,
      'task-1',
      makeConfig(),
      'code',
      { assetDirs },
    );

    assert.deepEqual(receivedOptions?.assetDirs, assetDirs);
    assert.equal(receivedOptions?.signal, undefined);
  });

  it('merges assetDirs with abort signal when status watch is active', async () => {
    const provider: TaskProvider = {
      fetchTasks: async () => [],
      fetchTasksByStatus: async () => [],
      fetchTaskById: async () => makeTask('open'),
      postComment: async () => {},
      getComments: async () => {},
      updateStatus: async () => {},
      createTask: async () => ({ id: 'x', url: '' }),
    };

    const assetDirs = ['/tmp/.aidev/assets/task-1'];
    let receivedOptions: AIRunOptions | undefined;

    const runner: AIRunner = {
      name: 'mock-runner',
      isAvailable: () => true,
      run: async (_prompt, _notes, options) => {
        receivedOptions = options;
        return { success: true, output: 'done', error: '' };
      },
    };

    await runRunnerWithStatusWatch(
      runner,
      'prompt',
      undefined,
      provider,
      'task-1',
      makeConfig(),
      'code',
      { assetDirs },
    );

    assert.deepEqual(receivedOptions?.assetDirs, assetDirs);
    assert.ok(receivedOptions?.signal instanceof AbortSignal);
  });
});

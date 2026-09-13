import { describe, it, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { logger } from '../logger';
import {
  readTasksFile,
  writeTasksFile,
  tasksFilePath,
  processLocalTasks,
} from '../tasks';
import {
  tasksPushCommand,
  tasksListCommand,
  tasksGetCommand,
  tasksDeleteCommand,
  tasksCommentCommand,
  tasksModifyCommand,
  tasksTagCommand,
  tasksUntagCommand,
} from '../commands/tasks';
import type {
  Config,
  LocalTask,
  CreateTaskParams,
  CreateTaskResult,
  Task,
} from '../types';
import type { TaskProvider } from '../providers';
import { LocalProvider } from '../providers/local';

// ─── Helpers ──────────────────────────────────────────────────────────────────

type StubProvider = TaskProvider & { calls: CreateTaskParams[] };

function stubProvider(opts: { fail?: boolean } = {}): StubProvider {
  const calls: CreateTaskParams[] = [];
  return {
    calls,
    fetchTasks: async () => [],
    fetchTasksByStatus: async () => [],
    postComment: async () => {},
    getComments: async () => [],
    updateStatus: async () => {},
    createTask: async (params: CreateTaskParams): Promise<CreateTaskResult> => {
      calls.push(params);
      if (opts.fail) throw new Error('createTask failed');
      return { id: `remote-${calls.length}`, url: `https://example.test/${calls.length}` };
    },
  };
}

function cfg(overrides: Partial<Config> = {}): Config {
  return {
    provider: 'clickup',
    clickupTag: 'code-tag',
    nonCodeTag: '',
    ...overrides,
  } as Config;
}

// ─── tasksFilePath ────────────────────────────────────────────────────────────

describe('tasksFilePath', () => {
  it('returns aidev.tasks.json inside the given directory', () => {
    const p = tasksFilePath(path.join(os.tmpdir(), 'proj'));
    assert.equal(path.basename(p), 'aidev.tasks.json');
    assert.equal(path.dirname(p), path.join(os.tmpdir(), 'proj'));
  });

  it('defaults to the current working directory', () => {
    assert.equal(tasksFilePath(), path.join(process.cwd(), 'aidev.tasks.json'));
  });
});

// ─── readTasksFile / writeTasksFile ───────────────────────────────────────────

describe('readTasksFile / writeTasksFile', () => {
  let tmpDir: string;
  let origCwd: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aidev-tasks-io-'));
    origCwd = process.cwd();
    process.chdir(tmpDir);
  });

  afterEach(() => {
    process.chdir(origCwd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns [] when no aidev.tasks.json exists', () => {
    assert.deepEqual(readTasksFile(), []);
  });

  it('returns [] when file contains invalid JSON', () => {
    fs.writeFileSync('aidev.tasks.json', 'not json at all', 'utf8');
    assert.deepEqual(readTasksFile(), []);
  });

  it('returns [] when file contains non-array JSON', () => {
    fs.writeFileSync('aidev.tasks.json', '{"not":"an array"}', 'utf8');
    assert.deepEqual(readTasksFile(), []);
  });

  it('round-trips an array of tasks', () => {
    const tasks: LocalTask[] = [
      { id: 'a', title: 'one', description: 'd1', type: 'code' },
      { id: 'b', title: 'two', description: 'd2', type: 'non-code', cron: '0 9 * * *' },
    ];
    writeTasksFile(tasks);
    assert.deepEqual(readTasksFile(), tasks);
  });

  it('writes pretty-printed JSON with a trailing newline', () => {
    const tasks: LocalTask[] = [
      { id: 'a', title: 'one', description: '', type: 'code' },
    ];
    writeTasksFile(tasks);
    const content = fs.readFileSync('aidev.tasks.json', 'utf8');
    assert.ok(content.startsWith('[\n'));
    assert.ok(content.endsWith('\n'));
    assert.ok(content.includes('  "id"'), 'should be indented');
  });

  it('honours an explicit directory argument', () => {
    const sub = fs.mkdtempSync(path.join(tmpDir, 'sub-'));
    const tasks: LocalTask[] = [
      { id: 'z', title: 'in sub', description: '', type: 'code' },
    ];
    writeTasksFile(tasks, sub);
    assert.deepEqual(readTasksFile(sub), tasks);
    // The file should not leak into cwd
    assert.equal(fs.existsSync(path.join(tmpDir, 'aidev.tasks.json')), false);
  });
});

// ─── processLocalTasks ────────────────────────────────────────────────────────

describe('processLocalTasks', () => {
  let tmpDir: string;
  let origCwd: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aidev-processtasks-'));
    origCwd = process.cwd();
    process.chdir(tmpDir);
    // Keep test output quiet — logger writes to console + file.
    mock.method(logger, 'info', () => {});
    mock.method(logger, 'success', () => {});
    mock.method(logger, 'warn', () => {});
    mock.method(logger, 'error', () => {});
  });

  afterEach(() => {
    process.chdir(origCwd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
    mock.restoreAll();
  });

  it('returns zero counts and does not create the file when no tasks are queued', async () => {
    const provider = stubProvider();
    const result = await processLocalTasks(cfg(), provider);
    assert.deepEqual(result, { pushed: 0, skipped: 0 });
    assert.equal(provider.calls.length, 0);
    assert.equal(fs.existsSync('aidev.tasks.json'), false);
  });

  it('pushes a one-shot task and removes it from the file', async () => {
    const task: LocalTask = {
      id: 'abc',
      title: 'Refactor auth',
      description: 'Split middleware',
      type: 'code',
    };
    writeTasksFile([task]);
    const provider = stubProvider();

    const result = await processLocalTasks(cfg(), provider);

    assert.deepEqual(result, { pushed: 1, skipped: 0 });
    assert.equal(provider.calls.length, 1);
    assert.equal(provider.calls[0].title, 'Refactor auth');
    assert.equal(provider.calls[0].description, 'Split middleware');
    assert.deepEqual(provider.calls[0].tags, ['code-tag']);
    assert.deepEqual(readTasksFile(), []);
  });

  it('prepends the configured code tag and appends per-task tags', async () => {
    const task: LocalTask = {
      id: 'abc',
      title: 't',
      description: '',
      type: 'code',
      tags: ['frontend', 'urgent'],
    };
    writeTasksFile([task]);
    const provider = stubProvider();

    await processLocalTasks(cfg(), provider);

    assert.deepEqual(provider.calls[0].tags, ['code-tag', 'frontend', 'urgent']);
  });

  it('passes priority and listId through to the provider', async () => {
    const task: LocalTask = {
      id: 'abc',
      title: 't',
      description: '',
      type: 'code',
      priority: 2,
      listId: 'LIST-42',
    };
    writeTasksFile([task]);
    const provider = stubProvider();

    await processLocalTasks(cfg(), provider);

    assert.equal(provider.calls[0].priority, 2);
    assert.equal(provider.calls[0].listId, 'LIST-42');
  });

  it('converts ISO dueDate to epoch milliseconds', async () => {
    const task: LocalTask = {
      id: 'abc',
      title: 't',
      description: '',
      type: 'code',
      dueDate: '2026-05-01',
    };
    writeTasksFile([task]);
    const provider = stubProvider();

    await processLocalTasks(cfg(), provider);

    assert.equal(typeof provider.calls[0].dueDate, 'number');
    assert.equal(provider.calls[0].dueDate, new Date('2026-05-01').getTime());
  });

  it('routes non-code tasks to the non-code provider with its tag', async () => {
    const tasks: LocalTask[] = [
      { id: '1', title: 'code task', description: '', type: 'code' },
      { id: '2', title: 'nc task', description: '', type: 'non-code' },
    ];
    writeTasksFile(tasks);
    const code = stubProvider();
    const nonCode = stubProvider();

    const result = await processLocalTasks(
      cfg({ clickupTag: 'code-tag', nonCodeTag: 'nc-tag' }),
      code,
      nonCode,
    );

    assert.deepEqual(result, { pushed: 2, skipped: 0 });
    assert.equal(code.calls.length, 1);
    assert.equal(code.calls[0].title, 'code task');
    assert.deepEqual(code.calls[0].tags, ['code-tag']);
    assert.equal(nonCode.calls.length, 1);
    assert.equal(nonCode.calls[0].title, 'nc task');
    assert.deepEqual(nonCode.calls[0].tags, ['nc-tag']);
    assert.deepEqual(readTasksFile(), []);
  });

  it('falls back to the code provider when no non-code provider is given, but still uses the non-code tag', async () => {
    const task: LocalTask = {
      id: '1', title: 'nc', description: '', type: 'non-code',
    };
    writeTasksFile([task]);
    const code = stubProvider();

    await processLocalTasks(
      cfg({ clickupTag: 'code-tag', nonCodeTag: 'nc-tag' }),
      code,
    );

    assert.equal(code.calls.length, 1);
    assert.deepEqual(code.calls[0].tags, ['nc-tag']);
  });

  it('falls back to the code tag for non-code tasks when nonCodeTag is empty', async () => {
    const task: LocalTask = {
      id: '1', title: 'nc', description: '', type: 'non-code',
    };
    writeTasksFile([task]);
    const code = stubProvider();

    await processLocalTasks(cfg({ clickupTag: 'code-tag', nonCodeTag: '' }), code);

    assert.deepEqual(code.calls[0].tags, ['code-tag']);
  });

  it('keeps a cron task in the file and stamps lastPushedAt after a successful push', async () => {
    const task: LocalTask = {
      id: 'cron1',
      title: 'Daily',
      description: '',
      type: 'code',
      cron: '* * * * *', // always fires
    };
    writeTasksFile([task]);
    const provider = stubProvider();

    const before = Date.now();
    const result = await processLocalTasks(cfg(), provider);
    const after = Date.now();

    assert.deepEqual(result, { pushed: 1, skipped: 0 });
    const remaining = readTasksFile();
    assert.equal(remaining.length, 1);
    assert.equal(remaining[0].id, 'cron1');
    assert.ok(typeof remaining[0].lastPushedAt === 'number');
    assert.ok(remaining[0].lastPushedAt! >= before);
    assert.ok(remaining[0].lastPushedAt! <= after);
  });

  it('skips a cron task whose schedule has not fired since lastPushedAt', async () => {
    // Cron that only fires at 03:17 AM on Jan 1 — effectively never during the
    // 48h lookback from any given test run.
    const task: LocalTask = {
      id: 'cron2',
      title: 'Yearly',
      description: '',
      type: 'code',
      cron: '17 3 1 1 *',
      lastPushedAt: Date.now(),
    };
    writeTasksFile([task]);
    const provider = stubProvider();

    const result = await processLocalTasks(cfg(), provider);

    assert.deepEqual(result, { pushed: 0, skipped: 1 });
    assert.equal(provider.calls.length, 0);
    const remaining = readTasksFile();
    assert.equal(remaining.length, 1);
    assert.equal(remaining[0].lastPushedAt, task.lastPushedAt);
  });

  it('fires a fresh cron task (no lastPushedAt) on the first run even with a rare schedule', async () => {
    const task: LocalTask = {
      id: 'cron3',
      title: 'Fresh cron',
      description: '',
      type: 'code',
      cron: '17 3 1 1 *',
    };
    writeTasksFile([task]);
    const provider = stubProvider();

    const result = await processLocalTasks(cfg(), provider);

    assert.deepEqual(result, { pushed: 1, skipped: 0 });
    assert.equal(provider.calls.length, 1);
    const remaining = readTasksFile();
    assert.equal(remaining.length, 1);
    assert.ok(typeof remaining[0].lastPushedAt === 'number');
  });

  it('keeps a failed task in the file and counts it as skipped', async () => {
    const task: LocalTask = {
      id: 'fail',
      title: 'Will fail',
      description: '',
      type: 'code',
    };
    writeTasksFile([task]);
    const provider = stubProvider({ fail: true });

    const result = await processLocalTasks(cfg(), provider);

    assert.deepEqual(result, { pushed: 0, skipped: 1 });
    const remaining = readTasksFile();
    assert.equal(remaining.length, 1);
    assert.equal(remaining[0].id, 'fail');
    assert.equal(remaining[0].lastPushedAt, undefined);
  });

  it('assigns an id to cron tasks missing one and persists it', async () => {
    const task: LocalTask = {
      title: 'No id yet',
      description: '',
      type: 'code',
      cron: '17 3 1 1 *',
      lastPushedAt: Date.now(),
    };
    writeTasksFile([task]);
    const provider = stubProvider();

    await processLocalTasks(cfg(), provider);

    const remaining = readTasksFile();
    assert.equal(remaining.length, 1);
    assert.ok(remaining[0].id);
    assert.match(remaining[0].id!, /^[0-9a-f-]{36}$/);
  });

  it('pushes recurring tasks whose lastPushedAt is weeks ago (regression: 48h lookback)', async () => {
    const weeksAgo = Date.now() - 21 * 24 * 60 * 60 * 1000;
    const tasks: LocalTask[] = [
      {
        id: '99b02144-2669-41f6-a8c5-1dd684eff9ac',
        title: 'post new linkedin post',
        description: 'Publish draft',
        type: 'non-code',
        priority: 3,
        tags: ['social'],
        listId: '901518824337',
        cron: '30 11 */2 * *',
        lastPushedAt: weeksAgo,
      },
      {
        title: 'write a post about given subjects',
        description: 'save to drafts',
        type: 'non-code',
        priority: 3,
        tags: ['social'],
        listId: '901518824337',
        cron: '30 8 */4 * *',
        lastPushedAt: weeksAgo,
      },
    ];
    writeTasksFile(tasks);
    const code = stubProvider();
    const nonCode = stubProvider();

    const result = await processLocalTasks(
      cfg({ clickupTag: 'code-tag', nonCodeTag: 'nc-tag' }),
      code,
      nonCode,
    );

    assert.deepEqual(result, { pushed: 2, skipped: 0 });
    assert.equal(nonCode.calls.length, 2);
    assert.equal(code.calls.length, 0);
    assert.equal(nonCode.calls[0].listId, '901518824337');
    assert.deepEqual(nonCode.calls[0].tags, ['nc-tag', 'social']);

    const remaining = readTasksFile();
    assert.equal(remaining.length, 2);
    assert.ok(remaining[0].lastPushedAt! > weeksAgo);
    assert.ok(remaining[1].lastPushedAt! > weeksAgo);
    assert.match(remaining[1].id!, /^[0-9a-f-]{36}$/);
  });

  it('removes a one-shot task that had no id after a successful push', async () => {
    const task: LocalTask = {
      title: 'One shot',
      description: 'do it',
      type: 'code',
    };
    writeTasksFile([task]);
    const provider = stubProvider();

    const result = await processLocalTasks(cfg(), provider);

    assert.deepEqual(result, { pushed: 1, skipped: 0 });
    assert.deepEqual(readTasksFile(), []);
  });

  it('processes a mix of success and failure: pushes successes, retains failures', async () => {
    const tasks: LocalTask[] = [
      { id: 'ok', title: 'ok', description: '', type: 'code' },
      { id: 'bad', title: 'bad', description: '', type: 'code' },
    ];
    writeTasksFile(tasks);
    let callCount = 0;
    const provider: StubProvider = {
      calls: [],
      fetchTasks: async () => [],
      fetchTasksByStatus: async () => [],
      postComment: async () => {},
      getComments: async () => [],
      updateStatus: async () => {},
      createTask: async (params) => {
        provider.calls.push(params);
        callCount++;
        if (params.title === 'bad') throw new Error('boom');
        return { id: `r${callCount}`, url: `u${callCount}` };
      },
    };

    const result = await processLocalTasks(cfg(), provider);

    assert.deepEqual(result, { pushed: 1, skipped: 1 });
    const remaining = readTasksFile();
    assert.equal(remaining.length, 1);
    assert.equal(remaining[0].id, 'bad');
  });
});

// ─── tasksPushCommand (end-to-end against LocalProvider) ─────────────────────

describe('tasksPushCommand', () => {
  let tmpDir: string;
  let origCwd: string;
  const envKeys = [
    'PROVIDER', 'CLICKUP_API_KEY', 'CLICKUP_TEAM_ID', 'CLICKUP_TAG',
    'NON_CODE_TAG', 'AIDEV_ENV_EXTEND', 'AGENTS',
  ];
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of envKeys) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aidev-push-cmd-'));
    origCwd = process.cwd();
    process.chdir(tmpDir);
    fs.writeFileSync(path.join(tmpDir, '.env.aidev'), 'PROVIDER=local\n', 'utf8');
    mock.method(logger, 'info', () => {});
    mock.method(logger, 'success', () => {});
    mock.method(logger, 'warn', () => {});
    mock.method(logger, 'error', () => {});
    mock.method(logger, 'debug', () => {});
  });

  afterEach(() => {
    process.chdir(origCwd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
    for (const k of envKeys) {
      if (saved[k] !== undefined) process.env[k] = saved[k];
      else delete process.env[k];
    }
    mock.restoreAll();
  });

  it('returns early when the tasks file is absent (no config load required)', async () => {
    const warnCalls: string[] = [];
    mock.method(logger, 'warn', (m: string) => {
      warnCalls.push(m);
    });
    // No .env.aidev is read because we exit before loadConfig.
    fs.unlinkSync(path.join(tmpDir, '.env.aidev'));

    await tasksPushCommand();

    assert.ok(warnCalls.some((m) => m.includes('No local tasks found')));
    // Nothing was created.
    assert.equal(fs.existsSync(path.join(tmpDir, '.aidev')), false);
  });

  it('publishes queued tasks via the configured provider and clears one-shot entries', async () => {
    const tasks: LocalTask[] = [
      { id: 'a', title: 'Push me', description: 'body', type: 'code' },
    ];
    writeTasksFile(tasks);

    await tasksPushCommand();

    // LocalProvider writes to .aidev/tasks/open/<id>-<slug>.md
    const openDir = path.join(tmpDir, '.aidev', 'tasks', 'open');
    assert.ok(fs.existsSync(openDir), 'open folder should exist');
    const created = fs.readdirSync(openDir).filter((f) => f.endsWith('.md'));
    assert.equal(created.length, 1);
    const content = fs.readFileSync(path.join(openDir, created[0]), 'utf8');
    assert.ok(content.includes('title: Push me'));
    assert.ok(content.includes('body'));

    // One-shot entry removed from the queue.
    assert.deepEqual(readTasksFile(), []);
  });

  it('preserves cron entries after publishing them', async () => {
    const tasks: LocalTask[] = [
      {
        id: 'cr', title: 'Recurring', description: '', type: 'code',
        cron: '* * * * *',
      },
    ];
    writeTasksFile(tasks);

    await tasksPushCommand();

    const remaining = readTasksFile();
    assert.equal(remaining.length, 1);
    assert.equal(remaining[0].id, 'cr');
    assert.ok(typeof remaining[0].lastPushedAt === 'number');
  });

  it('still publishes local tasks when AGENTS contains a removed agent name', async () => {
    process.env.AGENTS = 'cursor,windsurf,claude';
    const tasks: LocalTask[] = [
      { id: 'a', title: 'Push me', description: 'body', type: 'code' },
    ];
    writeTasksFile(tasks);

    await tasksPushCommand();

    const openDir = path.join(tmpDir, '.aidev', 'tasks', 'open');
    assert.ok(fs.existsSync(openDir), 'open folder should exist');
    const created = fs.readdirSync(openDir).filter((f) => f.endsWith('.md'));
    assert.equal(created.length, 1);
    assert.deepEqual(readTasksFile(), []);
  });
});

// ─── tasksListCommand / tasksGetCommand / tasksDeleteCommand / tasksCommentCommand
// ─── tasksModifyCommand / tasksTagCommand / tasksUntagCommand ────────────────────
//
// The --remote path is exercised end-to-end: loadConfigWithInheritance reads a
// PROVIDER=local .env.aidev, createProvider builds a real LocalProvider, and the
// individual TaskProvider methods on LocalProvider.prototype are stubbed per test
// (class methods are plain configurable/writable properties, unlike the getter-based
// named exports of ../providers, which mock.method cannot redefine under this
// project's tsx/cjs test loader).

function fakeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 't1',
    name: 'Fake task',
    description: 'desc',
    status: 'open',
    url: 'https://example.test/t1',
    tags: ['a', 'b'],
    priority: 2,
    ...overrides,
  };
}

describe('unified tasks commands (list/get/delete/comment/modify/tag/untag)', () => {
  let tmpDir: string;
  let origCwd: string;
  // loadConfig reads process.env first and applyEnvFiles won't override keys
  // already present, so we must clear provider-related env vars for the temp
  // dir's .env.aidev (PROVIDER=local) to take effect. AIDEV_COMMENT_PREFIX is
  // set to '' rather than deleted so sourceShellProfile (which runs inside
  // loadConfig) doesn't re-inject a user-level registry value — loadConfig
  // falls back to the default '[aidev-$PROJECT_NAME]' template when the env
  // var is falsy.
  const envKeys = [
    'PROVIDER', 'CLICKUP_API_KEY', 'CLICKUP_TEAM_ID', 'CLICKUP_TAG',
    'NON_CODE_TAG', 'AIDEV_ENV_EXTEND', 'AGENTS',
  ];
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of envKeys) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
    saved.AIDEV_COMMENT_PREFIX = process.env.AIDEV_COMMENT_PREFIX;
    process.env.AIDEV_COMMENT_PREFIX = '';
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aidev-unified-tasks-'));
    origCwd = process.cwd();
    process.chdir(tmpDir);
    fs.writeFileSync(path.join(tmpDir, '.env.aidev'), 'PROVIDER=local\n', 'utf8');
    mock.method(logger, 'info', () => {});
    mock.method(logger, 'success', () => {});
    mock.method(logger, 'warn', () => {});
    mock.method(logger, 'error', () => {});
    mock.method(logger, 'debug', () => {});
  });

  afterEach(() => {
    process.chdir(origCwd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
    for (const k of envKeys) {
      if (saved[k] !== undefined) process.env[k] = saved[k];
      else delete process.env[k];
    }
    if (saved.AIDEV_COMMENT_PREFIX !== undefined) process.env.AIDEV_COMMENT_PREFIX = saved.AIDEV_COMMENT_PREFIX;
    else delete process.env.AIDEV_COMMENT_PREFIX;
    mock.restoreAll();
  });

  // ─── --remote path (real LocalProvider instance, stubbed methods) ────────

  describe('--remote (stubbed TaskProvider methods)', () => {
    it('list prints tasks from fetchTasks when no filter is given', async () => {
      mock.method(LocalProvider.prototype, 'fetchTasks', async () => [fakeTask()]);
      const logs: string[] = [];
      mock.method(console, 'log', (m: string) => logs.push(m));

      await tasksListCommand(undefined, { remote: true, output: 'json' });

      const parsed = JSON.parse(logs.join(''));
      assert.equal(parsed[0].id, 't1');
    });

    it('list uses fetchTasksByStatus when a filter is given', async () => {
      mock.method(LocalProvider.prototype, 'fetchTasksByStatus', async (statuses: string[]) => [
        fakeTask({ status: statuses[0] }),
      ]);
      const logs: string[] = [];
      mock.method(console, 'log', (m: string) => logs.push(m));

      await tasksListCommand('review,pending', { remote: true, output: 'json' });

      const parsed = JSON.parse(logs.join(''));
      assert.equal(parsed[0].status, 'review');
    });

    it('get returns the task by id', async () => {
      mock.method(LocalProvider.prototype, 'fetchTaskById', async (id: string) => fakeTask({ id }));
      const logs: string[] = [];
      mock.method(console, 'log', (m: string) => logs.push(m));

      await tasksGetCommand('abc', { remote: true, output: 'json' });

      const parsed = JSON.parse(logs.join(''));
      assert.equal(parsed[0].id, 'abc');
    });

    it('get errors when the provider does not implement fetchTaskById', async () => {
      const orig = LocalProvider.prototype.fetchTaskById;
      (LocalProvider.prototype as unknown as Record<string, unknown>).fetchTaskById = undefined;
      const errors: string[] = [];
      mock.method(logger, 'error', (m: string) => errors.push(m));
      let exitCode: number | undefined;
      mock.method(process, 'exit', ((code?: number) => {
        exitCode = code;
        throw new Error('exit');
      }) as never);

      try {
        await assert.rejects(() => tasksGetCommand('abc', { remote: true }));
        assert.equal(exitCode, 1);
        assert.ok(errors.some((m) => m.includes('not support')));
      } finally {
        LocalProvider.prototype.fetchTaskById = orig;
      }
    });

    it('delete calls provider.deleteTask', async () => {
      const calls: unknown[][] = [];
      mock.method(LocalProvider.prototype, 'deleteTask', async (...args: unknown[]) => {
        calls.push(args);
      });

      await tasksDeleteCommand('abc', { remote: true });

      assert.deepEqual(calls, [['abc']]);
    });

    it('delete errors when the provider does not implement deleteTask', async () => {
      const orig = LocalProvider.prototype.deleteTask;
      (LocalProvider.prototype as unknown as Record<string, unknown>).deleteTask = undefined;
      let exitCode: number | undefined;
      mock.method(process, 'exit', ((code?: number) => {
        exitCode = code;
        throw new Error('exit');
      }) as never);

      try {
        await assert.rejects(() => tasksDeleteCommand('abc', { remote: true }));
        assert.equal(exitCode, 1);
      } finally {
        LocalProvider.prototype.deleteTask = orig;
      }
    });

    it('comment posts the raw content without --as-aidev', async () => {
      const calls: unknown[][] = [];
      mock.method(LocalProvider.prototype, 'postComment', async (...args: unknown[]) => {
        calls.push(args);
      });

      await tasksCommentCommand('abc', 'hello world', { remote: true });

      assert.deepEqual(calls, [['abc', 'hello world']]);
    });

    it('comment prepends config.commentPrefix exactly once with --as-aidev', async () => {
      const calls: unknown[][] = [];
      mock.method(LocalProvider.prototype, 'postComment', async (...args: unknown[]) => {
        calls.push(args);
      });

      await tasksCommentCommand('abc', 'hello world', { remote: true, asAidev: true });

      assert.equal(calls.length, 1);
      const [, text] = calls[0] as [string, string];
      const folderName = path.basename(tmpDir);
      assert.equal(text, `[aidev-${folderName}] hello world`);
      // Exactly one prefix occurrence
      assert.equal(text.split('[aidev-').length - 1, 1);
    });

    it('modify calls updateStatus when --status is given', async () => {
      const calls: unknown[][] = [];
      mock.method(LocalProvider.prototype, 'updateStatus', async (...args: unknown[]) => {
        calls.push(args);
      });

      await tasksModifyCommand('abc', { remote: true, status: 'done' });

      assert.deepEqual(calls, [['abc', 'done']]);
    });

    it('modify errors when --title or --description is given', async () => {
      let exitCode: number | undefined;
      mock.method(process, 'exit', ((code?: number) => {
        exitCode = code;
        throw new Error('exit');
      }) as never);

      await assert.rejects(() => tasksModifyCommand('abc', { remote: true, title: 'New title' }));
      assert.equal(exitCode, 1);
    });

    it('tag adds each comma-separated tag', async () => {
      const calls: unknown[][] = [];
      mock.method(LocalProvider.prototype, 'addTag', async (...args: unknown[]) => {
        calls.push(args);
      });

      await tasksTagCommand('abc', ' foo , bar ,, ', { remote: true });

      assert.deepEqual(calls, [['abc', 'foo'], ['abc', 'bar']]);
    });

    it('tag errors when the provider does not implement addTag', async () => {
      const orig = LocalProvider.prototype.addTag;
      (LocalProvider.prototype as unknown as Record<string, unknown>).addTag = undefined;
      let exitCode: number | undefined;
      mock.method(process, 'exit', ((code?: number) => {
        exitCode = code;
        throw new Error('exit');
      }) as never);

      try {
        await assert.rejects(() => tasksTagCommand('abc', 'foo', { remote: true }));
        assert.equal(exitCode, 1);
      } finally {
        LocalProvider.prototype.addTag = orig;
      }
    });

    it('untag removes each comma-separated tag', async () => {
      const calls: unknown[][] = [];
      mock.method(LocalProvider.prototype, 'removeTag', async (...args: unknown[]) => {
        calls.push(args);
      });

      await tasksUntagCommand('abc', 'foo,bar', { remote: true });

      assert.deepEqual(calls, [['abc', 'foo'], ['abc', 'bar']]);
    });

    it('untag errors when the provider does not implement removeTag', async () => {
      const orig = LocalProvider.prototype.removeTag;
      (LocalProvider.prototype as unknown as Record<string, unknown>).removeTag = undefined;
      let exitCode: number | undefined;
      mock.method(process, 'exit', ((code?: number) => {
        exitCode = code;
        throw new Error('exit');
      }) as never);

      try {
        await assert.rejects(() => tasksUntagCommand('abc', 'foo', { remote: true }));
        assert.equal(exitCode, 1);
      } finally {
        LocalProvider.prototype.removeTag = orig;
      }
    });
  });

  // ─── non-remote path against a real LocalProvider ────────────────────────

  describe('without --remote (real LocalProvider)', () => {
    it('list/get/tag/untag/comment/delete work end-to-end against .aidev/tasks', async () => {
      const openDir = path.join(tmpDir, '.aidev', 'tasks', 'open');
      fs.mkdirSync(openDir, { recursive: true });
      fs.writeFileSync(
        path.join(openDir, 'abc123-my-task.md'),
        '---\ntitle: My task\n---\n\nSome description\n',
        'utf8',
      );

      const logs: string[] = [];
      mock.method(console, 'log', (m: string) => logs.push(m));

      await tasksListCommand(undefined, { output: 'json' });
      let parsed = JSON.parse(logs.join(''));
      assert.equal(parsed.length, 1);
      assert.equal(parsed[0].name, 'My task');

      logs.length = 0;
      await tasksGetCommand('abc123', { output: 'json' });
      parsed = JSON.parse(logs.join(''));
      assert.equal(parsed[0].id, 'abc123');

      await tasksTagCommand('abc123', 'urgent,frontend');
      logs.length = 0;
      await tasksGetCommand('abc123', { output: 'json' });
      parsed = JSON.parse(logs.join(''));
      assert.deepEqual(parsed[0].tags.split(','), ['urgent', 'frontend']);

      await tasksUntagCommand('abc123', 'urgent');
      logs.length = 0;
      await tasksGetCommand('abc123', { output: 'json' });
      parsed = JSON.parse(logs.join(''));
      assert.deepEqual(parsed[0].tags.split(','), ['frontend']);

      await tasksCommentCommand('abc123', 'a local comment');
      const sessionPath = path.join(openDir, 'abc123-my-task.session.md');
      assert.ok(fs.existsSync(sessionPath));
      assert.ok(fs.readFileSync(sessionPath, 'utf8').includes('a local comment'));

      await tasksDeleteCommand('abc123');
      assert.equal(fs.existsSync(path.join(openDir, 'abc123-my-task.md')), false);
    });

    it('comment prepends commentPrefix with --as-aidev even without --remote', async () => {
      const openDir = path.join(tmpDir, '.aidev', 'tasks', 'open');
      fs.mkdirSync(openDir, { recursive: true });
      fs.writeFileSync(
        path.join(openDir, 'abc123-my-task.md'),
        '---\ntitle: My task\n---\n\nSome description\n',
        'utf8',
      );

      await tasksCommentCommand('abc123', 'hello', { asAidev: true });

      const sessionPath = path.join(openDir, 'abc123-my-task.session.md');
      const content = fs.readFileSync(sessionPath, 'utf8');
      const folderName = path.basename(tmpDir);
      assert.ok(content.includes(`[aidev-${folderName}] hello`));
      assert.equal(content.split('[aidev-').length - 1, 1);
    });
  });
});

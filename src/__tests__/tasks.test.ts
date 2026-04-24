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
import { tasksPushCommand } from '../commands/tasks';
import type {
  Config,
  LocalTask,
  CreateTaskParams,
  CreateTaskResult,
} from '../types';
import type { TaskProvider } from '../providers';

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
});

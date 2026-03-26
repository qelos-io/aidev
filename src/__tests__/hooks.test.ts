import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { loadHooks, createHookVM, executeHook, AidevHooks, HookVM } from '../hooks';
import type { TaskProvider } from '../providers/base';
import type { AIRunner } from '../ai/base';
import type { Config } from '../types';

function stubConfig(): Config {
  return { provider: 'local' } as unknown as Config;
}

// ─── loadHooks ───────────────────────────────────────────────────────────────

describe('loadHooks', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aidev-hooks-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns empty object when path is empty', () => {
    const hooks = loadHooks('');
    assert.deepEqual(hooks, {});
  });

  it('returns empty object when file does not exist', () => {
    const hooks = loadHooks(path.join(tmpDir, 'nonexistent.js'));
    assert.deepEqual(hooks, {});
  });

  it('loads a JS hooks file with valid functions', () => {
    const hooksFile = path.join(tmpDir, 'hooks.js');
    fs.writeFileSync(hooksFile, `
      module.exports = {
        beforeRun: async (ctx) => ctx,
        afterRun: async () => {},
      };
    `, 'utf8');

    const hooks = loadHooks(hooksFile);
    assert.equal(typeof hooks.beforeRun, 'function');
    assert.equal(typeof hooks.afterRun, 'function');
  });

  it('ignores non-function exports', () => {
    const hooksFile = path.join(tmpDir, 'hooks.js');
    fs.writeFileSync(hooksFile, `
      module.exports = {
        beforeRun: 'not a function',
        afterRun: async () => {},
      };
    `, 'utf8');

    const hooks = loadHooks(hooksFile);
    assert.equal(hooks.beforeRun, undefined);
    assert.equal(typeof hooks.afterRun, 'function');
  });

  it('resolves relative paths from cwd', () => {
    const hooksFile = path.join(tmpDir, 'hooks.js');
    fs.writeFileSync(hooksFile, `
      module.exports = { beforeRun: async () => {} };
    `, 'utf8');

    const originalCwd = process.cwd();
    try {
      process.chdir(tmpDir);
      const hooks = loadHooks('./hooks.js');
      assert.equal(typeof hooks.beforeRun, 'function');
    } finally {
      process.chdir(originalCwd);
    }
  });

  it('handles default export', () => {
    const hooksFile = path.join(tmpDir, 'hooks.js');
    fs.writeFileSync(hooksFile, `
      module.exports.default = {
        beforeEachTask: async (ctx) => ctx,
      };
    `, 'utf8');

    const hooks = loadHooks(hooksFile);
    assert.equal(typeof hooks.beforeEachTask, 'function');
  });

  it('returns empty object when require fails', () => {
    const hooksFile = path.join(tmpDir, 'hooks.js');
    fs.writeFileSync(hooksFile, 'this is not valid javascript{{{', 'utf8');

    const hooks = loadHooks(hooksFile);
    assert.deepEqual(hooks, {});
  });

  it('ignores unknown export keys', () => {
    const hooksFile = path.join(tmpDir, 'hooks.js');
    fs.writeFileSync(
      hooksFile,
      `
      module.exports = {
        beforeRun: async () => {},
        notAHook: async () => {},
        extraField: 42,
      };
    `,
      'utf8'
    );

    const hooks = loadHooks(hooksFile);
    assert.equal(typeof hooks.beforeRun, 'function');
    assert.equal((hooks as Record<string, unknown>).notAHook, undefined);
  });

  it('loads a TypeScript hooks file via jiti', () => {
    const hooksFile = path.join(tmpDir, 'hooks.ts');
    fs.writeFileSync(hooksFile, `
      interface Ctx { config: Record<string, unknown>; filter: string; taskCount: number }
      const hooks = {
        beforeRun: async (ctx: Ctx) => ctx,
        afterRun: async () => {},
      };
      module.exports = hooks;
    `, 'utf8');

    const hooks = loadHooks(hooksFile);
    assert.equal(typeof hooks.beforeRun, 'function');
    assert.equal(typeof hooks.afterRun, 'function');
  });

  it('loads a TypeScript hooks file with export default via jiti', () => {
    const hooksFile = path.join(tmpDir, 'hooks-default.ts');
    fs.writeFileSync(hooksFile, `
      export default {
        beforeEachTask: async (ctx: any) => ctx,
      };
    `, 'utf8');

    const hooks = loadHooks(hooksFile);
    assert.equal(typeof hooks.beforeEachTask, 'function');
  });

  it('returns empty object when TypeScript file has syntax errors', () => {
    const hooksFile = path.join(tmpDir, 'bad.ts');
    fs.writeFileSync(hooksFile, 'this is not valid typescript{{{', 'utf8');

    const hooks = loadHooks(hooksFile);
    assert.deepEqual(hooks, {});
  });
});

// ─── executeHook ─────────────────────────────────────────────────────────────

describe('executeHook', () => {
  const mockVM: HookVM = {
    runAI: async () => ({ success: true, output: 'ok', error: '' }),
    postComment: async () => {},
    updateStatus: async () => {},
    getComments: async () => [],
    log: { info: () => {}, warn: () => {}, error: () => {} },
  };

  it('returns original context when hook does not exist', async () => {
    const hooks: AidevHooks = {};
    const ctx = { config: stubConfig(), filter: 'all', taskCount: 5 };
    const result = await executeHook(hooks, 'beforeRun', ctx, mockVM);
    assert.deepEqual(result, ctx);
  });

  it('returns modified context when hook returns one', async () => {
    const hooks: AidevHooks = {
      beforeRun: async (ctx) => ({ ...ctx, taskCount: 99 }),
    };
    const ctx = { config: stubConfig(), filter: 'all', taskCount: 5 };
    const result = await executeHook(hooks, 'beforeRun', ctx, mockVM);
    assert.equal(result.taskCount, 99);
  });

  it('returns original context when hook returns void', async () => {
    const hooks: AidevHooks = {
      beforeRun: async () => { /* no return */ },
    };
    const ctx = { config: stubConfig(), filter: 'all', taskCount: 5 };
    const result = await executeHook(hooks, 'beforeRun', ctx, mockVM);
    assert.equal(result.taskCount, 5);
  });

  it('propagates errors thrown by hooks', async () => {
    const hooks: AidevHooks = {
      beforeRun: async () => { throw new Error('hook abort'); },
    };
    const ctx = { config: stubConfig(), filter: 'all', taskCount: 5 };

    await assert.rejects(
      () => executeHook(hooks, 'beforeRun', ctx, mockVM),
      { message: 'hook abort' }
    );
  });

  it('passes vm to hook function', async () => {
    let receivedVM: HookVM | undefined;
    const hooks: AidevHooks = {
      afterRun: async (_ctx, vm) => { receivedVM = vm; },
    };
    const ctx = { config: stubConfig(), filter: 'all', taskCount: 0, processed: 0, skipped: 0 };
    await executeHook(hooks, 'afterRun', ctx, mockVM);
    assert.equal(receivedVM, mockVM);
  });

  it('allows beforeEachTask to modify prompt', async () => {
    const hooks: AidevHooks = {
      beforeEachTask: async (ctx) => {
        return { ...ctx, prompt: ctx.prompt + '\nExtra instructions' };
      },
    };
    const ctx = {
      task: { id: '1', name: 'test', description: '', status: 'open', url: '', tags: [] },
      config: stubConfig(),
      branchName: 'test-branch',
      prompt: 'Original prompt',
    };
    const result = await executeHook(hooks, 'beforeEachTask', ctx, mockVM);
    assert.ok(result.prompt.includes('Extra instructions'));
    assert.ok(result.prompt.includes('Original prompt'));
  });

  it('allows beforeThinkingTask to adjust subtasks', async () => {
    const hooks: AidevHooks = {
      beforeThinkingTask: async (ctx) => ({
        ...ctx,
        subtasks: ctx.subtasks.map((s) =>
          s.id === 1 ? { ...s, title: s.title + ' (edited)' } : s
        ),
      }),
    };
    const ctx = {
      task: { id: 't1', name: 'think', description: '', status: 'open', url: '', tags: [] },
      config: stubConfig(),
      branchName: 'b',
      subtasks: [
        { id: 1, title: 'Step one', description: 'd1', status: 'pending' },
        { id: 2, title: 'Step two', description: 'd2', status: 'pending' },
      ],
    };
    const result = await executeHook(hooks, 'beforeThinkingTask', ctx, mockVM);
    assert.equal(result.subtasks[0].title, 'Step one (edited)');
    assert.equal(result.subtasks[1].title, 'Step two');
  });
});

// ─── createHookVM ────────────────────────────────────────────────────────────

describe('createHookVM', () => {
  it('creates a VM with all required methods', () => {
    const mockProvider: TaskProvider = {
      fetchTasks: async () => [],
      postComment: async () => {},
      getComments: async () => [],
      updateStatus: async () => {},
      createTask: async () => ({ id: '1', url: '' }),
    };

    const mockRunner: AIRunner = {
      name: 'test-runner',
      isAvailable: () => true,
      run: async () => ({ success: true, output: 'ok', error: '' }),
    };

    const vm = createHookVM(mockProvider, [mockRunner]);

    assert.equal(typeof vm.runAI, 'function');
    assert.equal(typeof vm.postComment, 'function');
    assert.equal(typeof vm.updateStatus, 'function');
    assert.equal(typeof vm.getComments, 'function');
    assert.equal(typeof vm.log.info, 'function');
    assert.equal(typeof vm.log.warn, 'function');
    assert.equal(typeof vm.log.error, 'function');
  });

  it('runAI delegates to first available runner', async () => {
    const mockProvider: TaskProvider = {
      fetchTasks: async () => [],
      postComment: async () => {},
      getComments: async () => [],
      updateStatus: async () => {},
      createTask: async () => ({ id: '1', url: '' }),
    };

    let capturedPrompt = '';
    const mockRunner: AIRunner = {
      name: 'test-runner',
      isAvailable: () => true,
      run: async (prompt) => {
        capturedPrompt = prompt;
        return { success: true, output: 'result', error: '' };
      },
    };

    const vm = createHookVM(mockProvider, [mockRunner]);
    const result = await vm.runAI('test prompt');

    assert.equal(capturedPrompt, 'test prompt');
    assert.equal(result.success, true);
    assert.equal(result.output, 'result');
  });

  it('runAI returns failure when no runner is available', async () => {
    const mockProvider: TaskProvider = {
      fetchTasks: async () => [],
      postComment: async () => {},
      getComments: async () => [],
      updateStatus: async () => {},
      createTask: async () => ({ id: '1', url: '' }),
    };

    const unavailableRunner: AIRunner = {
      name: 'unavailable',
      isAvailable: () => false,
      run: async () => ({ success: false, output: '', error: '' }),
    };

    const vm = createHookVM(mockProvider, [unavailableRunner]);
    const result = await vm.runAI('test prompt');

    assert.equal(result.success, false);
    assert.ok(result.error.includes('No AI runner available'));
  });

  it('postComment delegates to provider', async () => {
    let capturedTaskId = '';
    let capturedText = '';
    const mockProvider: TaskProvider = {
      fetchTasks: async () => [],
      postComment: async (taskId, text) => { capturedTaskId = taskId; capturedText = text; },
      getComments: async () => [],
      updateStatus: async () => {},
      createTask: async () => ({ id: '1', url: '' }),
    };

    const vm = createHookVM(mockProvider, []);
    await vm.postComment('task-123', 'hello');

    assert.equal(capturedTaskId, 'task-123');
    assert.equal(capturedText, 'hello');
  });
});

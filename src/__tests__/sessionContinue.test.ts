import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, it, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { logger } from '../logger';
import { AiderRunner } from '../ai/aider';
import { AntigravityRunner } from '../ai/antigravity';
import { AnthropicSdkRunner } from '../ai/anthropicSdk';
import { ClaudeRunner } from '../ai/claude';
import { CodexRunner } from '../ai/codex';
import { CursorRunner } from '../ai/cursor';
import { DevinRunner } from '../ai/devin';
import { OpencodeRunner } from '../ai/opencode';
import type { AIRunner, AIRunOptions, AIRunResult } from '../ai/base';
import { runCodeTaskWithContinuation } from '../commands/run';
import { buildContinuePrompt } from '../prompts';
import { loadConfig } from '../config';
import { HOOK_NAMES, generateFullHooksFile, updateHooksFile } from '../hooksTemplate';
import type { AidevHooks, HookVM } from '../hooks';
import type { TaskProvider } from '../providers';
import type { Config, Task } from '../types';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const childProcess = require('node:child_process');

const SESSION = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

type Call = { cmd: string; args: string[] };

/** Records argv for every spawn of `bin` (ignores PATH lookups such as `where`/`which`). */
const NOT_FOUND = { pid: 1, output: [], stdout: '', stderr: '', status: 1, signal: null };

/** PATH lookups (`where.exe`/`which`) must report "not found" so the bare command name is spawned. */
function isLookup(cmd: unknown): boolean {
  return /^(where|which)$/i.test(path.basename(String(cmd)).replace(/\.(exe|cmd)$/i, ''));
}

function captureSpawns(bin: string, stdout = 'ok'): Call[] {
  const calls: Call[] = [];
  mock.method(childProcess, 'spawnSync', (cmd: unknown, args: unknown) => {
    if (isLookup(cmd)) return NOT_FOUND;
    const command = String(cmd);
    const base = path.basename(command).replace(/\.(exe|cmd)$/i, '');
    if (base === bin) calls.push({ cmd: command, args: [...(args as string[])] });
    return { pid: 1, output: [], stdout, stderr: '', status: 0, signal: null, error: undefined };
  });
  return calls;
}

function quietLogger(): void {
  mock.method(logger, 'info', () => {});
  mock.method(logger, 'warn', () => {});
  mock.method(logger, 'debug', () => {});
}

function argsAfter(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
}

// ─── Runner session support ──────────────────────────────────────────────────

describe('session support — claude', () => {
  beforeEach(() => { mock.restoreAll(); quietLogger(); });
  afterEach(() => mock.restoreAll());

  it('declares session support', () => {
    assert.equal(new ClaudeRunner().supportsSessions, true);
  });

  it('starts a session with --session-id', async () => {
    const calls = captureSpawns('claude');
    await new ClaudeRunner().run('do it', undefined, { session: { id: SESSION, resume: false } });
    assert.equal(argsAfter(calls[0].args, '--session-id'), SESSION);
    assert.ok(!calls[0].args.includes('--resume'));
  });

  it('continues a session with --resume', async () => {
    const calls = captureSpawns('claude');
    await new ClaudeRunner().run('continue', undefined, { session: { id: SESSION, resume: true } });
    assert.equal(argsAfter(calls[0].args, '--resume'), SESSION);
    assert.ok(!calls[0].args.includes('--session-id'));
  });

  it('adds no session flags without a session', async () => {
    const calls = captureSpawns('claude');
    await new ClaudeRunner().run('do it');
    assert.ok(!calls[0].args.includes('--session-id'));
    assert.ok(!calls[0].args.includes('--resume'));
  });
});

describe('session support — anthropic-sdk', () => {
  beforeEach(() => { mock.restoreAll(); quietLogger(); });
  afterEach(() => { mock.restoreAll(); });

  async function runWith(session?: AIRunOptions['session']): Promise<Record<string, unknown>> {
    const calls: Array<{ options: Record<string, unknown> }> = [];
    const sdk = {
      query(args: { options: Record<string, unknown> }) {
        calls.push(args);
        return (async function* () { yield { type: 'result', result: 'ok' }; })();
      },
    };
    const prev = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = 'sk-test';
    try {
      const runner = new AnthropicSdkRunner();
      mock.method(runner, 'loadSdk', async () => sdk);
      await runner.run('p', undefined, session ? { session } : undefined);
    } finally {
      if (prev === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = prev;
    }
    return calls[0].options;
  }

  it('passes sessionId on the first run', async () => {
    const options = await runWith({ id: SESSION, resume: false });
    assert.equal(options.sessionId, SESSION);
    assert.equal(options.resume, undefined);
  });

  it('passes resume on the follow-up run', async () => {
    const options = await runWith({ id: SESSION, resume: true });
    assert.equal(options.resume, SESSION);
    assert.equal(options.sessionId, undefined);
  });

  it('passes neither without a session', async () => {
    const options = await runWith();
    assert.equal(options.resume, undefined);
    assert.equal(options.sessionId, undefined);
  });
});

describe('session support — opencode', () => {
  beforeEach(() => { mock.restoreAll(); quietLogger(); });
  afterEach(() => mock.restoreAll());

  it('uses --continue only on the follow-up', async () => {
    const calls = captureSpawns('opencode');
    const runner = new OpencodeRunner();
    assert.equal(runner.supportsSessions, true);
    await runner.run('first', undefined, { session: { id: SESSION, resume: false } });
    await runner.run('second', undefined, { session: { id: SESSION, resume: true } });
    assert.ok(!calls[0].args.includes('--continue'));
    assert.ok(calls[1].args.includes('--continue'));
    assert.equal(calls[1].args[calls[1].args.length - 1], 'second');
  });
});

describe('session support — devin', () => {
  beforeEach(() => { mock.restoreAll(); quietLogger(); });
  afterEach(() => mock.restoreAll());

  it('uses --continue only on the follow-up', async () => {
    const calls = captureSpawns('devin');
    const runner = new DevinRunner();
    assert.equal(runner.supportsSessions, true);
    await runner.run('first', undefined, { session: { id: SESSION, resume: false } });
    await runner.run('second', undefined, { session: { id: SESSION, resume: true } });
    assert.ok(!calls[0].args.includes('--continue'));
    assert.ok(calls[1].args.includes('--continue'));
  });
});

describe('session support — codex', () => {
  beforeEach(() => { mock.restoreAll(); quietLogger(); });
  afterEach(() => mock.restoreAll());

  it('resumes the last session on the follow-up', async () => {
    const calls = captureSpawns('codex');
    const runner = new CodexRunner();
    assert.equal(runner.supportsSessions, true);
    await runner.run('first', undefined, { session: { id: SESSION, resume: false } });
    await runner.run('second', undefined, { session: { id: SESSION, resume: true } });
    assert.deepEqual(calls[0].args.slice(0, 1), ['exec']);
    assert.ok(!calls[0].args.includes('resume'));
    assert.deepEqual(calls[1].args, ['exec', 'resume', '--last', 'second']);
  });
});

describe('session support — cursor', () => {
  beforeEach(() => { mock.restoreAll(); quietLogger(); });
  afterEach(() => mock.restoreAll());

  it('creates a chat on the first run and resumes it on the follow-up', async () => {
    const chatId = '11111111-2222-4333-8444-555555555555';
    const calls: Call[] = [];
    mock.method(childProcess, 'spawnSync', (cmd: unknown, args: unknown) => {
      if (isLookup(cmd)) return NOT_FOUND;
      const a = [...(args as string[])];
      if (path.basename(String(cmd)).replace(/\.(exe|cmd)$/i, '') === 'agent') {
        calls.push({ cmd: String(cmd), args: a });
        if (a[0] === 'create-chat') {
          return { pid: 1, output: [], stdout: `${chatId}\n`, stderr: '', status: 0, signal: null };
        }
      }
      return { pid: 1, output: [], stdout: 'ok', stderr: '', status: 0, signal: null };
    });

    const runner = new CursorRunner();
    assert.equal(runner.supportsSessions, true);
    await runner.run('first', undefined, { session: { id: SESSION, resume: false } });
    await runner.run('second', undefined, { session: { id: SESSION, resume: true } });

    const created = calls.filter((c) => c.args[0] === 'create-chat');
    const runs = calls.filter((c) => c.args.includes('--print'));
    assert.equal(created.length, 1);
    assert.equal(argsAfter(runs[0].args, '--resume'), chatId);
    assert.equal(argsAfter(runs[1].args, '--resume'), chatId);
  });

  it('runs without a session when create-chat fails, and falls back to --continue on resume', async () => {
    const calls: Call[] = [];
    mock.method(childProcess, 'spawnSync', (cmd: unknown, args: unknown) => {
      if (isLookup(cmd)) return NOT_FOUND;
      const a = [...(args as string[])];
      if (path.basename(String(cmd)).replace(/\.(exe|cmd)$/i, '') === 'agent') {
        calls.push({ cmd: String(cmd), args: a });
        if (a[0] === 'create-chat') {
          return { pid: 1, output: [], stdout: '', stderr: 'boom', status: 1, signal: null };
        }
      }
      return { pid: 1, output: [], stdout: 'ok', stderr: '', status: 0, signal: null };
    });

    const runner = new CursorRunner();
    await runner.run('first', undefined, { session: { id: SESSION, resume: false } });
    await runner.run('second', undefined, { session: { id: SESSION, resume: true } });

    const runs = calls.filter((c) => c.args.includes('--print'));
    assert.ok(!runs[0].args.includes('--resume'));
    assert.ok(runs[1].args.includes('--continue'));
  });
});

describe('session support — aider', () => {
  let tmp: string;
  let prevCwd: string;

  beforeEach(() => {
    mock.restoreAll();
    quietLogger();
    prevCwd = process.cwd();
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aidev-aider-session-'));
    process.chdir(tmp);
  });
  afterEach(() => {
    mock.restoreAll();
    process.chdir(prevCwd);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('uses a per-session chat history file and restores it on the follow-up', async () => {
    const calls = captureSpawns('aider');
    const runner = new AiderRunner();
    assert.equal(runner.supportsSessions, true);
    await runner.run('first', undefined, { session: { id: SESSION, resume: false } });
    await runner.run('second', undefined, { session: { id: SESSION, resume: true } });

    const file1 = argsAfter(calls[0].args, '--chat-history-file');
    const file2 = argsAfter(calls[1].args, '--chat-history-file');
    assert.ok(file1 && file1.includes(SESSION));
    assert.equal(file1, file2);
    assert.ok(!calls[0].args.includes('--restore-chat-history'));
    assert.ok(calls[1].args.includes('--restore-chat-history'));
  });

  it('adds no session flags without a session', async () => {
    const calls = captureSpawns('aider');
    await new AiderRunner().run('first');
    assert.ok(!calls[0].args.includes('--chat-history-file'));
  });
});

describe('session support — antigravity', () => {
  it('does not claim session support (no known resume mechanism)', () => {
    assert.ok(!new AntigravityRunner().supportsSessions);
  });
});

// ─── runCodeTaskWithContinuation ─────────────────────────────────────────────

function fakeRunner(
  results: Array<Partial<AIRunResult>>,
  opts: { supportsSessions?: boolean } = {},
): AIRunner & { calls: Array<{ prompt: string; notes?: string; options?: AIRunOptions }> } {
  const calls: Array<{ prompt: string; notes?: string; options?: AIRunOptions }> = [];
  let i = 0;
  return {
    name: 'fake',
    supportsSessions: opts.supportsSessions ?? true,
    isAvailable: () => true,
    calls,
    async run(prompt, notes, options) {
      calls.push({ prompt, notes, options });
      const r = results[Math.min(i++, results.length - 1)];
      return { success: true, output: '', error: '', ...r };
    },
  };
}

const task = { id: 'T-1', name: 'Task', description: 'd', status: 'open', url: 'u', tags: [] } as Task;
const provider = {} as TaskProvider; // no fetchTaskById → runner is called directly
const cfg = (over: Partial<Config> = {}) => ({ continueAfterRun: true, ...over }) as Config;
const vm = {} as HookVM;

describe('runCodeTaskWithContinuation', () => {
  beforeEach(() => { mock.restoreAll(); quietLogger(); });
  afterEach(() => mock.restoreAll());

  it('runs the task, then continues in the same session', async () => {
    const runner = fakeRunner([{ output: 'part one' }, { output: 'part two' }]);
    const result = await runCodeTaskWithContinuation(
      runner, 'implement', 'notes', task, 'branch', provider, cfg(), undefined, {}, undefined,
    );

    assert.equal(runner.calls.length, 2);
    const first = runner.calls[0];
    const second = runner.calls[1];
    assert.equal(first.prompt, 'implement');
    assert.equal(first.notes, 'notes');
    assert.equal(first.options?.session?.resume, false);
    assert.equal(second.prompt, buildContinuePrompt());
    assert.equal(second.options?.session?.resume, true);
    assert.equal(first.options?.session?.id, second.options?.session?.id);
    assert.match(first.options!.session!.id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    assert.equal(result.success, true);
    assert.equal(result.output, 'part one\npart two');
  });

  it('uses a different random session id for every task run', async () => {
    const runner = fakeRunner([{}]);
    await runCodeTaskWithContinuation(runner, 'a', undefined, task, 'b', provider, cfg(), undefined, {}, undefined);
    await runCodeTaskWithContinuation(runner, 'a', undefined, task, 'b', provider, cfg(), undefined, {}, undefined);
    assert.notEqual(runner.calls[0].options?.session?.id, runner.calls[2].options?.session?.id);
  });

  it('does nothing extra when the runner has no session support', async () => {
    const runner = fakeRunner([{ output: 'x' }], { supportsSessions: false });
    const result = await runCodeTaskWithContinuation(
      runner, 'implement', undefined, task, 'b', provider, cfg(), undefined, {}, undefined,
    );
    assert.equal(runner.calls.length, 1);
    assert.equal(runner.calls[0].options?.session, undefined);
    assert.equal(result.output, 'x');
  });

  it('does nothing extra when continueAfterRun is disabled', async () => {
    const runner = fakeRunner([{ output: 'x' }]);
    await runCodeTaskWithContinuation(
      runner, 'implement', undefined, task, 'b', provider, cfg({ continueAfterRun: false }), undefined, {}, undefined,
    );
    assert.equal(runner.calls.length, 1);
    assert.equal(runner.calls[0].options?.session, undefined);
  });

  it('does not continue when the first run failed', async () => {
    const runner = fakeRunner([{ success: false, error: 'boom' }]);
    const result = await runCodeTaskWithContinuation(
      runner, 'implement', undefined, task, 'b', provider, cfg(), undefined, {}, undefined,
    );
    assert.equal(runner.calls.length, 1);
    assert.equal(result.success, false);
  });

  it('keeps the first result when the follow-up fails', async () => {
    const runner = fakeRunner([{ output: 'done work' }, { success: false, error: 'follow-up boom' }]);
    const result = await runCodeTaskWithContinuation(
      runner, 'implement', undefined, task, 'b', provider, cfg(), undefined, {}, undefined,
    );
    assert.equal(runner.calls.length, 2);
    assert.equal(result.success, true);
    assert.equal(result.output, 'done work');
  });

  it('keeps asset dirs on both runs', async () => {
    const runner = fakeRunner([{}]);
    await runCodeTaskWithContinuation(
      runner, 'implement', undefined, task, 'b', provider, cfg(), { assetDirs: ['/a'] }, {}, undefined,
    );
    assert.deepEqual(runner.calls[0].options?.assetDirs, ['/a']);
    assert.deepEqual(runner.calls[1].options?.assetDirs, ['/a']);
  });

  it('lets the beforeContinueTask hook rewrite the follow-up prompt', async () => {
    const runner = fakeRunner([{}]);
    const seen: Array<Record<string, unknown>> = [];
    const hooks: AidevHooks = {
      async beforeContinueTask(ctx) {
        seen.push({ prompt: ctx.prompt, runner: ctx.runner, branchName: ctx.branchName, sessionId: ctx.sessionId });
        return { ...ctx, prompt: `${ctx.prompt}\nAlso run the tests.` };
      },
    };
    await runCodeTaskWithContinuation(runner, 'implement', undefined, task, 'my-branch', provider, cfg(), undefined, hooks, vm);

    assert.equal(runner.calls.length, 2);
    assert.equal(runner.calls[1].prompt, `${buildContinuePrompt()}\nAlso run the tests.`);
    assert.equal(seen[0].prompt, buildContinuePrompt());
    assert.equal(seen[0].runner, 'fake');
    assert.equal(seen[0].branchName, 'my-branch');
    assert.equal(seen[0].sessionId, runner.calls[0].options?.session?.id);
  });

  it('skips the follow-up when the hook returns an empty prompt', async () => {
    const runner = fakeRunner([{ output: 'x' }]);
    const hooks: AidevHooks = { beforeContinueTask: async (ctx) => ({ ...ctx, prompt: '  ' }) };
    const result = await runCodeTaskWithContinuation(
      runner, 'implement', undefined, task, 'b', provider, cfg(), undefined, hooks, vm,
    );
    assert.equal(runner.calls.length, 1);
    assert.equal(result.output, 'x');
  });
});

// ─── Prompt / config / hook wiring ───────────────────────────────────────────

describe('continue prompt', () => {
  it('asks the agent to continue if unfinished', () => {
    assert.match(buildContinuePrompt(), /haven't finished yet - continue/);
  });
});

describe('AIDEV_CONTINUE_AFTER_RUN config', () => {
  const prevProvider = process.env.PROVIDER;
  // 'local' needs no credentials, so loadConfig works on CI without .env.aidev
  beforeEach(() => { process.env.PROVIDER = 'local'; });
  afterEach(() => {
    delete process.env.AIDEV_CONTINUE_AFTER_RUN;
    if (prevProvider === undefined) delete process.env.PROVIDER;
    else process.env.PROVIDER = prevProvider;
  });

  it('defaults to true', () => {
    delete process.env.AIDEV_CONTINUE_AFTER_RUN;
    assert.equal(loadConfig().continueAfterRun, true);
  });

  it('can be disabled with false / 0 / no', () => {
    for (const v of ['false', '0', 'no']) {
      process.env.AIDEV_CONTINUE_AFTER_RUN = v;
      assert.equal(loadConfig().continueAfterRun, false, v);
    }
  });
});

describe('beforeContinueTask hook registration', () => {
  let tmp: string;
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aidev-continue-hook-')); });
  afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

  it('is a known hook name that loadHooks keeps', () => {
    const file = path.join(tmp, 'hooks.js');
    fs.writeFileSync(file, 'module.exports = { beforeContinueTask: async (c) => c, notAHook: () => {} };');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { loadHooks } = require('../hooks');
    const hooks = loadHooks(file);
    assert.equal(typeof hooks.beforeContinueTask, 'function');
    assert.equal('notAHook' in hooks, false);
  });

  it('is part of the generated hooks file and the init updater', () => {
    assert.ok(HOOK_NAMES.includes('beforeContinueTask'));
    assert.match(generateFullHooksFile(), /export async function beforeContinueTask/);
    const { content, added } = updateHooksFile('export async function beforeRun() {}\n');
    assert.ok(added.includes('beforeContinueTask'));
    assert.match(content, /beforeContinueTask/);
  });
});

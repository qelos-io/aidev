import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { weeklyCleanupCommand } from '../commands/cleanup';
import type { Config, Task } from '../types';
import type { TaskProvider } from '../providers/base';

const baseConfig = {
  provider: 'clickup',
  gitRemote: 'origin',
  githubBaseBranch: 'main',
} as Config;

function gitCmd(args: string[], cwd: string): void {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
  }
}

function localBranches(cwd: string): string[] {
  const result = spawnSync('git', ['branch', '--format=%(refname:short)'], { cwd, encoding: 'utf8' });
  return result.stdout.split('\n').map((l) => l.trim()).filter(Boolean);
}

function providerWithTasks(taskIds: string[]): TaskProvider {
  return {
    async fetchTasks(): Promise<Task[]> {
      return taskIds.map((id) => ({
        id, name: id, description: '', status: 'open', url: '', tags: [],
      }));
    },
    async fetchTasksByStatus(): Promise<Task[]> { return []; },
    async postComment(): Promise<void> {},
    async getComments(): Promise<[]> { return []; },
    async updateStatus(): Promise<void> {},
    async createTask() { return { id: '1', url: '' }; },
  } as unknown as TaskProvider;
}

/**
 * Provider whose fetchBoardTasks returns a broader active set (open/pending/
 * in progress/in review) than fetchTasks (open/pending only). Mirrors the
 * ClickUp split — cleanup must prefer fetchBoardTasks so in-review and
 * in-progress task branches are not deleted.
 */
function providerWithBoardTasks(boardTaskIds: string[], fetchTaskIds: string[]): TaskProvider {
  return {
    async fetchTasks(): Promise<Task[]> {
      return fetchTaskIds.map((id) => ({
        id, name: id, description: '', status: 'open', url: '', tags: [],
      }));
    },
    async fetchBoardTasks(): Promise<Task[]> {
      return boardTaskIds.map((id) => ({
        id, name: id, description: '', status: 'in review', url: '', tags: [],
      }));
    },
    async fetchTasksByStatus(): Promise<Task[]> { return []; },
    async postComment(): Promise<void> {},
    async getComments(): Promise<[]> { return []; },
    async updateStatus(): Promise<void> {},
    async createTask() { return { id: '1', url: '' }; },
  } as unknown as TaskProvider;
}

describe('weeklyCleanupCommand (integration)', () => {
  let tmpDir: string;
  let bareDir: string;
  let originalCwd: string;

  beforeEach(() => {
    originalCwd = process.cwd();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aidev-cleanup-test-'));
    bareDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aidev-cleanup-bare-'));
    gitCmd(['init', '--bare', '-b', 'main'], bareDir);
    gitCmd(['init', '-b', 'main'], tmpDir);
    gitCmd(['config', 'user.email', 'test@test.com'], tmpDir);
    gitCmd(['config', 'user.name', 'Test'], tmpDir);
    fs.writeFileSync(path.join(tmpDir, 'README.md'), '# test\n');
    // aidev writes aidev.log to cwd — ignore it so it doesn't count as a dirty
    // working tree (mirrors the real .gitignore every aidev project has).
    fs.writeFileSync(path.join(tmpDir, '.gitignore'), 'aidev.log\n');
    gitCmd(['add', '.'], tmpDir);
    gitCmd(['commit', '-m', 'initial commit'], tmpDir);
    gitCmd(['remote', 'add', 'origin', bareDir], tmpDir);
    gitCmd(['push', 'origin', 'main'], tmpDir);
    process.chdir(tmpDir);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.rmSync(bareDir, { recursive: true, force: true });
  });

  it('deletes branches for tasks that are no longer active, keeps active and protected branches', async () => {
    gitCmd(['branch', 'task1/done-task'], tmpDir);
    gitCmd(['branch', 'task2/still-active'], tmpDir);
    gitCmd(['branch', 'develop'], tmpDir);

    const provider = providerWithTasks(['task2']);
    const result = await weeklyCleanupCommand(baseConfig, provider);

    assert.ok(result);
    assert.deepEqual(result!.branchesDeleted, ['task1/done-task']);

    const remaining = localBranches(tmpDir).sort();
    assert.deepEqual(remaining, ['develop', 'main', 'task2/still-active']);
  });

  it('clears stash entries', async () => {
    // Modify a tracked file so a plain `stash push` (no -u needed) captures it.
    fs.writeFileSync(path.join(tmpDir, 'README.md'), '# modified\n');
    gitCmd(['stash', 'push', '-m', 'leftover'], tmpDir);

    const result = await weeklyCleanupCommand(baseConfig, providerWithTasks([]));

    assert.ok(result);
    assert.equal(result!.stashesCleared, 1);
    const stashList = spawnSync('git', ['stash', 'list'], { cwd: tmpDir, encoding: 'utf8' });
    assert.equal(stashList.stdout.trim(), '');
  });

  it('checks out and leaves the repo on the base branch', async () => {
    gitCmd(['checkout', '-b', 'task1/some-branch'], tmpDir);
    gitCmd(['push', 'origin', 'task1/some-branch'], tmpDir);

    await weeklyCleanupCommand(baseConfig, providerWithTasks([]));

    const current = spawnSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: tmpDir, encoding: 'utf8' });
    assert.equal(current.stdout.trim(), 'main');
  });

  it('returns null and skips branch deletion when fetching active tasks fails', async () => {
    gitCmd(['branch', 'task1/some-branch'], tmpDir);
    const failingProvider: TaskProvider = {
      async fetchTasks(): Promise<Task[]> { throw new Error('provider down'); },
      async fetchBoardTasks(): Promise<Task[]> { throw new Error('board down'); },
      async fetchTasksByStatus(): Promise<Task[]> { return []; },
      async postComment(): Promise<void> {},
      async getComments(): Promise<[]> { return []; },
      async updateStatus(): Promise<void> {},
      async createTask() { return { id: '1', url: '' }; },
    } as unknown as TaskProvider;

    const result = await weeklyCleanupCommand(baseConfig, failingProvider);
    assert.equal(result, null);
    assert.ok(localBranches(tmpDir).includes('task1/some-branch'));
  });

  it('prefers fetchBoardTasks so in-review task branches are not deleted', async () => {
    gitCmd(['branch', 'task1/in-review'], tmpDir);
    gitCmd(['branch', 'task2/done'], tmpDir);

    // fetchTasks returns no active tasks (open/pending only), but
    // fetchBoardTasks reports task1 as still active (in review).
    const provider = providerWithBoardTasks(['task1'], []);
    const result = await weeklyCleanupCommand(baseConfig, provider);

    assert.ok(result);
    assert.deepEqual(result!.branchesDeleted, ['task2/done']);
    const remaining = localBranches(tmpDir).sort();
    assert.deepEqual(remaining, ['main', 'task1/in-review']);
  });
});

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { AIRunner, AIRunOptions } from '../ai/base';
import { addWorktree, findWorktreeForBranch } from '../git';
import {
  absolutizeAssetPaths,
  releaseAllWorktrees,
  releaseWorktree,
  trackWorktree,
  trackedWorktrees,
  withCwd,
} from '../worktreeSession';
import { isWorktreeDir } from '../commands/run';

function run(args: string[], cwd: string): string {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`);
  return r.stdout;
}

describe('withCwd', () => {
  function fakeRunner(seen: Array<AIRunOptions | undefined>): AIRunner {
    return {
      name: 'fake',
      supportsSessions: true,
      isAvailable: () => true,
      run: async (_p, _n, options) => {
        seen.push(options);
        return { success: true, output: '', error: '' };
      },
    };
  }

  it('injects cwd and keeps other options and runner flags', async () => {
    const seen: Array<AIRunOptions | undefined> = [];
    const [wrapped] = withCwd([fakeRunner(seen)], '/wt');
    assert.equal(wrapped.name, 'fake');
    assert.equal(wrapped.supportsSessions, true);
    await wrapped.run('p', undefined, { assetDirs: ['/a'] });
    await wrapped.run('p');
    assert.deepEqual(seen[0], { assetDirs: ['/a'], cwd: '/wt' });
    assert.equal(seen[1]?.cwd, '/wt');
  });

  it('lets an explicit cwd win', async () => {
    const seen: Array<AIRunOptions | undefined> = [];
    const [wrapped] = withCwd([fakeRunner(seen)], '/wt');
    await wrapped.run('p', undefined, { cwd: '/other' });
    assert.equal(seen[0]?.cwd, '/other');
  });
});

describe('absolutizeAssetPaths', () => {
  it('rewrites every relative .aidev/assets/ reference to the main repo', () => {
    const root = path.join(os.tmpdir(), 'repo');
    const abs = path.join(root, '.aidev', 'assets').split('\\').join('/') + '/';
    const out = absolutizeAssetPaths('see `.aidev/assets/1/a.png` and .aidev/assets/1/b.png', root);
    assert.equal(out, `see \`${abs}1/a.png\` and ${abs}1/b.png`);
  });
});

describe('worktree release', () => {
  let root: string;
  let repo: string;
  let cwdBefore: string;

  beforeEach(() => {
    cwdBefore = process.cwd();
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'aidev-wts-'));
    const remote = path.join(root, 'remote.git');
    repo = path.join(root, 'repo');
    fs.mkdirSync(repo);
    run(['init', '--bare', '-b', 'main', remote], root);
    run(['init', '-b', 'main'], repo);
    run(['config', 'user.email', 'test@test.com'], repo);
    run(['config', 'user.name', 'Test'], repo);
    fs.writeFileSync(path.join(repo, 'a.txt'), 'a\n');
    run(['add', '-A'], repo);
    run(['commit', '-m', 'init'], repo);
    run(['remote', 'add', 'origin', remote], repo);
    run(['push', 'origin', 'main'], repo);
    process.chdir(repo);
  });

  afterEach(() => {
    process.chdir(cwdBefore);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('isWorktreeDir distinguishes the main checkout from a worktree', () => {
    const { path: wt } = addWorktree('origin', 'main', 'task/a', false, repo);
    assert.equal(isWorktreeDir(process.cwd()), false);
    assert.equal(isWorktreeDir(wt), true);
  });

  it('removes a clean worktree but keeps the branch', () => {
    const { path: wt } = addWorktree('origin', 'main', 'task/clean', false, repo);
    trackWorktree(wt, repo);
    assert.equal(releaseWorktree(wt, repo), true);
    assert.ok(!fs.existsSync(wt));
    assert.equal(findWorktreeForBranch('task/clean', repo), null);
    assert.match(run(['branch', '--list', 'task/clean'], repo), /task\/clean/);
    assert.deepEqual(trackedWorktrees(), []);
  });

  it('keeps a worktree with uncommitted changes', () => {
    const { path: wt } = addWorktree('origin', 'main', 'task/dirty', false, repo);
    trackWorktree(wt, repo);
    fs.writeFileSync(path.join(wt, 'new.txt'), 'wip\n');
    assert.equal(releaseWorktree(wt, repo), false);
    assert.ok(fs.existsSync(path.join(wt, 'new.txt')));
  });

  it('is idempotent when the directory is already gone', () => {
    const { path: wt } = addWorktree('origin', 'main', 'task/gone', false, repo);
    assert.equal(releaseWorktree(wt, repo), true);
    assert.equal(releaseWorktree(wt, repo), true);
  });

  it('releaseAllWorktrees removes every tracked clean worktree', () => {
    const a = addWorktree('origin', 'main', 'task/x', false, repo).path;
    const b = addWorktree('origin', 'main', 'task/y', false, repo).path;
    trackWorktree(a, repo);
    trackWorktree(b, repo);
    releaseAllWorktrees();
    assert.ok(!fs.existsSync(a));
    assert.ok(!fs.existsSync(b));
    assert.deepEqual(trackedWorktrees(), []);
  });
});

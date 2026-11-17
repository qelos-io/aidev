import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  abortMerge,
  addAll,
  addWorktree,
  checkConflictsWithBase,
  commit,
  commitMerge,
  discardWorkingChanges,
  ensureLocalExclude,
  findWorktreeForBranch,
  getConflictDetails,
  getCurrentBranch,
  hasChanges,
  hasCommitsAhead,
  listWorkingTreeChanges,
  listWorktrees,
  mergeBaseBranch,
  parseWorktreeList,
  pruneWorktrees,
  push,
  removeWorktree,
  samePath,
  worktreePathForBranch,
  worktreesDir,
} from '../git';

function run(args: string[], cwd: string): string {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`);
  return r.stdout;
}

describe('worktree path helpers', () => {
  it('worktreesDir is <cwd>/.aidev/worktrees', () => {
    assert.equal(worktreesDir('/repo'), path.join('/repo', '.aidev', 'worktrees'));
  });

  it('worktreePathForBranch sanitizes slashes and illegal characters', () => {
    const p = worktreePathForBranch('feature/abc-123:fix?', '/repo');
    assert.equal(path.dirname(p), worktreesDir('/repo'));
    assert.equal(path.basename(p), 'feature-abc-123-fix');
  });

  it('never yields an empty or dot-leading folder name', () => {
    assert.equal(path.basename(worktreePathForBranch('///', '/repo')), 'branch');
    assert.ok(!path.basename(worktreePathForBranch('..evil', '/repo')).startsWith('.'));
  });
});

describe('parseWorktreeList', () => {
  it('parses main, branch, detached and prunable entries', () => {
    const out = [
      'worktree /repo',
      'HEAD aaa',
      'branch refs/heads/main',
      '',
      'worktree /repo/.aidev/worktrees/feat-x',
      'HEAD bbb',
      'branch refs/heads/feat/x',
      'locked reason',
      '',
      'worktree /tmp/detached',
      'HEAD ccc',
      'detached',
      'prunable gitdir file points to non-existent location',
      '',
    ].join('\n');
    const list = parseWorktreeList(out);
    assert.equal(list.length, 3);
    assert.deepEqual([list[0].path, list[0].branch], ['/repo', 'main']);
    assert.equal(list[1].branch, 'feat/x');
    assert.equal(list[1].locked, true);
    assert.equal(list[2].branch, null);
    assert.equal(list[2].prunable, true);
  });

  it('handles CRLF and empty output', () => {
    assert.deepEqual(parseWorktreeList(''), []);
    const list = parseWorktreeList('worktree /a\r\nHEAD x\r\nbranch refs/heads/b\r\n\r\n');
    assert.equal(list[0].branch, 'b');
  });
});

describe('worktree operations (temp repos)', () => {
  let root: string;
  let remote: string;
  let repo: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'aidev-wt-'));
    remote = path.join(root, 'remote.git');
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
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('creates a new branch worktree under .aidev/worktrees from the remote base', () => {
    const res = addWorktree('origin', 'main', 'task/one', false, repo);
    assert.equal(res.ok, true);
    assert.equal(res.reused, false);
    assert.ok(samePath(res.path, worktreePathForBranch('task/one', repo)));
    assert.ok(fs.existsSync(path.join(res.path, 'a.txt')));
    assert.equal(getCurrentBranch(res.path), 'task/one');
    // main checkout is untouched
    assert.equal(getCurrentBranch(repo), 'main');
    assert.equal(findWorktreeForBranch('task/one', repo)?.branch, 'task/one');
  });

  it('disambiguates colliding branch folders (a/b vs a-b) with a hash suffix', () => {
    const first = addWorktree('origin', 'main', 'a/b', false, repo);
    const second = addWorktree('origin', 'main', 'a-b', false, repo);
    assert.equal(first.ok, true);
    assert.equal(second.ok, true);
    assert.ok(!samePath(first.path, second.path));
    assert.equal(getCurrentBranch(second.path), 'a-b');
  });

  it('reuses the worktree when called again for the same branch', () => {
    const first = addWorktree('origin', 'main', 'task/two', false, repo);
    const second = addWorktree('origin', 'main', 'task/two', true, repo);
    assert.equal(second.ok, true);
    assert.equal(second.reused, true);
    assert.ok(samePath(first.path, second.path));
  });

  it('checks out an existing remote-only branch', () => {
    run(['checkout', '-b', 'remote-only'], repo);
    fs.writeFileSync(path.join(repo, 'r.txt'), 'r\n');
    run(['add', '-A'], repo);
    run(['commit', '-m', 'r'], repo);
    run(['push', 'origin', 'remote-only'], repo);
    run(['checkout', 'main'], repo);
    run(['branch', '-D', 'remote-only'], repo);

    const res = addWorktree('origin', 'main', 'remote-only', true, repo);
    assert.equal(res.ok, true);
    assert.ok(fs.existsSync(path.join(res.path, 'r.txt')));
  });

  it('fails for a missing existing branch', () => {
    assert.equal(addWorktree('origin', 'main', 'nope', true, repo).ok, false);
  });

  it('recovers from a stale directory left by a crash', () => {
    const target = worktreePathForBranch('task/stale', repo);
    fs.mkdirSync(target, { recursive: true });
    fs.writeFileSync(path.join(target, 'junk.txt'), 'x');
    const res = addWorktree('origin', 'main', 'task/stale', false, repo);
    assert.equal(res.ok, true);
    assert.ok(!fs.existsSync(path.join(res.path, 'junk.txt')));
    assert.equal(getCurrentBranch(res.path), 'task/stale');
  });

  it('recovers when the worktree dir was deleted but is still registered', () => {
    const first = addWorktree('origin', 'main', 'task/gone', false, repo);
    fs.rmSync(first.path, { recursive: true, force: true });
    const res = addWorktree('origin', 'main', 'task/gone', false, repo);
    assert.equal(res.ok, true);
    assert.equal(getCurrentBranch(res.path), 'task/gone');
  });

  it('commit, push and status run inside the worktree', () => {
    const { path: wt } = addWorktree('origin', 'main', 'task/work', false, repo);
    fs.writeFileSync(path.join(wt, 'new.txt'), 'n\n');
    assert.equal(hasChanges(wt), true);
    assert.deepEqual(listWorkingTreeChanges(wt), ['new.txt']);
    assert.equal(hasChanges(repo), false);
    assert.equal(hasCommitsAhead('origin', 'main', wt), false);

    assert.equal(addAll(wt), true);
    assert.equal(commit('work', 'task/work', wt), true);
    assert.equal(hasCommitsAhead('origin', 'main', wt), true);
    assert.equal(commit('x', 'main', wt), false); // wrong expected branch
    assert.equal(push('origin', 'task/work', wt), true);
    assert.ok(run(['ls-remote', '--heads', 'origin', 'task/work'], repo).includes('refs/heads/task/work'));
  });

  it('merge helpers operate inside the worktree cwd', () => {
    const { path: wt } = addWorktree('origin', 'main', 'task/merge', false, repo);
    fs.writeFileSync(path.join(wt, 'm.txt'), 'task\n');
    assert.equal(addAll(wt), true);
    assert.equal(commit('task change', 'task/merge', wt), true);

    // Advance main on the remote so the worktree branch is behind.
    const other = path.join(root, 'other');
    run(['clone', remote, other], root);
    run(['config', 'user.email', 'test@test.com'], other);
    run(['config', 'user.name', 'Test'], other);
    fs.writeFileSync(path.join(other, 'base.txt'), 'base\n');
    run(['add', '-A'], other);
    run(['commit', '-m', 'base advance'], other);
    run(['push', 'origin', 'main'], other);

    run(['fetch', 'origin'], repo);
    const check = checkConflictsWithBase('origin', 'main', wt);
    assert.equal(check.behindCommits > 0, true);
    assert.equal(check.clean, true);

    assert.equal(mergeBaseBranch('origin', 'main', wt), true);
    assert.ok(fs.existsSync(path.join(wt, 'base.txt')));
    assert.equal(getCurrentBranch(repo), 'main'); // main checkout untouched

    // Dirty discard stays scoped to the worktree.
    fs.writeFileSync(path.join(wt, 'junk.txt'), 'j');
    assert.equal(discardWorkingChanges(wt), true);
    assert.ok(!fs.existsSync(path.join(wt, 'junk.txt')));
  });

  it('conflict helpers use the worktree cwd', () => {
    const { path: wt } = addWorktree('origin', 'main', 'task/conflict', false, repo);
    fs.writeFileSync(path.join(wt, 'a.txt'), 'task side\n');
    assert.equal(addAll(wt), true);
    assert.equal(commit('task edit', 'task/conflict', wt), true);

    const other = path.join(root, 'other-conflict');
    run(['clone', remote, other], root);
    run(['config', 'user.email', 'test@test.com'], other);
    run(['config', 'user.name', 'Test'], other);
    fs.writeFileSync(path.join(other, 'a.txt'), 'main side\n');
    run(['add', '-A'], other);
    run(['commit', '-m', 'main edit'], other);
    run(['push', 'origin', 'main'], other);

    run(['fetch', 'origin'], repo);
    const check = checkConflictsWithBase('origin', 'main', wt);
    assert.equal(check.clean, false);
    assert.ok(check.conflictFiles.includes('a.txt'));

    assert.equal(mergeBaseBranch('origin', 'main', wt), false);
    const details = getConflictDetails(wt);
    assert.ok(details.includes('a.txt'));
    assert.ok(details.includes('task side') || details.includes('Our version'));

    fs.writeFileSync(path.join(wt, 'a.txt'), 'resolved\n');
    assert.equal(commitMerge('resolve', wt), true);
    assert.equal(getCurrentBranch(wt), 'task/conflict');

    // Abort path: start another conflicting merge then abort.
    fs.writeFileSync(path.join(other, 'a.txt'), 'main again\n');
    run(['add', '-A'], other);
    run(['commit', '-m', 'main again'], other);
    run(['push', 'origin', 'main'], other);
    run(['fetch', 'origin'], repo);
    assert.equal(mergeBaseBranch('origin', 'main', wt), false);
    abortMerge(wt);
    assert.equal(hasChanges(wt), false);
  });

  it('removeWorktree deletes the directory but keeps the branch', () => {
    const { path: wt } = addWorktree('origin', 'main', 'task/rm', false, repo);
    assert.equal(removeWorktree(wt, true, repo), true);
    assert.ok(!fs.existsSync(wt));
    assert.equal(findWorktreeForBranch('task/rm', repo), null);
    assert.ok(run(['branch', '--list', 'task/rm'], repo).includes('task/rm'));
  });

  it('removeWorktree --force removes a dirty worktree', () => {
    const { path: wt } = addWorktree('origin', 'main', 'task/dirty', false, repo);
    fs.writeFileSync(path.join(wt, 'dirty.txt'), 'd');
    assert.equal(removeWorktree(wt, false, repo), false);
    assert.ok(fs.existsSync(wt));
    assert.equal(removeWorktree(wt, true, repo), true);
    assert.ok(!fs.existsSync(wt));
  });

  it('pruneWorktrees drops registrations of vanished directories', () => {
    const { path: wt } = addWorktree('origin', 'main', 'task/prune', false, repo);
    fs.rmSync(wt, { recursive: true, force: true });
    assert.ok(listWorktrees(repo).some((w) => w.branch === 'task/prune'));
    assert.equal(pruneWorktrees(repo), true);
    assert.ok(!listWorktrees(repo).some((w) => w.branch === 'task/prune'));
  });

  it('listWorktrees lists main plus added worktrees', () => {
    addWorktree('origin', 'main', 'task/list', false, repo);
    const list = listWorktrees(repo);
    assert.equal(list.length, 2);
    assert.ok(samePath(list[0].path, repo));
  });

  it('ensureLocalExclude keeps .aidev/worktrees/ out of status', () => {
    assert.equal(ensureLocalExclude(repo), true);
    addWorktree('origin', 'main', 'task/ignored', false, repo);
    assert.equal(hasChanges(repo), false);
    assert.ok(!run(['status', '--porcelain', '-uall'], repo).includes('worktrees'));
    // idempotent
    ensureLocalExclude(repo);
    const exclude = fs.readFileSync(path.join(repo, '.git', 'info', 'exclude'), 'utf8');
    assert.equal(exclude.split('.aidev/worktrees/').length - 1, 1);
  });
});

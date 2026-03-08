import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  slugify,
  isProtectedBranch,
  getCurrentBranch,
  createBranch,
  commit,
  push,
  addAll,
  fetchAndCheckout,
} from '../git';

// ─── slugify ──────────────────────────────────────────────────────────────────

describe('slugify', () => {
  it('lowercases input', () => {
    assert.equal(slugify('FIX LOGIN BUG'), 'fix-login-bug');
  });

  it('replaces spaces with dashes', () => {
    assert.equal(slugify('fix login bug'), 'fix-login-bug');
  });

  it('removes special characters', () => {
    assert.equal(slugify('feat: add @user support!'), 'feat-add-user-support');
  });

  it('collapses multiple separators into one dash', () => {
    assert.equal(slugify('hello---world'), 'hello-world');
  });

  it('strips leading and trailing dashes', () => {
    assert.equal(slugify('---hello---'), 'hello');
  });

  it('truncates to 50 characters', () => {
    assert.equal(slugify('a'.repeat(100)).length, 50);
  });

  it('handles empty string', () => {
    assert.equal(slugify(''), '');
  });

  it('handles string with only special chars', () => {
    assert.equal(slugify('!!!'), '');
  });
});

// ─── isProtectedBranch ────────────────────────────────────────────────────────

describe('isProtectedBranch', () => {
  it('recognizes main as protected', () => {
    assert.equal(isProtectedBranch('main'), true);
  });

  it('recognizes master as protected', () => {
    assert.equal(isProtectedBranch('master'), true);
  });

  it('recognizes develop as protected', () => {
    assert.equal(isProtectedBranch('develop'), true);
  });

  it('recognizes production as protected', () => {
    assert.equal(isProtectedBranch('production'), true);
  });

  it('is case-insensitive', () => {
    assert.equal(isProtectedBranch('MAIN'), true);
    assert.equal(isProtectedBranch('Master'), true);
    assert.equal(isProtectedBranch('DEVELOP'), true);
  });

  it('does not flag feature branches', () => {
    assert.equal(isProtectedBranch('feature/login'), false);
    assert.equal(isProtectedBranch('abc123/fix-bug'), false);
    assert.equal(isProtectedBranch('hotfix/urgent'), false);
  });
});

// ─── Integration tests using temp git repos ───────────────────────────────────

function gitCmd(args: string[], cwd: string): void {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
  }
}

function initRepo(dir: string): void {
  gitCmd(['init', '-b', 'main'], dir);
  gitCmd(['config', 'user.email', 'test@test.com'], dir);
  gitCmd(['config', 'user.name', 'Test'], dir);
  fs.writeFileSync(path.join(dir, 'README.md'), '# test\n');
  gitCmd(['add', '.'], dir);
  gitCmd(['commit', '-m', 'initial commit'], dir);
}

describe('getCurrentBranch (integration)', () => {
  let tmpDir: string;
  let originalCwd: string;

  beforeEach(() => {
    originalCwd = process.cwd();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aidev-git-test-'));
    initRepo(tmpDir);
    process.chdir(tmpDir);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns the current branch name', () => {
    assert.equal(getCurrentBranch(), 'main');
  });

  it('returns the new branch after checkout -b', () => {
    gitCmd(['checkout', '-b', 'feature/test'], tmpDir);
    assert.equal(getCurrentBranch(), 'feature/test');
  });
});

describe('createBranch with expectedBase (integration)', () => {
  let tmpDir: string;
  let originalCwd: string;

  beforeEach(() => {
    originalCwd = process.cwd();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aidev-git-test-'));
    initRepo(tmpDir);
    process.chdir(tmpDir);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('succeeds when on the expected base branch', () => {
    assert.equal(createBranch('task123/fix-bug', 'main'), true);
    assert.equal(getCurrentBranch(), 'task123/fix-bug');
  });

  it('fails when not on the expected base branch', () => {
    gitCmd(['checkout', '-b', 'some-other-branch'], tmpDir);
    assert.equal(createBranch('task123/fix-bug', 'main'), false);
    assert.equal(getCurrentBranch(), 'some-other-branch');
  });

  it('works without expectedBase (backward compatible)', () => {
    assert.equal(createBranch('task123/fix-bug'), true);
    assert.equal(getCurrentBranch(), 'task123/fix-bug');
  });
});

describe('commit with expectedBranch (integration)', () => {
  let tmpDir: string;
  let originalCwd: string;

  beforeEach(() => {
    originalCwd = process.cwd();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aidev-git-test-'));
    initRepo(tmpDir);
    process.chdir(tmpDir);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('succeeds when on the expected branch', () => {
    gitCmd(['checkout', '-b', 'task123/fix-bug'], tmpDir);
    fs.writeFileSync(path.join(tmpDir, 'file.txt'), 'content');
    assert.equal(addAll(), true);
    assert.equal(commit('test commit', 'task123/fix-bug'), true);
  });

  it('fails when on a different branch than expected', () => {
    gitCmd(['checkout', '-b', 'task123/fix-bug'], tmpDir);
    gitCmd(['checkout', '-b', 'wrong-branch'], tmpDir);
    fs.writeFileSync(path.join(tmpDir, 'file.txt'), 'content');
    assert.equal(addAll(), true);
    assert.equal(commit('test commit', 'task123/fix-bug'), false);
  });

  it('refuses to commit when expectedBranch is a protected branch', () => {
    fs.writeFileSync(path.join(tmpDir, 'file.txt'), 'content');
    assert.equal(addAll(), true);
    assert.equal(commit('test commit', 'main'), false);
  });

  it('works without expectedBranch (backward compatible)', () => {
    fs.writeFileSync(path.join(tmpDir, 'file.txt'), 'content');
    assert.equal(addAll(), true);
    assert.equal(commit('test commit'), true);
  });
});

describe('push validation (integration)', () => {
  let tmpDir: string;
  let bareDir: string;
  let originalCwd: string;

  beforeEach(() => {
    originalCwd = process.cwd();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aidev-git-test-'));
    bareDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aidev-bare-'));
    gitCmd(['init', '--bare', '-b', 'main'], bareDir);
    initRepo(tmpDir);
    gitCmd(['remote', 'add', 'origin', bareDir], tmpDir);
    gitCmd(['push', 'origin', 'main'], tmpDir);
    process.chdir(tmpDir);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.rmSync(bareDir, { recursive: true, force: true });
  });

  it('refuses to push to a protected branch', () => {
    assert.equal(push('origin', 'main'), false);
  });

  it('refuses to push when current branch does not match target', () => {
    gitCmd(['checkout', '-b', 'task123/fix-bug'], tmpDir);
    assert.equal(push('origin', 'task456/other-task'), false);
  });

  it('succeeds when current branch matches target and is not protected', () => {
    gitCmd(['checkout', '-b', 'task123/fix-bug'], tmpDir);
    fs.writeFileSync(path.join(tmpDir, 'file.txt'), 'content');
    gitCmd(['add', '.'], tmpDir);
    gitCmd(['commit', '-m', 'add file'], tmpDir);
    assert.equal(push('origin', 'task123/fix-bug'), true);
  });

  it('uses explicit HEAD refspec so stale local branches are not pushed', () => {
    gitCmd(['checkout', '-b', 'task123/fix-bug'], tmpDir);
    fs.writeFileSync(path.join(tmpDir, 'file.txt'), 'v1');
    gitCmd(['add', '.'], tmpDir);
    gitCmd(['commit', '-m', 'v1'], tmpDir);
    assert.equal(push('origin', 'task123/fix-bug'), true);

    fs.writeFileSync(path.join(tmpDir, 'file.txt'), 'v2');
    gitCmd(['add', '.'], tmpDir);
    gitCmd(['commit', '-m', 'v2'], tmpDir);
    assert.equal(push('origin', 'task123/fix-bug'), true);

    const log = spawnSync('git', ['log', '--oneline', 'origin/task123/fix-bug'], {
      cwd: tmpDir,
      encoding: 'utf8',
    });
    assert.ok(log.stdout.includes('v2'));
  });
});

describe('fetchAndCheckout sync verification (integration)', () => {
  let tmpDir: string;
  let bareDir: string;
  let originalCwd: string;

  beforeEach(() => {
    originalCwd = process.cwd();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aidev-git-test-'));
    bareDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aidev-bare-'));
    gitCmd(['init', '--bare', '-b', 'main'], bareDir);
    initRepo(tmpDir);
    gitCmd(['remote', 'add', 'origin', bareDir], tmpDir);
    gitCmd(['push', 'origin', 'main'], tmpDir);
    process.chdir(tmpDir);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.rmSync(bareDir, { recursive: true, force: true });
  });

  it('succeeds when local main matches origin/main', () => {
    gitCmd(['checkout', '-b', 'feature/test'], tmpDir);
    assert.equal(fetchAndCheckout('origin', 'main'), true);
    assert.equal(getCurrentBranch(), 'main');
  });

  it('succeeds when origin has new commits (fast-forward)', () => {
    const cloneDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aidev-clone-'));
    try {
      gitCmd(['clone', bareDir, cloneDir], cloneDir);
      gitCmd(['config', 'user.email', 'other@test.com'], cloneDir);
      gitCmd(['config', 'user.name', 'Other'], cloneDir);
      fs.writeFileSync(path.join(cloneDir, 'new.txt'), 'from clone');
      gitCmd(['add', '.'], cloneDir);
      gitCmd(['commit', '-m', 'remote commit'], cloneDir);
      gitCmd(['push', 'origin', 'main'], cloneDir);
    } finally {
      fs.rmSync(cloneDir, { recursive: true, force: true });
    }

    gitCmd(['checkout', '-b', 'feature/test'], tmpDir);
    assert.equal(fetchAndCheckout('origin', 'main'), true);
    assert.equal(getCurrentBranch(), 'main');
  });

  it('fails when local main has diverged from origin/main', () => {
    const cloneDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aidev-clone-'));
    try {
      gitCmd(['clone', bareDir, cloneDir], cloneDir);
      gitCmd(['config', 'user.email', 'other@test.com'], cloneDir);
      gitCmd(['config', 'user.name', 'Other'], cloneDir);
      fs.writeFileSync(path.join(cloneDir, 'remote.txt'), 'from clone');
      gitCmd(['add', '.'], cloneDir);
      gitCmd(['commit', '-m', 'remote commit'], cloneDir);
      gitCmd(['push', 'origin', 'main'], cloneDir);
    } finally {
      fs.rmSync(cloneDir, { recursive: true, force: true });
    }

    fs.writeFileSync(path.join(tmpDir, 'local.txt'), 'local only');
    gitCmd(['add', '.'], tmpDir);
    gitCmd(['commit', '-m', 'local commit'], tmpDir);

    // pull will create a merge commit, making local ahead of origin/main
    assert.equal(fetchAndCheckout('origin', 'main'), false);
  });
});

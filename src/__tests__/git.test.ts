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
  createBranchFromRemote,
  commit,
  push,
  addAll,
  hasChanges,
  listWorkingTreeChanges,
  stashChanges,
  fetchAndCheckout,
  checkConflictsWithBase,
  mergeBaseBranch,
  abortMerge,
  commitMerge,
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

describe('createBranchFromRemote (integration)', () => {
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

  it('creates a branch from origin/main at the latest remote commit', () => {
    // Push a new commit to origin from a separate clone
    const cloneDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aidev-clone-'));
    try {
      gitCmd(['clone', bareDir, cloneDir], cloneDir);
      gitCmd(['config', 'user.email', 'other@test.com'], cloneDir);
      gitCmd(['config', 'user.name', 'Other'], cloneDir);
      fs.writeFileSync(path.join(cloneDir, 'new.txt'), 'remote commit');
      gitCmd(['add', '.'], cloneDir);
      gitCmd(['commit', '-m', 'remote commit'], cloneDir);
      gitCmd(['push', 'origin', 'main'], cloneDir);
    } finally {
      fs.rmSync(cloneDir, { recursive: true, force: true });
    }

    assert.equal(createBranchFromRemote('origin', 'main', 'task123/fix-bug'), true);
    assert.equal(getCurrentBranch(), 'task123/fix-bug');
    // The new branch should contain the remote commit's file
    assert.ok(fs.existsSync(path.join(tmpDir, 'new.txt')));
  });

  it('does not require the local base branch to be checked out', () => {
    gitCmd(['checkout', '-b', 'some-other-branch'], tmpDir);
    assert.equal(getCurrentBranch(), 'some-other-branch');
    assert.equal(createBranchFromRemote('origin', 'main', 'task456/new-feature'), true);
    assert.equal(getCurrentBranch(), 'task456/new-feature');
  });

  it('stashes dirty changes before creating the branch', () => {
    fs.writeFileSync(path.join(tmpDir, 'dirty.txt'), 'uncommitted');
    assert.equal(hasChanges(), true);
    assert.equal(createBranchFromRemote('origin', 'main', 'task789/clean-start'), true);
    assert.equal(getCurrentBranch(), 'task789/clean-start');
  });

  it('branches from the remote ref, not the local base branch', () => {
    // Push a new commit to origin from a separate clone
    const cloneDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aidev-clone-'));
    try {
      gitCmd(['clone', bareDir, cloneDir], cloneDir);
      gitCmd(['config', 'user.email', 'other@test.com'], cloneDir);
      gitCmd(['config', 'user.name', 'Other'], cloneDir);
      fs.writeFileSync(path.join(cloneDir, 'remote-only.txt'), 'only on remote');
      gitCmd(['add', '.'], cloneDir);
      gitCmd(['commit', '-m', 'remote-only commit'], cloneDir);
      gitCmd(['push', 'origin', 'main'], cloneDir);
    } finally {
      fs.rmSync(cloneDir, { recursive: true, force: true });
    }

    // Local main is behind origin/main — don't pull
    assert.equal(createBranchFromRemote('origin', 'main', 'task999/from-remote'), true);
    assert.equal(getCurrentBranch(), 'task999/from-remote');
    // Branch should have the remote commit even though local main doesn't
    assert.ok(fs.existsSync(path.join(tmpDir, 'remote-only.txt')));
  });

  it('fails when the remote base branch does not exist', () => {
    assert.equal(createBranchFromRemote('origin', 'nonexistent', 'task000/bad'), false);
  });

  it('falls back to checking out existing branch when checkout -b fails (pending task follow-up)', () => {
    // Simulate the pending-task scenario: branch already exists on the remote
    // because a previous run created it. A follow-up comment triggers another run
    // which calls createBranchFromRemote again — checkout -b fails because
    // the branch already exists, so it should fallback to fetchAndCheckoutBranch.
    gitCmd(['checkout', '-b', 'task123/existing-branch'], tmpDir);
    fs.writeFileSync(path.join(tmpDir, 'work.txt'), 'previous work');
    gitCmd(['add', '.'], tmpDir);
    gitCmd(['commit', '-m', 'work on existing branch'], tmpDir);
    gitCmd(['push', 'origin', 'task123/existing-branch'], tmpDir);

    // Switch back to main so we're not already on the target branch
    gitCmd(['checkout', 'main'], tmpDir);

    // Now createBranchFromRemote should fail on checkout -b (branch exists)
    // but succeed by falling back to checking out the existing branch
    assert.equal(createBranchFromRemote('origin', 'main', 'task123/existing-branch'), true);
    assert.equal(getCurrentBranch(), 'task123/existing-branch');
    // Should have the file from the existing branch
    assert.ok(fs.existsSync(path.join(tmpDir, 'work.txt')));
  });

  it('falls back and picks up new remote commits on existing branch', () => {
    // Create the branch, push it, then switch away — keep local branch alive
    // so checkout -b will fail and trigger the fallback path
    gitCmd(['checkout', '-b', 'task456/followup'], tmpDir);
    fs.writeFileSync(path.join(tmpDir, 'v1.txt'), 'first version');
    gitCmd(['add', '.'], tmpDir);
    gitCmd(['commit', '-m', 'v1'], tmpDir);
    gitCmd(['push', 'origin', 'task456/followup'], tmpDir);
    gitCmd(['checkout', 'main'], tmpDir);

    // Push a new commit to that branch from a separate clone
    const cloneDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aidev-clone-'));
    try {
      gitCmd(['clone', bareDir, cloneDir], cloneDir);
      gitCmd(['config', 'user.email', 'other@test.com'], cloneDir);
      gitCmd(['config', 'user.name', 'Other'], cloneDir);
      gitCmd(['checkout', 'task456/followup'], cloneDir);
      fs.writeFileSync(path.join(cloneDir, 'v2.txt'), 'second version');
      gitCmd(['add', '.'], cloneDir);
      gitCmd(['commit', '-m', 'v2'], cloneDir);
      gitCmd(['push', 'origin', 'task456/followup'], cloneDir);
    } finally {
      fs.rmSync(cloneDir, { recursive: true, force: true });
    }

    // checkout -b fails (branch exists locally), fallback checks out + pulls
    assert.equal(createBranchFromRemote('origin', 'main', 'task456/followup'), true);
    assert.equal(getCurrentBranch(), 'task456/followup');
    // Should have both the original and the new remote commit's files
    assert.ok(fs.existsSync(path.join(tmpDir, 'v1.txt')));
    assert.ok(fs.existsSync(path.join(tmpDir, 'v2.txt')));
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

describe('listWorkingTreeChanges (integration)', () => {
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

  it('returns an empty array when the working tree is clean', () => {
    assert.deepEqual(listWorkingTreeChanges(), []);
  });

  it('returns paths for modified tracked files', () => {
    fs.writeFileSync(path.join(tmpDir, 'README.md'), '# modified\n');
    assert.deepEqual(listWorkingTreeChanges(), ['README.md']);
  });

  it('returns paths for untracked files', () => {
    fs.writeFileSync(path.join(tmpDir, 'new-file.txt'), 'new content');
    assert.deepEqual(listWorkingTreeChanges(), ['new-file.txt']);
  });

  it('returns multiple paths when several files are dirty', () => {
    fs.writeFileSync(path.join(tmpDir, 'README.md'), '# modified\n');
    fs.writeFileSync(path.join(tmpDir, 'another.txt'), 'another');
    assert.deepEqual(listWorkingTreeChanges().sort(), ['README.md', 'another.txt']);
  });
});

describe('stashChanges (integration)', () => {
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

  it('returns true and does nothing when working tree is clean', () => {
    assert.equal(hasChanges(), false);
    assert.equal(stashChanges(), true);
    assert.equal(hasChanges(), false);
  });

  it('stashes uncommitted changes so working tree is clean afterward', () => {
    fs.writeFileSync(path.join(tmpDir, 'dirty.txt'), 'uncommitted');
    assert.equal(hasChanges(), true);
    assert.equal(stashChanges(), true);
    assert.equal(hasChanges(), false);
  });

  it('stashes untracked files (using -u flag)', () => {
    fs.writeFileSync(path.join(tmpDir, 'untracked.txt'), 'new file');
    assert.equal(hasChanges(), true);
    assert.equal(stashChanges(), true);
    assert.equal(hasChanges(), false);
  });
});

describe('fetchAndCheckout with dirty working tree (integration)', () => {
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

  it('succeeds even when there are uncommitted changes (stashes them)', () => {
    gitCmd(['checkout', '-b', 'feature/dirty'], tmpDir);
    fs.writeFileSync(path.join(tmpDir, 'leftover.txt'), 'from previous run');
    assert.equal(hasChanges(), true);
    assert.equal(fetchAndCheckout('origin', 'main'), true);
    assert.equal(getCurrentBranch(), 'main');
  });

  it('succeeds even when there are untracked files (stashes them)', () => {
    fs.writeFileSync(path.join(tmpDir, 'untracked.txt'), 'untracked');
    assert.equal(hasChanges(), true);
    assert.equal(fetchAndCheckout('origin', 'main'), true);
    assert.equal(getCurrentBranch(), 'main');
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

// ─── checkConflictsWithBase (integration) ─────────────────────────────────────

describe('checkConflictsWithBase (integration)', () => {
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

  it('reports clean when branch is up to date with base', () => {
    gitCmd(['checkout', '-b', 'feature/test'], tmpDir);
    fs.writeFileSync(path.join(tmpDir, 'feature.txt'), 'new file');
    gitCmd(['add', '.'], tmpDir);
    gitCmd(['commit', '-m', 'feature commit'], tmpDir);
    gitCmd(['fetch', 'origin'], tmpDir);

    const result = checkConflictsWithBase('origin', 'main');
    assert.equal(result.clean, true);
    assert.equal(result.behindCommits, 0);
    assert.deepEqual(result.conflictFiles, []);
  });

  it('reports clean when base has new non-conflicting commits', () => {
    gitCmd(['checkout', '-b', 'feature/test'], tmpDir);
    fs.writeFileSync(path.join(tmpDir, 'feature.txt'), 'new file');
    gitCmd(['add', '.'], tmpDir);
    gitCmd(['commit', '-m', 'feature commit'], tmpDir);

    // Add a non-conflicting commit to main via bare repo
    const cloneDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aidev-clone-'));
    try {
      gitCmd(['clone', bareDir, cloneDir], cloneDir);
      gitCmd(['config', 'user.email', 'other@test.com'], cloneDir);
      gitCmd(['config', 'user.name', 'Other'], cloneDir);
      fs.writeFileSync(path.join(cloneDir, 'other.txt'), 'no conflict');
      gitCmd(['add', '.'], cloneDir);
      gitCmd(['commit', '-m', 'main commit'], cloneDir);
      gitCmd(['push', 'origin', 'main'], cloneDir);
    } finally {
      fs.rmSync(cloneDir, { recursive: true, force: true });
    }

    gitCmd(['fetch', 'origin'], tmpDir);
    const result = checkConflictsWithBase('origin', 'main');
    assert.equal(result.clean, true);
    assert.ok(result.behindCommits > 0);
    assert.deepEqual(result.conflictFiles, []);
  });

  it('detects conflicts when base and branch modify the same file', () => {
    gitCmd(['checkout', '-b', 'feature/test'], tmpDir);
    fs.writeFileSync(path.join(tmpDir, 'README.md'), '# feature change\n');
    gitCmd(['add', '.'], tmpDir);
    gitCmd(['commit', '-m', 'feature commit'], tmpDir);

    const cloneDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aidev-clone-'));
    try {
      gitCmd(['clone', bareDir, cloneDir], cloneDir);
      gitCmd(['config', 'user.email', 'other@test.com'], cloneDir);
      gitCmd(['config', 'user.name', 'Other'], cloneDir);
      fs.writeFileSync(path.join(cloneDir, 'README.md'), '# main change\n');
      gitCmd(['add', '.'], cloneDir);
      gitCmd(['commit', '-m', 'main commit'], cloneDir);
      gitCmd(['push', 'origin', 'main'], cloneDir);
    } finally {
      fs.rmSync(cloneDir, { recursive: true, force: true });
    }

    gitCmd(['fetch', 'origin'], tmpDir);
    const result = checkConflictsWithBase('origin', 'main');
    assert.equal(result.clean, false);
    assert.ok(result.conflictFiles.includes('README.md'));
  });

  it('leaves working tree clean after conflict detection (aborts trial merge)', () => {
    gitCmd(['checkout', '-b', 'feature/test'], tmpDir);
    fs.writeFileSync(path.join(tmpDir, 'README.md'), '# feature\n');
    gitCmd(['add', '.'], tmpDir);
    gitCmd(['commit', '-m', 'feature'], tmpDir);

    const cloneDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aidev-clone-'));
    try {
      gitCmd(['clone', bareDir, cloneDir], cloneDir);
      gitCmd(['config', 'user.email', 'other@test.com'], cloneDir);
      gitCmd(['config', 'user.name', 'Other'], cloneDir);
      fs.writeFileSync(path.join(cloneDir, 'README.md'), '# main\n');
      gitCmd(['add', '.'], cloneDir);
      gitCmd(['commit', '-m', 'main'], cloneDir);
      gitCmd(['push', 'origin', 'main'], cloneDir);
    } finally {
      fs.rmSync(cloneDir, { recursive: true, force: true });
    }

    gitCmd(['fetch', 'origin'], tmpDir);
    checkConflictsWithBase('origin', 'main');

    // Should be back on feature branch with no merge in progress
    assert.equal(getCurrentBranch(), 'feature/test');
    assert.equal(hasChanges(), false);
  });
});

// ─── mergeBaseBranch + commitMerge (integration) ─────────────────────────────

describe('mergeBaseBranch and commitMerge (integration)', () => {
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

  it('merges cleanly when there are no conflicts', () => {
    gitCmd(['checkout', '-b', 'feature/test'], tmpDir);
    fs.writeFileSync(path.join(tmpDir, 'feature.txt'), 'new file');
    gitCmd(['add', '.'], tmpDir);
    gitCmd(['commit', '-m', 'feature commit'], tmpDir);

    const cloneDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aidev-clone-'));
    try {
      gitCmd(['clone', bareDir, cloneDir], cloneDir);
      gitCmd(['config', 'user.email', 'other@test.com'], cloneDir);
      gitCmd(['config', 'user.name', 'Other'], cloneDir);
      fs.writeFileSync(path.join(cloneDir, 'other.txt'), 'no conflict');
      gitCmd(['add', '.'], cloneDir);
      gitCmd(['commit', '-m', 'main commit'], cloneDir);
      gitCmd(['push', 'origin', 'main'], cloneDir);
    } finally {
      fs.rmSync(cloneDir, { recursive: true, force: true });
    }

    gitCmd(['fetch', 'origin'], tmpDir);
    assert.equal(mergeBaseBranch('origin', 'main'), true);
    assert.ok(fs.existsSync(path.join(tmpDir, 'other.txt')));
  });

  it('returns false when there are conflicts, and abortMerge restores state', () => {
    gitCmd(['checkout', '-b', 'feature/test'], tmpDir);
    fs.writeFileSync(path.join(tmpDir, 'README.md'), '# feature\n');
    gitCmd(['add', '.'], tmpDir);
    gitCmd(['commit', '-m', 'feature'], tmpDir);

    const cloneDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aidev-clone-'));
    try {
      gitCmd(['clone', bareDir, cloneDir], cloneDir);
      gitCmd(['config', 'user.email', 'other@test.com'], cloneDir);
      gitCmd(['config', 'user.name', 'Other'], cloneDir);
      fs.writeFileSync(path.join(cloneDir, 'README.md'), '# main\n');
      gitCmd(['add', '.'], cloneDir);
      gitCmd(['commit', '-m', 'main'], cloneDir);
      gitCmd(['push', 'origin', 'main'], cloneDir);
    } finally {
      fs.rmSync(cloneDir, { recursive: true, force: true });
    }

    gitCmd(['fetch', 'origin'], tmpDir);
    assert.equal(mergeBaseBranch('origin', 'main'), false);

    abortMerge();
    assert.equal(getCurrentBranch(), 'feature/test');
    assert.equal(hasChanges(), false);
  });

  it('commitMerge completes a conflicted merge after manual resolution', () => {
    gitCmd(['checkout', '-b', 'feature/test'], tmpDir);
    fs.writeFileSync(path.join(tmpDir, 'README.md'), '# feature\n');
    gitCmd(['add', '.'], tmpDir);
    gitCmd(['commit', '-m', 'feature'], tmpDir);

    const cloneDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aidev-clone-'));
    try {
      gitCmd(['clone', bareDir, cloneDir], cloneDir);
      gitCmd(['config', 'user.email', 'other@test.com'], cloneDir);
      gitCmd(['config', 'user.name', 'Other'], cloneDir);
      fs.writeFileSync(path.join(cloneDir, 'README.md'), '# main\n');
      gitCmd(['add', '.'], cloneDir);
      gitCmd(['commit', '-m', 'main'], cloneDir);
      gitCmd(['push', 'origin', 'main'], cloneDir);
    } finally {
      fs.rmSync(cloneDir, { recursive: true, force: true });
    }

    gitCmd(['fetch', 'origin'], tmpDir);
    mergeBaseBranch('origin', 'main');

    // Manually resolve the conflict
    fs.writeFileSync(path.join(tmpDir, 'README.md'), '# merged\n');
    assert.equal(commitMerge('Merge main into feature'), true);
    assert.equal(hasChanges(), false);
  });
});

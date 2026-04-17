import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { getRemoteUrl, isGitHubRemote, isGhInstalled, filterUnresolvedByNonAidev } from '../github';
import type { ReviewThread } from '../github';
import { tryCreatePR, buildPRUrl } from '../commands/run';
import { printGhSuggestion } from '../commands/init';
import type { Config, Task } from '../types';

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

// ─── getRemoteUrl ────────────────────────────────────────────────────────────

describe('getRemoteUrl', () => {
  let tmpDir: string;
  let originalCwd: string;

  beforeEach(() => {
    originalCwd = process.cwd();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aidev-gh-test-'));
    initRepo(tmpDir);
    process.chdir(tmpDir);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns the remote URL for a valid remote', () => {
    gitCmd(['remote', 'add', 'origin', 'https://github.com/owner/repo.git'], tmpDir);
    assert.equal(getRemoteUrl('origin'), 'https://github.com/owner/repo.git');
  });

  it('returns empty string for a nonexistent remote', () => {
    assert.equal(getRemoteUrl('nonexistent'), '');
  });

  it('returns SSH URL for SSH remotes', () => {
    gitCmd(['remote', 'add', 'origin', 'git@github.com:owner/repo.git'], tmpDir);
    assert.equal(getRemoteUrl('origin'), 'git@github.com:owner/repo.git');
  });
});

// ─── isGitHubRemote ──────────────────────────────────────────────────────────

describe('isGitHubRemote', () => {
  let tmpDir: string;
  let originalCwd: string;

  beforeEach(() => {
    originalCwd = process.cwd();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aidev-gh-test-'));
    initRepo(tmpDir);
    process.chdir(tmpDir);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns true for HTTPS GitHub remote', () => {
    gitCmd(['remote', 'add', 'origin', 'https://github.com/owner/repo.git'], tmpDir);
    assert.equal(isGitHubRemote('origin'), true);
  });

  it('returns true for SSH GitHub remote', () => {
    gitCmd(['remote', 'add', 'origin', 'git@github.com:owner/repo.git'], tmpDir);
    assert.equal(isGitHubRemote('origin'), true);
  });

  it('returns false for non-GitHub remote', () => {
    gitCmd(['remote', 'add', 'origin', 'https://gitlab.com/owner/repo.git'], tmpDir);
    assert.equal(isGitHubRemote('origin'), false);
  });

  it('returns false for nonexistent remote', () => {
    assert.equal(isGitHubRemote('nonexistent'), false);
  });
});

// ─── isGhInstalled ───────────────────────────────────────────────────────────

describe('isGhInstalled', () => {
  it('returns a boolean', () => {
    const result = isGhInstalled();
    assert.equal(typeof result, 'boolean');
  });
});

// ─── tryCreatePR ─────────────────────────────────────────────────────────────

describe('tryCreatePR', () => {
  let tmpDir: string;
  let originalCwd: string;

  const baseConfig = {
    gitRemote: 'origin',
    githubBaseBranch: 'main',
    githubRepo: 'owner/repo',
    clickupInReviewStatus: 'review',
  } as Config;

  const task: Task = {
    id: 'abc123',
    name: 'Fix bug',
    description: 'Fix the login bug',
    status: 'open',
    url: 'https://app.clickup.com/t/abc123',
    tags: ['myproject'],
  };

  beforeEach(() => {
    originalCwd = process.cwd();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aidev-gh-test-'));
    initRepo(tmpDir);
    process.chdir(tmpDir);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('falls back to compare URL when remote is not GitHub', () => {
    gitCmd(['remote', 'add', 'origin', 'https://gitlab.com/owner/repo.git'], tmpDir);
    const url = tryCreatePR(baseConfig, 'abc123/fix-bug', task);
    assert.ok(url.includes('github.com/owner/repo/compare/'));
  });

  it('falls back to compare URL when no remote exists', () => {
    const url = tryCreatePR(baseConfig, 'abc123/fix-bug', task);
    assert.ok(url.includes('github.com/owner/repo/compare/'));
  });

  it('returns empty string when githubRepo is not configured and gh is not available', () => {
    const url = tryCreatePR({ ...baseConfig, githubRepo: '' }, 'abc123/fix-bug', task);
    assert.equal(url, '');
  });
});

// ─── printGhSuggestion ──────────────────────────────────────────────────────

describe('printGhSuggestion', () => {
  let tmpDir: string;
  let originalCwd: string;

  beforeEach(() => {
    originalCwd = process.cwd();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aidev-gh-test-'));
    initRepo(tmpDir);
    process.chdir(tmpDir);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('does not print anything for non-GitHub remotes', () => {
    gitCmd(['remote', 'add', 'origin', 'https://gitlab.com/owner/repo.git'], tmpDir);
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: unknown[]) => { logs.push(args.join(' ')); };
    try {
      printGhSuggestion('origin');
      assert.equal(logs.length, 0);
    } finally {
      console.log = origLog;
    }
  });

  it('prints suggestion for GitHub remote', () => {
    gitCmd(['remote', 'add', 'origin', 'https://github.com/owner/repo.git'], tmpDir);
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: unknown[]) => { logs.push(args.join(' ')); };
    try {
      printGhSuggestion('origin');
      const output = logs.join('\n');
      assert.ok(output.includes('gh'));
    } finally {
      console.log = origLog;
    }
  });
});

// ─── filterUnresolvedByNonAidev ─────────────────────────────────────────────

describe('filterUnresolvedByNonAidev', () => {
  const prefix = '🤖 **aidev**';

  const makeThread = (id: string, comments: Array<{ body: string; author: string }>): ReviewThread => ({
    id,
    path: 'src/index.ts',
    line: 1,
    comments,
  });

  it('keeps threads where last comment is not from aidev', () => {
    const threads = [
      makeThread('t1', [
        { body: 'Please fix this', author: 'reviewer' },
      ]),
    ];
    const result = filterUnresolvedByNonAidev(threads, prefix);
    assert.equal(result.length, 1);
    assert.equal(result[0].id, 't1');
  });

  it('filters out threads where last comment starts with commentPrefix', () => {
    const threads = [
      makeThread('t1', [
        { body: 'Please fix this', author: 'reviewer' },
        { body: `${prefix} I've fixed this in commit abc123`, author: 'aidev-bot' },
      ]),
    ];
    const result = filterUnresolvedByNonAidev(threads, prefix);
    assert.equal(result.length, 0);
  });

  it('keeps threads where aidev commented but a human replied after', () => {
    const threads = [
      makeThread('t1', [
        { body: 'Please fix this', author: 'reviewer' },
        { body: `${prefix} Done`, author: 'aidev-bot' },
        { body: 'Actually this is still wrong', author: 'reviewer' },
      ]),
    ];
    const result = filterUnresolvedByNonAidev(threads, prefix);
    assert.equal(result.length, 1);
  });

  it('returns empty array when all threads are aidev-last', () => {
    const threads = [
      makeThread('t1', [{ body: `${prefix} Fixed`, author: 'bot' }]),
      makeThread('t2', [{ body: `${prefix} Replied`, author: 'bot' }]),
    ];
    const result = filterUnresolvedByNonAidev(threads, prefix);
    assert.equal(result.length, 0);
  });

  it('keeps threads with no comments', () => {
    const threads = [makeThread('t1', [])];
    const result = filterUnresolvedByNonAidev(threads, prefix);
    assert.equal(result.length, 1);
  });

  it('handles mixed threads correctly', () => {
    const threads = [
      makeThread('t1', [{ body: 'Fix this', author: 'human' }]),
      makeThread('t2', [{ body: `${prefix} Done`, author: 'bot' }]),
      makeThread('t3', [{ body: 'Another issue', author: 'human' }]),
    ];
    const result = filterUnresolvedByNonAidev(threads, prefix);
    assert.equal(result.length, 2);
    assert.deepEqual(result.map((t) => t.id), ['t1', 't3']);
  });
});

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  detectAidevAssetsGitignoreIssues,
  hasAidevAssetsGitignoreIssues,
  prepareForTaskCommit,
} from '../assetsGitignore';
import { isAidevAssetsGitignored } from '../commands/init';
import { listIndexedPaths } from '../git';

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

describe('isAidevAssetsGitignored', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aidev-assets-gitignore-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns false when .gitignore is missing', () => {
    assert.equal(isAidevAssetsGitignored(tmpDir), false);
  });

  it('returns true when .aidev/assets/ is present', () => {
    fs.writeFileSync(path.join(tmpDir, '.gitignore'), 'node_modules/\n.aidev/assets/\n');
    assert.equal(isAidevAssetsGitignored(tmpDir), true);
  });

  it('returns false for legacy .aidev/ until ensureGitignore rewrites it', () => {
    fs.writeFileSync(path.join(tmpDir, '.gitignore'), '.aidev/\n');
    assert.equal(isAidevAssetsGitignored(tmpDir), false);
  });
});

describe('detectAidevAssetsGitignoreIssues', () => {
  let tmpDir: string;
  let originalCwd: string;

  beforeEach(() => {
    originalCwd = process.cwd();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aidev-assets-gitignore-'));
    initRepo(tmpDir);
    process.chdir(tmpDir);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('reports no issues when assets are gitignored and not indexed', () => {
    fs.writeFileSync(path.join(tmpDir, '.gitignore'), '.aidev/assets/\n');
    const assetsDir = path.join(tmpDir, '.aidev', 'assets', 'task-1');
    fs.mkdirSync(assetsDir, { recursive: true });
    fs.writeFileSync(path.join(assetsDir, 'file.txt'), 'local only');

    const state = detectAidevAssetsGitignoreIssues(tmpDir);
    assert.equal(hasAidevAssetsGitignoreIssues(state), false);
    assert.deepEqual(state.indexedFiles, []);
  });

  it('reports missing gitignore', () => {
    const state = detectAidevAssetsGitignoreIssues(tmpDir);
    assert.equal(state.missingGitignore, true);
    assert.equal(hasAidevAssetsGitignoreIssues(state), true);
  });

  it('reports indexed asset files', () => {
    fs.writeFileSync(path.join(tmpDir, '.gitignore'), '.aidev/assets/\n');
    const assetsDir = path.join(tmpDir, '.aidev', 'assets', 'task-1');
    fs.mkdirSync(assetsDir, { recursive: true });
    fs.writeFileSync(path.join(assetsDir, 'tracked.txt'), 'tracked');
    gitCmd(['add', '-f', '.aidev/assets/task-1/tracked.txt'], tmpDir);

    const indexed = listIndexedPaths('.aidev/assets/', tmpDir);
    assert.deepEqual(indexed, ['.aidev/assets/task-1/tracked.txt']);

    const state = detectAidevAssetsGitignoreIssues(tmpDir);
    assert.equal(state.missingGitignore, false);
    assert.deepEqual(state.indexedFiles, ['.aidev/assets/task-1/tracked.txt']);
    assert.equal(hasAidevAssetsGitignoreIssues(state), true);
  });
});

describe('prepareForTaskCommit (integration)', () => {
  let tmpDir: string;
  let originalCwd: string;
  const branchName = 'task-1/fix-assets';
  const commitPrefix = '[aidev]';

  beforeEach(() => {
    originalCwd = process.cwd();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aidev-assets-gitignore-'));
    initRepo(tmpDir);
    gitCmd(['checkout', '-b', branchName], tmpDir);
    process.chdir(tmpDir);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('removes tracked assets and commits deletion plus gitignore update', () => {
    const assetsDir = path.join(tmpDir, '.aidev', 'assets', 'task-1');
    fs.mkdirSync(assetsDir, { recursive: true });
    fs.writeFileSync(path.join(assetsDir, 'tracked.txt'), 'tracked');
    gitCmd(['add', '-f', '.aidev/assets/task-1/tracked.txt'], tmpDir);
    gitCmd(['commit', '-m', 'accidentally commit assets'], tmpDir);

    assert.equal(fs.existsSync(assetsDir), true);
    assert.equal(prepareForTaskCommit(branchName, commitPrefix, tmpDir), true);
    assert.equal(fs.existsSync(assetsDir), false);
    assert.deepEqual(listIndexedPaths('.aidev/assets/', tmpDir), []);
    assert.equal(isAidevAssetsGitignored(tmpDir), true);

    const log = spawnSync('git', ['log', '--oneline', '-2'], { cwd: tmpDir, encoding: 'utf8' });
    assert.match(log.stdout, /Ignore \.aidev\/assets\//);
    assert.match(log.stdout, /Remove \.aidev\/assets from repository/);
  });

  it('deletes local assets and commits gitignore when rule is missing', () => {
    const assetsDir = path.join(tmpDir, '.aidev', 'assets', 'task-2');
    fs.mkdirSync(assetsDir, { recursive: true });
    fs.writeFileSync(path.join(assetsDir, 'local.txt'), 'local');

    assert.equal(prepareForTaskCommit(branchName, commitPrefix, tmpDir), true);
    assert.equal(fs.existsSync(assetsDir), false);
    assert.equal(isAidevAssetsGitignored(tmpDir), true);

    const log = spawnSync('git', ['log', '--oneline', '-1'], { cwd: tmpDir, encoding: 'utf8' });
    assert.match(log.stdout, /Ignore \.aidev\/assets\//);
    assert.doesNotMatch(log.stdout, /Remove \.aidev\/assets from repository/);
  });

  it('is a no-op when assets are already gitignored and not indexed', () => {
    fs.writeFileSync(path.join(tmpDir, '.gitignore'), '.aidev/assets/\n');
    const assetsDir = path.join(tmpDir, '.aidev', 'assets', 'task-3');
    fs.mkdirSync(assetsDir, { recursive: true });
    fs.writeFileSync(path.join(assetsDir, 'local.txt'), 'local');

    const before = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: tmpDir, encoding: 'utf8' }).stdout.trim();
    assert.equal(prepareForTaskCommit(branchName, commitPrefix, tmpDir), true);
    const after = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: tmpDir, encoding: 'utf8' }).stdout.trim();
    assert.equal(before, after);
    assert.equal(fs.existsSync(path.join(assetsDir, 'local.txt')), true);
  });
});

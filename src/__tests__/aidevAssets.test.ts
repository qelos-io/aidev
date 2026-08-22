import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  assetsRootRelPath,
  taskAssetsRelPath,
  taskAssetsDir,
  listTaskAssetFiles,
  getExistingAssetDirs,
  secretsFileRelPath,
} from '../aidevAssets';

describe('aidevAssets path helpers', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aidev-assets-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns stable relative path constants', () => {
    assert.equal(assetsRootRelPath(), path.join('.aidev', 'assets'));
    assert.equal(taskAssetsRelPath('task-1'), path.join('.aidev', 'assets', 'task-1'));
    assert.equal(secretsFileRelPath('task-1'), path.join('.aidev', 'assets', 'secrets', 'task-task-1.secrets'));
  });

  it('sanitizes unsafe task ids for task asset paths', () => {
    const unsafeId = 'task/with:bad|name';
    assert.equal(taskAssetsRelPath(unsafeId), path.join('.aidev', 'assets', 'task-with-bad-name'));
    assert.equal(taskAssetsDir(unsafeId, tmpDir), path.join(tmpDir, '.aidev', 'assets', 'task-with-bad-name'));
  });

  it('returns empty lists when asset directories are missing', () => {
    assert.deepEqual(listTaskAssetFiles('missing-task', tmpDir), []);
    assert.deepEqual(getExistingAssetDirs('missing-task', tmpDir), []);
  });

  it('lists downloaded fixture files with forward slashes', () => {
    const taskId = 'task-42';
    const taskDir = path.join(tmpDir, '.aidev', 'assets', taskId);
    fs.mkdirSync(path.join(taskDir, 'nested'), { recursive: true });
    fs.writeFileSync(path.join(taskDir, 'screenshot.png'), 'png', 'utf8');
    fs.writeFileSync(path.join(taskDir, 'nested', 'spec.txt'), 'text', 'utf8');

    const files = listTaskAssetFiles(taskId, tmpDir);
    assert.deepEqual(files, [
      '.aidev/assets/task-42/nested/spec.txt',
      '.aidev/assets/task-42/screenshot.png',
    ]);
  });

  it('excludes secrets subdirectories under the task folder', () => {
    const taskId = 'task-secrets';
    const taskDir = path.join(tmpDir, '.aidev', 'assets', taskId);
    fs.mkdirSync(path.join(taskDir, 'secrets'), { recursive: true });
    fs.writeFileSync(path.join(taskDir, 'visible.txt'), 'ok', 'utf8');
    fs.writeFileSync(path.join(taskDir, 'secrets', 'hidden.txt'), 'secret', 'utf8');

    const files = listTaskAssetFiles(taskId, tmpDir);
    assert.deepEqual(files, ['.aidev/assets/task-secrets/visible.txt']);
  });

  it('returns existing asset root and task directories as absolute paths', () => {
    const taskId = 'task-99';
    const rootDir = path.join(tmpDir, '.aidev', 'assets');
    const taskDir = path.join(rootDir, taskId);
    fs.mkdirSync(taskDir, { recursive: true });

    assert.deepEqual(getExistingAssetDirs(taskId, tmpDir), [rootDir, taskDir]);
  });

  it('returns only the asset root when the task directory is missing', () => {
    const rootDir = path.join(tmpDir, '.aidev', 'assets');
    fs.mkdirSync(rootDir, { recursive: true });

    assert.deepEqual(getExistingAssetDirs('no-task-dir', tmpDir), [rootDir]);
  });
});

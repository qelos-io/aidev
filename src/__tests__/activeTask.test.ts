import { describe, it, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  activeTaskPath,
  ACTIVE_TASK_FILENAME,
  writeActiveTask,
  readActiveTaskFile,
  readActiveTask,
  clearActiveTask,
} from '../activeTask';
import { acquireLock, releaseLock, lockfilePath } from '../lockfile';

let tmpDir: string;

before(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aidev-active-task-'));
});

afterEach(() => {
  try { fs.unlinkSync(activeTaskPath(tmpDir)); } catch { /* ok */ }
  try { fs.unlinkSync(lockfilePath(tmpDir)); } catch { /* ok */ }
});

after(() => {
  try { fs.rmdirSync(tmpDir); } catch { /* ok */ }
});

describe('activeTaskPath', () => {
  it('returns path ending with ACTIVE_TASK_FILENAME inside cwd', () => {
    assert.equal(activeTaskPath('/some/dir'), path.join('/some/dir', ACTIVE_TASK_FILENAME));
  });
});

describe('writeActiveTask / readActiveTaskFile', () => {
  it('round-trips a task id', () => {
    writeActiveTask(tmpDir, 'CU-123');
    assert.equal(readActiveTaskFile(tmpDir), 'CU-123');
  });

  it('trims whitespace on write', () => {
    writeActiveTask(tmpDir, '  CU-456  ');
    assert.equal(readActiveTaskFile(tmpDir), 'CU-456');
  });
});

describe('readActiveTask', () => {
  it('returns null when lock is absent', () => {
    writeActiveTask(tmpDir, 'CU-1');
    assert.equal(readActiveTask(tmpDir), null);
  });

  it('returns task id when lock is held by a live process', () => {
    assert.ok(acquireLock(tmpDir));
    writeActiveTask(tmpDir, 'CU-live');
    assert.equal(readActiveTask(tmpDir), 'CU-live');
    releaseLock(tmpDir);
  });

  it('clears stale active file when lock pid is dead', () => {
    fs.writeFileSync(lockfilePath(tmpDir), '999999999', 'utf8');
    writeActiveTask(tmpDir, 'CU-stale');
    assert.equal(readActiveTask(tmpDir), null);
    assert.equal(readActiveTaskFile(tmpDir), null);
  });
});

describe('clearActiveTask', () => {
  it('removes the file when present', () => {
    writeActiveTask(tmpDir, 'CU-x');
    clearActiveTask(tmpDir);
    assert.equal(readActiveTaskFile(tmpDir), null);
  });
});

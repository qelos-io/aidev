import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { cleanupBookkeeping, registerBookkeepingCleanup } from '../bookkeeping';
import { lockfilePath } from '../lockfile';
import { activeTaskPath, writeActiveTask } from '../activeTask';

let tmpDir: string;
const OTHER_PID = process.pid + 100000;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aidev-bookkeeping-'));
});
afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('cleanupBookkeeping', () => {
  it('removes both files owned by the current PID', () => {
    fs.writeFileSync(lockfilePath(tmpDir), String(process.pid));
    writeActiveTask(tmpDir, 'task-1');
    cleanupBookkeeping(tmpDir);
    assert.equal(fs.existsSync(lockfilePath(tmpDir)), false);
    assert.equal(fs.existsSync(activeTaskPath(tmpDir)), false);
  });

  it('is idempotent and does not throw when files are absent', () => {
    cleanupBookkeeping(tmpDir);
    cleanupBookkeeping(tmpDir);
    fs.writeFileSync(lockfilePath(tmpDir), String(process.pid));
    cleanupBookkeeping(tmpDir);
    cleanupBookkeeping(tmpDir);
    assert.equal(fs.existsSync(lockfilePath(tmpDir)), false);
  });

  it('leaves files owned by another PID untouched', () => {
    fs.writeFileSync(lockfilePath(tmpDir), String(OTHER_PID));
    writeActiveTask(tmpDir, 'task-2', OTHER_PID);
    cleanupBookkeeping(tmpDir);
    assert.equal(fs.existsSync(lockfilePath(tmpDir)), true);
    assert.equal(fs.existsSync(activeTaskPath(tmpDir)), true);
  });

  it('removes a legacy id-only active file when the lock is ours', () => {
    fs.writeFileSync(lockfilePath(tmpDir), String(process.pid));
    fs.writeFileSync(activeTaskPath(tmpDir), 'legacy-task');
    cleanupBookkeeping(tmpDir);
    assert.equal(fs.existsSync(activeTaskPath(tmpDir)), false);
    assert.equal(fs.existsSync(lockfilePath(tmpDir)), false);
  });

  it('keeps a legacy id-only active file when the lock belongs to someone else', () => {
    fs.writeFileSync(lockfilePath(tmpDir), String(OTHER_PID));
    fs.writeFileSync(activeTaskPath(tmpDir), 'legacy-task');
    cleanupBookkeeping(tmpDir);
    assert.equal(fs.existsSync(activeTaskPath(tmpDir)), true);
    assert.equal(fs.existsSync(lockfilePath(tmpDir)), true);
  });
});

describe('registerBookkeepingCleanup', () => {
  it('registers and disposes exit/fatal handlers without leaking listeners', () => {
    const before = {
      exit: process.listenerCount('exit'),
      ex: process.listenerCount('uncaughtException'),
      rej: process.listenerCount('unhandledRejection'),
      hup: process.listenerCount('SIGHUP'),
    };
    const reg = registerBookkeepingCleanup(tmpDir, { signals: ['SIGHUP'] });
    assert.equal(process.listenerCount('exit'), before.exit + 1);
    assert.equal(process.listenerCount('uncaughtException'), before.ex + 1);
    assert.equal(process.listenerCount('unhandledRejection'), before.rej + 1);
    assert.equal(process.listenerCount('SIGHUP'), before.hup + 1);
    reg.dispose();
    assert.equal(process.listenerCount('exit'), before.exit);
    assert.equal(process.listenerCount('uncaughtException'), before.ex);
    assert.equal(process.listenerCount('unhandledRejection'), before.rej);
    assert.equal(process.listenerCount('SIGHUP'), before.hup);
  });
});

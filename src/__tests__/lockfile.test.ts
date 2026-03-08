import { describe, it, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  lockfilePath,
  LOCK_FILENAME,
  isProcessAlive,
  readLock,
  acquireLock,
  releaseLock,
  stopProcess,
} from '../lockfile';

// ─── helpers ──────────────────────────────────────────────────────────────────

let tmpDir: string;

function writeLock(cwd: string, pid: number): void {
  fs.writeFileSync(lockfilePath(cwd), String(pid), 'utf8');
}

// ─── setup / teardown ─────────────────────────────────────────────────────────

before(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aidev-lock-test-'));
});

afterEach(() => {
  // Clean up lock file between tests
  try { fs.unlinkSync(lockfilePath(tmpDir)); } catch { /* ok */ }
});

after(() => {
  try { fs.rmdirSync(tmpDir); } catch { /* ok */ }
});

// ─── lockfilePath ─────────────────────────────────────────────────────────────

describe('lockfilePath', () => {
  it('returns path ending with LOCK_FILENAME inside cwd', () => {
    const p = lockfilePath('/some/dir');
    assert.equal(p, `/some/dir/${LOCK_FILENAME}`);
  });
});

// ─── isProcessAlive ───────────────────────────────────────────────────────────

describe('isProcessAlive', () => {
  it('returns true for the current process', () => {
    assert.equal(isProcessAlive(process.pid), true);
  });

  it('returns false for a PID that does not exist', () => {
    // PID 0 is the kernel — kill(0, 0) targets the current process group,
    // so use a very high number that is almost certainly unused.
    // We rely on errno ESRCH (no such process).
    assert.equal(isProcessAlive(999999999), false);
  });
});

// ─── readLock ─────────────────────────────────────────────────────────────────

describe('readLock', () => {
  it('returns null when no lock file exists', () => {
    assert.equal(readLock(tmpDir), null);
  });

  it('returns the PID stored in the lock file', () => {
    writeLock(tmpDir, 1234);
    assert.equal(readLock(tmpDir), 1234);
  });

  it('returns null for non-numeric content', () => {
    fs.writeFileSync(lockfilePath(tmpDir), 'not-a-pid', 'utf8');
    assert.equal(readLock(tmpDir), null);
  });
});

// ─── acquireLock ──────────────────────────────────────────────────────────────

describe('acquireLock', () => {
  it('succeeds when no lock file exists', () => {
    const ok = acquireLock(tmpDir);
    assert.equal(ok, true);
    assert.equal(readLock(tmpDir), process.pid);
  });

  it('succeeds and overwrites a stale lock file (dead PID)', () => {
    writeLock(tmpDir, 999999999); // dead PID
    const ok = acquireLock(tmpDir);
    assert.equal(ok, true);
    assert.equal(readLock(tmpDir), process.pid);
  });

  it('fails when a live process holds the lock', () => {
    writeLock(tmpDir, process.pid); // current process = alive
    const ok = acquireLock(tmpDir);
    assert.equal(ok, false);
  });
});

// ─── releaseLock ──────────────────────────────────────────────────────────────

describe('releaseLock', () => {
  it('removes the lock file', () => {
    writeLock(tmpDir, process.pid);
    releaseLock(tmpDir);
    assert.equal(fs.existsSync(lockfilePath(tmpDir)), false);
  });

  it('does not throw when the file is already absent', () => {
    assert.doesNotThrow(() => releaseLock(tmpDir));
  });
});

// ─── stopProcess ──────────────────────────────────────────────────────────────

describe('stopProcess', () => {
  it('returns "no-lock" when no lock file exists', () => {
    assert.equal(stopProcess(tmpDir), 'no-lock');
  });

  it('returns "not-running" and removes a stale lock', () => {
    writeLock(tmpDir, 999999999); // dead PID
    const result = stopProcess(tmpDir);
    assert.equal(result, 'not-running');
    assert.equal(fs.existsSync(lockfilePath(tmpDir)), false);
  });

  // Note: we cannot test 'killed' safely in a unit test without spawning a
  // real child process, so the live-kill path is exercised by integration tests.
});

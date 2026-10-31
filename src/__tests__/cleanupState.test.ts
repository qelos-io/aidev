import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  cleanupStatePath,
  healLegacyCleanupState,
  LEGACY_CLEANUP_STATE_RELPATH,
  readLastCleanupAt,
  writeLastCleanupAt,
  shouldRunWeeklyCleanup,
} from '../cleanupState';
import { listWorkingTreeChanges } from '../git';

describe('shouldRunWeeklyCleanup', () => {
  it('is not due on a non-Monday, even with no prior run', () => {
    const tuesday = new Date('2026-09-22T09:00:00'); // Tuesday
    assert.equal(shouldRunWeeklyCleanup(null, tuesday), false);
  });

  it('is due on a Monday when never run before', () => {
    const monday = new Date('2026-09-21T09:00:00'); // Monday
    assert.equal(shouldRunWeeklyCleanup(null, monday), true);
  });

  it('is not due again on the same Monday after already running', () => {
    const firstRun = new Date('2026-09-21T09:00:00');
    const laterSameDay = new Date('2026-09-21T14:00:00');
    assert.equal(shouldRunWeeklyCleanup(firstRun.getTime(), laterSameDay), false);
  });

  it('is due again on the following Monday', () => {
    const firstRun = new Date('2026-09-21T09:00:00');
    const nextMonday = new Date('2026-09-28T09:00:00');
    assert.equal(shouldRunWeeklyCleanup(firstRun.getTime(), nextMonday), true);
  });

  it('is not due mid-week even if 6+ days have passed since the last run', () => {
    const priorRun = new Date('2026-09-15T09:00:00'); // Tuesday
    const followingSunday = new Date('2026-09-27T09:00:00');
    assert.equal(shouldRunWeeklyCleanup(priorRun.getTime(), followingSunday), false);
  });
});

describe('readLastCleanupAt / writeLastCleanupAt', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aidev-cleanup-state-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns null when no state file exists', () => {
    assert.equal(readLastCleanupAt(tmpDir), null);
  });

  it('round-trips a written timestamp', () => {
    writeLastCleanupAt(12345, tmpDir);
    assert.equal(readLastCleanupAt(tmpDir), 12345);
    assert.ok(fs.existsSync(cleanupStatePath(tmpDir)));
  });

  it('returns null for a malformed state file', () => {
    fs.mkdirSync(path.join(tmpDir, '.aidev'), { recursive: true });
    fs.writeFileSync(cleanupStatePath(tmpDir), 'not json', 'utf8');
    assert.equal(readLastCleanupAt(tmpDir), null);
  });
});

describe('healLegacyCleanupState', () => {
  let tmpDir: string;
  let originalCwd: string;

  function gitCmd(args: string[]): void {
    const result = spawnSync('git', args, { cwd: tmpDir, encoding: 'utf8' });
    if (result.status !== 0) {
      throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
    }
  }

  function commitLegacyFile(): string {
    const file = path.join(tmpDir, ...LEGACY_CLEANUP_STATE_RELPATH.split('/'));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ lastCleanupAt: 1 }), 'utf8');
    gitCmd(['add', '-f', LEGACY_CLEANUP_STATE_RELPATH]);
    gitCmd(['commit', '-m', 'legacy cleanup state']);
    return file;
  }

  beforeEach(() => {
    originalCwd = process.cwd();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aidev-heal-legacy-'));
    gitCmd(['init', '-b', 'main']);
    gitCmd(['config', 'user.email', 't@t.t']);
    gitCmd(['config', 'user.name', 't']);
    fs.writeFileSync(path.join(tmpDir, 'README.md'), '# t\n');
    gitCmd(['add', 'README.md']);
    gitCmd(['commit', '-m', 'init']);
    process.chdir(tmpDir);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('deletes an untracked legacy file', () => {
    const file = path.join(tmpDir, ...LEGACY_CLEANUP_STATE_RELPATH.split('/'));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ lastCleanupAt: 1 }), 'utf8');

    healLegacyCleanupState(tmpDir);

    assert.equal(fs.existsSync(file), false);
    assert.deepEqual(listWorkingTreeChanges(), []);
  });

  it('restores a tracked legacy file after an unstaged deletion', () => {
    const file = commitLegacyFile();
    fs.rmSync(file);

    assert.ok(listWorkingTreeChanges().includes(LEGACY_CLEANUP_STATE_RELPATH));

    healLegacyCleanupState(tmpDir);

    assert.ok(fs.existsSync(file));
    assert.deepEqual(listWorkingTreeChanges(), []);
  });

  it('restores a tracked legacy file after a staged deletion', () => {
    const file = commitLegacyFile();
    gitCmd(['rm', '--', LEGACY_CLEANUP_STATE_RELPATH]);

    assert.ok(listWorkingTreeChanges().includes(LEGACY_CLEANUP_STATE_RELPATH));
    assert.equal(fs.existsSync(file), false);

    healLegacyCleanupState(tmpDir);

    assert.ok(fs.existsSync(file));
    assert.deepEqual(listWorkingTreeChanges(), []);
  });

  it('restores a tracked legacy file after a content modification', () => {
    const file = commitLegacyFile();
    fs.writeFileSync(file, JSON.stringify({ lastCleanupAt: 99 }), 'utf8');

    healLegacyCleanupState(tmpDir);

    assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).lastCleanupAt, 1);
    assert.deepEqual(listWorkingTreeChanges(), []);
  });
});

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  cleanupStatePath,
  readLastCleanupAt,
  writeLastCleanupAt,
  shouldRunWeeklyCleanup,
} from '../cleanupState';

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

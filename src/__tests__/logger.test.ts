import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, it, beforeEach, afterEach } from 'node:test';
import { pruneLog } from '../../src/logger';

function daysAgo(n: number): string {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString();
}

describe('pruneLog', () => {
  let tmpDir: string;
  let logFile: string;
  const origEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aidev-logger-'));
    logFile = path.join(tmpDir, 'aidev.log');
    origEnv.AIDEV_LOG_PATH = process.env.AIDEV_LOG_PATH;
    origEnv.AIDEV_LOG_TTL_DAYS = process.env.AIDEV_LOG_TTL_DAYS;
    process.env.AIDEV_LOG_PATH = logFile;
    delete process.env.AIDEV_LOG_TTL_DAYS;
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    if (origEnv.AIDEV_LOG_PATH === undefined) {
      delete process.env.AIDEV_LOG_PATH;
    } else {
      process.env.AIDEV_LOG_PATH = origEnv.AIDEV_LOG_PATH;
    }
    if (origEnv.AIDEV_LOG_TTL_DAYS === undefined) {
      delete process.env.AIDEV_LOG_TTL_DAYS;
    } else {
      process.env.AIDEV_LOG_TTL_DAYS = origEnv.AIDEV_LOG_TTL_DAYS;
    }
  });

  it('does nothing when the log file does not exist', () => {
    pruneLog();
    assert.equal(fs.existsSync(logFile), false);
  });

  it('does nothing when all lines are within the TTL', () => {
    const lines = [
      `${daysAgo(1)} [info] recent line`,
      `${daysAgo(0)} [info] even more recent`,
    ].join('\n') + '\n';
    fs.writeFileSync(logFile, lines, 'utf8');
    pruneLog();
    assert.equal(fs.readFileSync(logFile, 'utf8'), lines);
  });

  it('removes lines older than the default TTL (14 days)', () => {
    const old1 = `${daysAgo(20)} [info] very old line`;
    const old2 = `${daysAgo(15)} [info] old line`;
    const recent = `${daysAgo(1)} [info] recent line`;
    fs.writeFileSync(logFile, [old1, old2, recent, ''].join('\n'), 'utf8');
    pruneLog();
    const result = fs.readFileSync(logFile, 'utf8');
    assert.ok(result.includes('recent line'), 'recent line should be kept');
    assert.ok(!result.includes('very old line'), 'old lines should be removed');
    assert.ok(!result.includes('old line'), 'old lines should be removed');
  });

  it('respects a custom TTL via AIDEV_LOG_TTL_DAYS', () => {
    process.env.AIDEV_LOG_TTL_DAYS = '7';
    const old = `${daysAgo(10)} [info] old line`;
    const recent = `${daysAgo(5)} [info] recent line`;
    fs.writeFileSync(logFile, [old, recent, ''].join('\n'), 'utf8');
    pruneLog();
    const result = fs.readFileSync(logFile, 'utf8');
    assert.ok(!result.includes('old line'), 'line outside 7-day window should be removed');
    assert.ok(result.includes('recent line'), 'line within 7-day window should be kept');
  });

  it('disables pruning when AIDEV_LOG_TTL_DAYS=0', () => {
    process.env.AIDEV_LOG_TTL_DAYS = '0';
    const old = `${daysAgo(30)} [info] ancient line`;
    const content = old + '\n';
    fs.writeFileSync(logFile, content, 'utf8');
    pruneLog();
    assert.equal(fs.readFileSync(logFile, 'utf8'), content);
  });

  it('disables pruning for negative AIDEV_LOG_TTL_DAYS', () => {
    process.env.AIDEV_LOG_TTL_DAYS = '-1';
    const old = `${daysAgo(30)} [info] ancient line`;
    const content = old + '\n';
    fs.writeFileSync(logFile, content, 'utf8');
    pruneLog();
    assert.equal(fs.readFileSync(logFile, 'utf8'), content);
  });

  it('removes all content when every line is expired', () => {
    const lines = [
      `${daysAgo(30)} [info] old line 1`,
      `${daysAgo(20)} [info] old line 2`,
      '',
    ].join('\n');
    fs.writeFileSync(logFile, lines, 'utf8');
    pruneLog();
    const result = fs.readFileSync(logFile, 'utf8');
    assert.equal(result.trim(), '', 'file should be empty after pruning all expired lines');
  });

  it('preserves non-timestamped lines that follow a recent line', () => {
    const recent = `${daysAgo(1)} [run] started`;
    const continuation = '  continuation line without a timestamp';
    fs.writeFileSync(logFile, [recent, continuation, ''].join('\n'), 'utf8');
    pruneLog();
    const result = fs.readFileSync(logFile, 'utf8');
    assert.ok(result.includes(continuation), 'non-timestamped lines should be kept');
  });
});

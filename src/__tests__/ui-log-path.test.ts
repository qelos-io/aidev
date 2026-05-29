import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, it, after } from 'node:test';
import { resolveLogPath } from '../../ui/server/utils/logFile';

describe('resolveLogPath', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'aidev-logpath-'));

  after(() => {
    fs.rmSync(cwd, { recursive: true, force: true });
  });

  it('defaults to <cwd>/aidev.log when AIDEV_LOG_PATH is unset', () => {
    assert.equal(resolveLogPath(cwd), path.join(cwd, 'aidev.log'));
  });

  it('resolves relative paths against cwd', () => {
    fs.writeFileSync(path.join(cwd, '.env.aidev'), 'AIDEV_LOG_PATH=logs/run.log\n');
    assert.equal(resolveLogPath(cwd), path.resolve(cwd, 'logs/run.log'));
  });

  it('expands ~ and ~/rel against homedir', () => {
    fs.writeFileSync(path.join(cwd, '.env.aidev'), 'AIDEV_LOG_PATH=~/aidev-test.log\n');
    assert.equal(resolveLogPath(cwd), path.join(os.homedir(), 'aidev-test.log'));

    fs.writeFileSync(path.join(cwd, '.env.aidev'), 'AIDEV_LOG_PATH=~\n');
    assert.equal(resolveLogPath(cwd), os.homedir());
  });

  it('uses absolute paths as-is', () => {
    const abs = path.join(os.tmpdir(), 'absolute-aidev.log');
    fs.writeFileSync(path.join(cwd, '.env.aidev'), `AIDEV_LOG_PATH=${abs.replace(/\\/g, '/')}\n`);
    assert.equal(path.normalize(resolveLogPath(cwd)), path.normalize(abs));
  });
});

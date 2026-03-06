import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { cronToSchtasksArgs, windowsTaskName, buildUnixCronLine } from '../commands/schedule';

describe('cronToSchtasksArgs', () => {
  it('every 15 minutes', () => {
    assert.deepEqual(cronToSchtasksArgs('*/15 * * * *'), ['/sc', 'MINUTE', '/mo', '15']);
  });

  it('every 30 minutes', () => {
    assert.deepEqual(cronToSchtasksArgs('*/30 * * * *'), ['/sc', 'MINUTE', '/mo', '30']);
  });

  it('every hour', () => {
    assert.deepEqual(cronToSchtasksArgs('0 * * * *'), ['/sc', 'HOURLY', '/mo', '1']);
  });

  it('every 5 hours', () => {
    assert.deepEqual(cronToSchtasksArgs('0 */5 * * *'), ['/sc', 'HOURLY', '/mo', '5']);
  });

  it('daily at 8am — zero-pads hour', () => {
    assert.deepEqual(cronToSchtasksArgs('0 8 * * *'), ['/sc', 'DAILY', '/st', '08:00']);
  });

  it('daily at midnight (0 0)', () => {
    assert.deepEqual(cronToSchtasksArgs('0 0 * * *'), ['/sc', 'DAILY', '/st', '00:00']);
  });

  it('returns null for unsupported expressions', () => {
    assert.equal(cronToSchtasksArgs('0 9 * * 1'), null); // weekday not supported
    assert.equal(cronToSchtasksArgs('*/5 */2 * * *'), null);
    assert.equal(cronToSchtasksArgs('not a cron'), null);
  });
});

describe('buildUnixCronLine', () => {
  const cwd = '/home/user/myproject';
  const node = '/usr/local/bin/node';
  const aidev = '/usr/local/bin/aidev';

  it('starts with the cron expression', () => {
    const line = buildUnixCronLine('*/15 * * * *', cwd, node, aidev);
    assert.ok(line.startsWith('*/15 * * * *'));
  });

  it('includes absolute node binary before aidev binary', () => {
    const line = buildUnixCronLine('*/15 * * * *', cwd, node, aidev);
    const nodePos = line.indexOf(node);
    const aidevPos = line.indexOf(aidev);
    assert.ok(nodePos !== -1, 'node binary missing');
    assert.ok(aidevPos !== -1, 'aidev binary missing');
    assert.ok(nodePos < aidevPos, 'node must come before aidev');
  });

  it('includes cd to the project directory', () => {
    const line = buildUnixCronLine('*/15 * * * *', cwd, node, aidev);
    assert.ok(line.includes(`cd ${cwd}`));
  });

  it('appends the aidev-cwd marker', () => {
    const line = buildUnixCronLine('*/15 * * * *', cwd, node, aidev);
    assert.ok(line.includes(`# aidev-cwd:${cwd}`));
  });

  it('ends with "run" followed by the marker', () => {
    const line = buildUnixCronLine('*/30 * * * *', cwd, node, aidev);
    assert.ok(line.includes(`${aidev} run`));
    assert.ok(line.endsWith(`# aidev-cwd:${cwd}`));
  });

  it('uses the provided cron expression verbatim', () => {
    const expr = '0 8 * * *';
    const line = buildUnixCronLine(expr, cwd, node, aidev);
    assert.ok(line.startsWith(expr));
  });
});

describe('windowsTaskName', () => {
  it('produces a name prefixed with aidev\\', () => {
    assert.ok(windowsTaskName('C:\\Users\\dev\\myproject').startsWith('aidev\\'));
  });

  it('removes colons and backslashes from path', () => {
    const name = windowsTaskName('C:\\Users\\dev\\myproject');
    assert.ok(!name.includes(':'));
    assert.ok(!name.slice('aidev\\'.length).includes('\\'));
  });

  it('handles unix paths', () => {
    const name = windowsTaskName('/home/user/myproject');
    assert.ok(name.startsWith('aidev\\'));
    assert.ok(!name.includes('/'));
  });

  it('without cronExpr returns base name only', () => {
    const a = windowsTaskName('C:\\Users\\dev\\myproject');
    const b = windowsTaskName('C:\\Users\\dev\\myproject', undefined);
    assert.equal(a, b);
    assert.ok(!a.includes('--'));
  });

  it('with cronExpr produces unique names per schedule', () => {
    const cwd = 'C:\\Users\\dev\\myproject';
    const a = windowsTaskName(cwd, '0 8 * * *');
    const b = windowsTaskName(cwd, '0 16 * * *');
    assert.notEqual(a, b);
    assert.ok(a.startsWith('aidev\\'));
    assert.ok(b.startsWith('aidev\\'));
  });

  it('same cwd + cronExpr produces the same name', () => {
    const cwd = 'C:\\Users\\dev\\myproject';
    const a = windowsTaskName(cwd, '*/15 * * * *');
    const b = windowsTaskName(cwd, '*/15 * * * *');
    assert.equal(a, b);
  });
});

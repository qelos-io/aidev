import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { cronToSchtasksArgs, windowsTaskName } from '../commands/schedule';

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
});

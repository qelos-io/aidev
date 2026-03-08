import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { cronToSchtasksArgs, windowsTaskName, buildUnixCronLine, cronToLaunchdSchedule, buildLaunchAgentPlist, extractLaunchdSchedule } from '../commands/schedule';
import type { LaunchdSchedule } from '../commands/schedule';

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

// ─── cronToLaunchdSchedule ────────────────────────────────────────────────────

describe('cronToLaunchdSchedule', () => {
  it('every 15 minutes → StartInterval 900s', () => {
    const s = cronToLaunchdSchedule('*/15 * * * *');
    assert.deepEqual(s, { key: 'StartInterval', seconds: 900 });
  });

  it('every 30 minutes → StartInterval 1800s', () => {
    const s = cronToLaunchdSchedule('*/30 * * * *');
    assert.deepEqual(s, { key: 'StartInterval', seconds: 1800 });
  });

  it('every hour (0 * * * *) → StartInterval 3600s', () => {
    const s = cronToLaunchdSchedule('0 * * * *');
    assert.deepEqual(s, { key: 'StartInterval', seconds: 3600 });
  });

  it('every 5 hours → StartInterval 18000s', () => {
    const s = cronToLaunchdSchedule('0 */5 * * *');
    assert.deepEqual(s, { key: 'StartInterval', seconds: 18000 });
  });

  it('daily at 8am → StartCalendarInterval hour=8 minute=0', () => {
    const s = cronToLaunchdSchedule('0 8 * * *');
    assert.deepEqual(s, { key: 'StartCalendarInterval', hour: 8, minute: 0 });
  });

  it('daily at midnight → StartCalendarInterval hour=0 minute=0', () => {
    const s = cronToLaunchdSchedule('0 0 * * *');
    assert.deepEqual(s, { key: 'StartCalendarInterval', hour: 0, minute: 0 });
  });

  it('returns null for unsupported expressions', () => {
    assert.equal(cronToLaunchdSchedule('0 9 * * 1'), null);
    assert.equal(cronToLaunchdSchedule('*/5 */2 * * *'), null);
    assert.equal(cronToLaunchdSchedule('not a cron'), null);
  });
});

// ─── buildLaunchAgentPlist ────────────────────────────────────────────────────

describe('buildLaunchAgentPlist', () => {
  const label = 'com.aidev.run.abc123';
  const nodeBin = '/usr/local/bin/node';
  const aidevBin = '/usr/local/bin/aidev';
  const cwd = '/Users/dev/myproject';

  const intervalSchedule: LaunchdSchedule = { key: 'StartInterval', seconds: 900 };
  const calendarSchedule: LaunchdSchedule = { key: 'StartCalendarInterval', hour: 8, minute: 0 };

  it('generates valid XML plist header', () => {
    const plist = buildLaunchAgentPlist(label, nodeBin, aidevBin, cwd, intervalSchedule);
    assert.ok(plist.startsWith('<?xml version="1.0" encoding="UTF-8"?>'));
    assert.ok(plist.includes('<!DOCTYPE plist'));
    assert.ok(plist.includes('<plist version="1.0">'));
  });

  it('includes the label', () => {
    const plist = buildLaunchAgentPlist(label, nodeBin, aidevBin, cwd, intervalSchedule);
    assert.ok(plist.includes(`<string>${label}</string>`));
  });

  it('includes ProgramArguments with node, aidev, and "run"', () => {
    const plist = buildLaunchAgentPlist(label, nodeBin, aidevBin, cwd, intervalSchedule);
    assert.ok(plist.includes('<key>ProgramArguments</key>'));
    assert.ok(plist.includes(`<string>${nodeBin}</string>`));
    assert.ok(plist.includes(`<string>${aidevBin}</string>`));
    assert.ok(plist.includes('<string>run</string>'));
  });

  it('includes WorkingDirectory', () => {
    const plist = buildLaunchAgentPlist(label, nodeBin, aidevBin, cwd, intervalSchedule);
    assert.ok(plist.includes(`<string>${cwd}</string>`));
  });

  it('generates StartInterval for interval schedules', () => {
    const plist = buildLaunchAgentPlist(label, nodeBin, aidevBin, cwd, intervalSchedule);
    assert.ok(plist.includes('<key>StartInterval</key>'));
    assert.ok(plist.includes('<integer>900</integer>'));
  });

  it('generates StartCalendarInterval for calendar schedules', () => {
    const plist = buildLaunchAgentPlist(label, nodeBin, aidevBin, cwd, calendarSchedule);
    assert.ok(plist.includes('<key>StartCalendarInterval</key>'));
    assert.ok(plist.includes('<key>Hour</key>'));
    assert.ok(plist.includes('<integer>8</integer>'));
    assert.ok(plist.includes('<key>Minute</key>'));
    assert.ok(plist.includes('<integer>0</integer>'));
  });

  it('does not contain XML-escaped values for normal paths', () => {
    const plist = buildLaunchAgentPlist(label, nodeBin, aidevBin, cwd, intervalSchedule);
    // Normal paths should not be escaped — no &amp; &lt; &gt;
    assert.ok(!plist.includes('&amp;'));
    assert.ok(!plist.includes('&lt;'));
    assert.ok(!plist.includes('&gt;'));
  });

  it('includes PATH environment variable', () => {
    const plist = buildLaunchAgentPlist(label, nodeBin, aidevBin, cwd, intervalSchedule);
    assert.ok(plist.includes('<key>PATH</key>'));
    assert.ok(plist.includes('<key>EnvironmentVariables</key>'));
  });

  it('includes HOME environment variable', () => {
    const plist = buildLaunchAgentPlist(label, nodeBin, aidevBin, cwd, intervalSchedule);
    assert.ok(plist.includes('<key>HOME</key>'));
  });

  it('sets RunAtLoad to false', () => {
    const plist = buildLaunchAgentPlist(label, nodeBin, aidevBin, cwd, intervalSchedule);
    assert.ok(plist.includes('<key>RunAtLoad</key>'));
    assert.ok(plist.includes('<false/>'));
  });
});

// ─── extractLaunchdSchedule ───────────────────────────────────────────────────

describe('extractLaunchdSchedule', () => {
  const label = 'com.aidev.run.abc123';
  const nodeBin = '/usr/local/bin/node';
  const aidevBin = '/usr/local/bin/aidev';
  const cwd = '/Users/dev/myproject';

  it('extracts StartInterval from a generated plist', () => {
    const schedule: LaunchdSchedule = { key: 'StartInterval', seconds: 900 };
    const plist = buildLaunchAgentPlist(label, nodeBin, aidevBin, cwd, schedule);
    assert.deepEqual(extractLaunchdSchedule(plist), schedule);
  });

  it('extracts StartCalendarInterval from a generated plist', () => {
    const schedule: LaunchdSchedule = { key: 'StartCalendarInterval', hour: 8, minute: 0 };
    const plist = buildLaunchAgentPlist(label, nodeBin, aidevBin, cwd, schedule);
    assert.deepEqual(extractLaunchdSchedule(plist), schedule);
  });

  it('round-trips: extract then rebuild produces identical plist', () => {
    const schedule: LaunchdSchedule = { key: 'StartInterval', seconds: 1800 };
    const plist = buildLaunchAgentPlist(label, nodeBin, aidevBin, cwd, schedule);
    const extracted = extractLaunchdSchedule(plist)!;
    const rebuilt = buildLaunchAgentPlist(label, nodeBin, aidevBin, cwd, extracted);
    assert.equal(rebuilt, plist);
  });

  it('round-trips calendar schedule: extract then rebuild produces identical plist', () => {
    const schedule: LaunchdSchedule = { key: 'StartCalendarInterval', hour: 8, minute: 0 };
    const plist = buildLaunchAgentPlist(label, nodeBin, aidevBin, cwd, schedule);
    const extracted = extractLaunchdSchedule(plist)!;
    const rebuilt = buildLaunchAgentPlist(label, nodeBin, aidevBin, cwd, extracted);
    assert.equal(rebuilt, plist);
  });

  it('returns null for plist with no schedule keys', () => {
    assert.equal(extractLaunchdSchedule('<plist><dict></dict></plist>'), null);
  });
});

// ─── schedule fix: Unix cron round-trip ───────────────────────────────────────

describe('buildUnixCronLine idempotency (schedule fix basis)', () => {
  const cwd = '/home/user/myproject';
  const node = '/usr/local/bin/node';
  const aidev = '/usr/local/bin/aidev';

  it('rebuilding with same args produces identical line (already up to date)', () => {
    const line = buildUnixCronLine('*/15 * * * *', cwd, node, aidev);
    const rebuilt = buildUnixCronLine('*/15 * * * *', cwd, node, aidev);
    assert.equal(line, rebuilt);
  });

  it('rebuilding with different node path produces a different line (needs fix)', () => {
    const original = buildUnixCronLine('*/15 * * * *', cwd, '/old/bin/node', aidev);
    const updated = buildUnixCronLine('*/15 * * * *', cwd, node, aidev);
    assert.notEqual(original, updated);
    assert.ok(updated.includes(node));
    assert.ok(!updated.includes('/old/bin/node'));
  });

  it('rebuilding with different aidev path produces a different line (needs fix)', () => {
    const original = buildUnixCronLine('*/15 * * * *', cwd, node, '/old/bin/aidev');
    const updated = buildUnixCronLine('*/15 * * * *', cwd, node, aidev);
    assert.notEqual(original, updated);
    assert.ok(updated.includes(aidev));
  });
});

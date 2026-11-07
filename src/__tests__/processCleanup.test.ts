import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  parsePsOutput,
  parseWindowsProcessJson,
  parseDockerPsOutput,
  listProcesses,
  listDockerContainers,
  ProcessTracker,
  ProcInfo,
} from '../processCleanup';

describe('parsePsOutput', () => {
  it('parses pid, ppid, lstart and comm', () => {
    const out = [
      '    1     0 Mon Nov  3 08:00:01 2025 /sbin/init',
      ' 4321  1200 Fri Nov  7 12:34:56 2025 node',
      '',
    ].join('\n');
    const procs = parsePsOutput(out);
    assert.equal(procs.length, 2);
    assert.deepEqual([procs[0].pid, procs[0].ppid, procs[0].name], [1, 0, '/sbin/init']);
    assert.deepEqual([procs[1].pid, procs[1].ppid, procs[1].name], [4321, 1200, 'node']);
    assert.equal(procs[1].startTime, new Date(2025, 10, 7, 12, 34, 56).getTime());
  });

  it('keeps command names containing spaces and skips junk lines', () => {
    const out = [
      'PID PPID garbage',
      '  77     1 Tue Jan  6 01:02:03 2026 /Applications/Google Chrome.app/Chrome',
    ].join('\n');
    const procs = parsePsOutput(out);
    assert.equal(procs.length, 1);
    assert.equal(procs[0].name, '/Applications/Google Chrome.app/Chrome');
  });

  it('handles CRLF and empty output', () => {
    assert.deepEqual(parsePsOutput(''), []);
    assert.equal(parsePsOutput('5 1 Mon Nov  3 08:00:01 2025 sh\r\n').length, 1);
  });
});

describe('parseWindowsProcessJson', () => {
  it('parses a PowerShell 5.1 array with /Date(ms)/ values', () => {
    const json = JSON.stringify([
      { ProcessId: 0, ParentProcessId: 0, Name: 'System Idle Process', CreationDate: null },
      { ProcessId: 100, ParentProcessId: 4, Name: 'node.exe', CreationDate: '/Date(1700000000000)/' },
    ]);
    const procs = parseWindowsProcessJson(json);
    assert.equal(procs.length, 2);
    assert.equal(procs[0].startTime, undefined);
    assert.deepEqual(procs[1], { pid: 100, ppid: 4, name: 'node.exe', startTime: 1700000000000 });
  });

  it('parses ISO dates and a single bare object, tolerating a BOM', () => {
    const json =
      '﻿' +
      JSON.stringify({
        ProcessId: 9,
        ParentProcessId: 1,
        Name: 'python.exe',
        CreationDate: '2025-11-07T12:00:00.000Z',
      });
    assert.deepEqual(parseWindowsProcessJson(json), [
      { pid: 9, ppid: 1, name: 'python.exe', startTime: Date.parse('2025-11-07T12:00:00.000Z') },
    ]);
  });

  it('returns [] on invalid or empty input and skips bad entries', () => {
    assert.deepEqual(parseWindowsProcessJson(''), []);
    assert.deepEqual(parseWindowsProcessJson('not json'), []);
    assert.deepEqual(
      parseWindowsProcessJson('[{"ProcessId":"x"},null,{"ProcessId":2,"ParentProcessId":1}]'),
      [{ pid: 2, ppid: 1, name: '' }],
    );
  });
});

describe('parseDockerPsOutput', () => {
  it('returns trimmed container ids only', () => {
    assert.deepEqual(
      parseDockerPsOutput('abc123def456\r\n0123456789ab\n\nCannot connect to daemon\n'),
      ['abc123def456', '0123456789ab'],
    );
  });
});

describe('live listing (smoke)', () => {
  it('listProcesses includes the current process', () => {
    const procs = listProcesses();
    assert.ok(procs.some((p) => p.pid === process.pid));
  });

  it('listDockerContainers never throws and returns an array', () => {
    assert.ok(Array.isArray(listDockerContainers()));
  });
});

describe('ProcessTracker', () => {
  const SELF = 1000;
  const T0 = 1_700_000_000_000;
  const mk = (pid: number, ppid: number, startOffset: number, name = 'p'): ProcInfo => ({
    pid,
    ppid,
    name,
    startTime: T0 + startOffset,
  });
  const base = [mk(2, 1, -100000, 'init'), mk(500, 2, -50000, 'shell'), mk(SELF, 500, -1000, 'aidev')];

  function setup(after: () => ProcInfo[], containers: { before: string[]; after: string[] } = { before: [], after: [] }) {
    let phase = 0;
    const tracker = new ProcessTracker({
      selfPid: SELF,
      now: () => T0,
      listProcesses: () => (phase === 0 ? base : after()),
      listDockerContainers: () => (phase === 0 ? containers.before : containers.after),
    });
    tracker.begin();
    phase = 1;
    return tracker;
  }

  const pids = (t: ProcessTracker) => t.getTrackedProcesses().map((p) => p.pid).sort((a, b) => a - b);

  it('tracks descendants of aidev, including grandchildren', () => {
    const t = setup(() => [...base, mk(1001, SELF, 10, 'claude'), mk(1002, 1001, 20, 'node'), mk(1003, 1002, 30, 'sh')]);
    t.capture();
    assert.deepEqual(pids(t), [1001, 1002, 1003]);
  });

  it('tracks orphans started after the run began, but not unrelated live processes', () => {
    const t = setup(() => [
      ...base,
      mk(2000, 1, 50, 'devserver'), // orphan reparented to init
      mk(2001, 99999, 60, 'orphan2'), // parent not in list
      mk(2002, 500, 70, 'unrelated'), // child of the shell, still has live parent
    ]);
    t.capture();
    assert.deepEqual(pids(t), [2000, 2001]);
  });

  it('ignores orphans that started before the run', () => {
    const t = setup(() => [...base, mk(3000, 1, -5000, 'old-daemon')]);
    t.capture();
    assert.deepEqual(pids(t), []);
  });

  it('excludes baseline processes, self and ancestors', () => {
    const t = setup(() => [...base, mk(1001, SELF, 10)]);
    t.capture();
    assert.deepEqual(pids(t), [1001]);
  });

  it('excludes baseline processes even if they are descendants of aidev', () => {
    const baseWithChild = [...base, mk(900, SELF, -500, 'preexisting-child')];
    let phase = 0;
    const t = new ProcessTracker({
      selfPid: SELF,
      now: () => T0,
      listProcesses: () => (phase === 0 ? baseWithChild : [...baseWithChild, mk(1001, 900, 10)]),
      listDockerContainers: () => [],
    });
    t.begin();
    phase = 1;
    t.capture();
    assert.deepEqual(pids(t), [1001]); // 900 excluded, its new child still attributed via ancestry
  });

  it('treats a baseline pid with a different start time as a new (reused) process', () => {
    let phase = 0;
    const withOld = [...base, mk(700, 2, -50000, 'old')];
    const t = new ProcessTracker({
      selfPid: SELF,
      now: () => T0,
      listProcesses: () => (phase === 0 ? withOld : [...base, mk(700, SELF, 40, 'reused')]),
      listDockerContainers: () => [],
    });
    t.begin();
    phase = 1;
    t.capture();
    assert.deepEqual(pids(t), [700]);
  });

  it('does not attribute a child to a parent pid that was reused (parent younger than child)', () => {
    const t = setup(() => [...base, mk(4000, SELF, 500, 'late-parent'), mk(4001, 4000, 10, 'older-child')]);
    t.capture();
    // 4001 is older than its "parent" so it is not a descendant; it started after the run => not an orphan either (parent exists but younger => orphan)
    assert.deepEqual(pids(t), [4000, 4001]);
  });

  it('keeps tracked processes across captures and records their later children', () => {
    let list: ProcInfo[] = [...base, mk(1001, SELF, 10)];
    let phase = 0;
    const t = new ProcessTracker({
      selfPid: SELF,
      now: () => T0,
      listProcesses: () => (phase === 0 ? base : list),
      listDockerContainers: () => [],
    });
    t.begin();
    phase = 1;
    t.capture();
    list = [...base, mk(1001, 1, 10), mk(1005, 1001, 80)]; // agent exited and was reparented
    t.capture();
    assert.deepEqual(pids(t), [1001, 1005]);
  });

  it('records new docker containers only', () => {
    const t = setup(() => base, { before: ['aaa111'], after: ['aaa111', 'bbb222'] });
    t.capture();
    assert.deepEqual(t.getTrackedContainers(), ['bbb222']);
  });

  it('does nothing before begin() and when listing fails', () => {
    const t = new ProcessTracker({ selfPid: SELF, listProcesses: () => [], listDockerContainers: () => [] });
    t.capture();
    assert.deepEqual(t.getTrackedProcesses(), []);
    t.begin();
    t.capture();
    assert.deepEqual(t.getTrackedProcesses(), []);
  });
});

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  parsePsOutput,
  parseWindowsProcessJson,
  parseDockerPsOutput,
  listProcesses,
  listDockerContainers,
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

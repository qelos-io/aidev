import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ProcessTracker, ProcInfo } from '../processCleanup';

const SELF = 500;
const T0 = 1_700_000_000_000;
const base: ProcInfo[] = [
  { pid: 1, ppid: 0, name: 'init', startTime: T0 - 100000 },
  { pid: 400, ppid: 1, name: 'shell', startTime: T0 - 90000 },
  { pid: SELF, ppid: 400, name: 'aidev', startTime: T0 - 80000 },
  { pid: 300, ppid: 1, name: 'preexisting-server', startTime: T0 - 70000 },
];
const spawned: ProcInfo[] = [
  ...base,
  { pid: 600, ppid: SELF, name: 'npm', startTime: T0 + 1000 },
  { pid: 601, ppid: 600, name: 'node', startTime: T0 + 2000 },
];

interface SetupOpts {
  /** Process list returned during shutdown; receives the call count. */
  alive?: (call: number) => ProcInfo[];
  dockerNow?: string[];
  isWindows?: boolean;
  throwOnKill?: boolean;
}

function setup(afterSpawn: ProcInfo[], opts: SetupOpts = {}) {
  let phase = 0; // 0 = begin, 1 = capture, 2 = shutdown
  let shutdownCalls = 0;
  const kills: [number, string][] = [];
  const cmds: [string, string[]][] = [];
  const tracker = new ProcessTracker({
    listProcesses: () => {
      if (phase === 0) return base;
      if (phase === 1) return afterSpawn;
      return opts.alive ? opts.alive(++shutdownCalls) : afterSpawn;
    },
    listDockerContainers: () => (phase === 0 ? ['aaa'] : opts.dockerNow ?? ['aaa']),
    selfPid: SELF,
    now: () => T0,
    kill: (pid, sig) => {
      if (opts.throwOnKill) throw Object.assign(new Error('denied'), { code: 'EPERM' });
      kills.push([pid, sig]);
    },
    runCommand: (cmd, args) => {
      cmds.push([cmd, args]);
      return true;
    },
    sleep: async () => {},
    isWindows: opts.isWindows ?? false,
  });
  tracker.begin();
  phase = 1;
  tracker.capture();
  phase = 2;
  return { tracker, kills, cmds };
}

describe('ProcessTracker.shutdown', () => {
  it('terminates deepest child first and never touches self, ancestors or baseline', async () => {
    const { tracker, kills } = setup(spawned);
    const res = await tracker.shutdown();
    assert.deepEqual(res.processes.map((p) => p.pid), [601, 600]);
    assert.deepEqual(kills.slice(0, 2), [[601, 'SIGTERM'], [600, 'SIGTERM']]);
    const killed = new Set(kills.map(([p]) => p));
    for (const safe of [1, 300, 400, SELF]) assert.equal(killed.has(safe), false);
  });

  it('escalates to SIGKILL only for processes still alive after the grace period', async () => {
    const { tracker, kills } = setup(spawned, {
      alive: (call) => (call === 1 ? spawned : spawned.filter((p) => p.pid !== 601)),
    });
    await tracker.shutdown();
    assert.deepEqual(kills.filter(([, s]) => s === 'SIGKILL'), [[600, 'SIGKILL']]);
  });

  it('skips processes whose pid was reused by a different process', async () => {
    const reused = spawned.map((p) => (p.pid === 601 ? { ...p, startTime: T0 + 999999 } : p));
    const { tracker, kills } = setup(spawned, { alive: () => reused });
    const res = await tracker.shutdown();
    assert.deepEqual(res.processes.map((p) => p.pid), [600]);
    assert.equal(kills.some(([p]) => p === 601), false);
  });

  it('dry-run kills and stops nothing', async () => {
    const { tracker, kills, cmds } = setup(spawned, { dockerNow: ['aaa', 'bbb'] });
    const res = await tracker.shutdown({ dryRun: true });
    assert.equal(kills.length, 0);
    assert.equal(cmds.length, 0);
    assert.equal(res.processes.length, 2);
    assert.deepEqual(res.containers, ['bbb']);
  });

  it('stops only new docker containers, with array args', async () => {
    const { tracker, cmds } = setup(base, { dockerNow: ['aaa', 'bbb', 'ccc'] });
    await tracker.shutdown();
    assert.deepEqual(cmds, [['docker', ['stop', 'bbb', 'ccc']]]);
  });

  it('uses taskkill /T /F on Windows and does not signal', async () => {
    const { tracker, cmds, kills } = setup(spawned, { isWindows: true });
    await tracker.shutdown();
    assert.deepEqual(cmds, [
      ['taskkill', ['/PID', '601', '/T', '/F']],
      ['taskkill', ['/PID', '600', '/T', '/F']],
    ]);
    assert.equal(kills.length, 0);
  });

  it('swallows kill errors', async () => {
    const { tracker } = setup(spawned, { throwOnKill: true });
    await assert.doesNotReject(tracker.shutdown());
  });

  it('kills nothing when process listing fails at shutdown', async () => {
    const { tracker, kills } = setup(spawned, { alive: () => [] });
    const res = await tracker.shutdown();
    assert.equal(res.processes.length, 0);
    assert.equal(kills.length, 0);
  });
});

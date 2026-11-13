import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { isWindows, killProcessTree, listDescendantPids } from '../platform';
import { runSpawnAttempts } from '../ai/spawnAttempts';

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitUntil(predicate: () => boolean, ms: number): Promise<boolean> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  return predicate();
}

// A parent node process that starts a long-lived grandchild which inherits stdout, then prints
// the grandchild pid and sleeps itself — the shape of "agent CLI that launched jest".
const PARENT_SCRIPT = `
const { spawn } = require('node:child_process');
const gc = spawn(process.execPath, ['-e', 'setTimeout(()=>{}, 60000)'], { stdio: ['ignore', 'inherit', 'inherit'] });
console.log('GRANDCHILD:' + gc.pid);
setTimeout(() => {}, 60000);
`;

describe('process tree handling', { skip: isWindows }, () => {
  it('listDescendantPids finds grandchildren', async () => {
    const parent = spawn(process.execPath, ['-e', PARENT_SCRIPT], { stdio: ['ignore', 'pipe', 'inherit'] });
    let out = '';
    parent.stdout.on('data', (c) => (out += c.toString()));
    try {
      assert.ok(await waitUntil(() => /GRANDCHILD:\d+/.test(out), 5000));
      const gcPid = Number(/GRANDCHILD:(\d+)/.exec(out)![1]);
      assert.ok(listDescendantPids(parent.pid!).includes(gcPid));
    } finally {
      killProcessTree(parent.pid!);
    }
  });

  it('killProcessTree kills the whole tree, not just the direct child', async () => {
    const parent = spawn(process.execPath, ['-e', PARENT_SCRIPT], { stdio: ['ignore', 'pipe', 'inherit'] });
    let out = '';
    parent.stdout.on('data', (c) => (out += c.toString()));
    assert.ok(await waitUntil(() => /GRANDCHILD:\d+/.test(out), 5000));
    const gcPid = Number(/GRANDCHILD:(\d+)/.exec(out)![1]);

    killProcessTree(parent.pid!);

    assert.ok(await waitUntil(() => !isAlive(gcPid), 5000), 'grandchild should be dead');
  });

  it('runSpawnAttempts returns on timeout even when a grandchild keeps the pipes open, and cleans it up', async () => {
    const started = Date.now();
    const result = await runSpawnAttempts(process.execPath, [['-e', PARENT_SCRIPT]], {
      timeout: 500,
      encoding: 'utf8',
    });
    assert.ok(Date.now() - started < 8000, 'must not wait for the orphaned grandchild');
    assert.equal(result.error?.message, 'timeout');
    const gcPid = Number(/GRANDCHILD:(\d+)/.exec(result.stdout)?.[1]);
    assert.ok(Number.isInteger(gcPid));
    assert.ok(await waitUntil(() => !isAlive(gcPid), 5000), 'grandchild should be killed with the runner');
  });
});

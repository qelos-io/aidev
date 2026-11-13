import { EventEmitter } from 'node:events';
import { mock } from 'node:test';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const childProcess = require('node:child_process');

type SyncResult = {
  status?: number | null;
  stdout?: string;
  stderr?: string;
  error?: Error;
  [key: string]: unknown;
};
type SyncImpl = (cmd: unknown, args: unknown, opts: unknown) => SyncResult;

/**
 * Replaces `spawnSync` AND `spawn` with the same synchronous-style implementation, so
 * code paths that run an agent CLI asynchronously (see runSpawnAttempts) can be tested
 * with the `{ status, stdout, stderr, error }` results the older tests already return.
 * Returns the `spawnSync` mock for backwards compatibility; the `spawn` mock is on `.spawn`.
 */
export function mockSpawnBoth(impl: SyncImpl) {
  const spawnMock = mock.method(childProcess, 'spawn', (cmd: unknown, args: unknown, opts: unknown) => {
    const child = new EventEmitter() as EventEmitter & Record<string, unknown>;
    const stdout = new EventEmitter() as EventEmitter & { destroy: () => void };
    const stderr = new EventEmitter() as EventEmitter & { destroy: () => void };
    stdout.destroy = () => {};
    stderr.destroy = () => {};
    let input: string | undefined;
    const stdin = Object.assign(new EventEmitter(), {
      write: (chunk: string | Buffer) => {
        input = (input ?? '') + chunk.toString();
        return true;
      },
      end: () => {},
    });
    child.pid = 4242;
    child.stdout = stdout;
    child.stderr = stderr;
    child.stdin = stdin;
    child.kill = () => true;
    setImmediate(() => {
      // Run the implementation lazily so it sees what was piped to stdin, like spawnSync's `input` option.
      const result = impl(cmd, args, { ...((opts as object) ?? {}), ...(input !== undefined ? { input } : {}) });
      if (result.error) {
        child.emit('error', result.error);
        return;
      }
      if (result.stdout) stdout.emit('data', Buffer.from(result.stdout));
      if (result.stderr) stderr.emit('data', Buffer.from(result.stderr));
      child.emit('close', result.status ?? 0);
    });
    return child;
  });
  const syncMock = mock.method(childProcess, 'spawnSync', impl);
  return Object.assign(syncMock, { spawn: spawnMock });
}

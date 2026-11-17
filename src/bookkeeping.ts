import * as fs from 'node:fs';
import { lockfilePath, readLock } from './lockfile';
import { activeTaskPath, readActivePid } from './activeTask';
import { logger } from './logger';

/** Unlink a file, retrying once on failure. Never throws; a missing file is success. */
function removeBestEffort(file: string): void {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      fs.unlinkSync(file);
      return;
    } catch (err) {
      if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') return;
    }
  }
}

/**
 * Remove `.aidev.lock` and `.aidev.active` in `cwd`, but only when they belong to the
 * current process. Idempotent and never throws, so it is safe to call from exit,
 * signal and fatal-error handlers (and again from `finally`).
 *
 * Ownership: the lock is ours when its PID is ours. The active file is ours when its
 * own PID is ours, or (legacy id-only file) when the lock is ours.
 */
export function cleanupBookkeeping(cwd: string, pid: number = process.pid): void {
  try {
    const lockOwner = readLock(cwd);
    const activeOwner = readActivePid(cwd) ?? lockOwner;
    if (activeOwner === pid) removeBestEffort(activeTaskPath(cwd));
    if (lockOwner === pid) removeBestEffort(lockfilePath(cwd));
  } catch {
    // best-effort: never throw from cleanup
  }
}

export interface CleanupRegistration {
  /** Detach every handler registered by {@link registerBookkeepingCleanup}. */
  dispose(): void;
}

/**
 * Make sure the bookkeeping files are removed however the process ends.
 * - `exit`: synchronous cleanup.
 * - `signals` (default none — callers with async teardown handle their own): cleanup,
 *   then exit with 128 + signal number.
 * - `uncaughtException` / `unhandledRejection`: log, cleanup, exit with code 1.
 */
export function registerBookkeepingCleanup(
  cwd: string,
  opts: {
    signals?: NodeJS.Signals[];
    /** Async teardown (child processes, servers, ...) run before the lock is released on fatal errors / signals. */
    onShutdown?: () => Promise<void> | void;
    /** Max time to wait for onShutdown before exiting anyway. */
    shutdownTimeoutMs?: number;
  } = {}
): CleanupRegistration {
  const onExit = (): void => cleanupBookkeeping(cwd);
  let exiting = false;
  const finish = (code: number): void => {
    if (exiting) return;
    exiting = true;
    let done = false;
    const exit = (): void => {
      if (done) return;
      done = true;
      cleanupBookkeeping(cwd);
      process.exit(code);
    };
    // Teardown first so orphans are gone before the lock is released.
    const timer = setTimeout(exit, opts.shutdownTimeoutMs ?? 15000);
    timer.unref?.();
    try {
      Promise.resolve(opts.onShutdown?.()).catch(() => undefined).finally(() => {
        clearTimeout(timer);
        exit();
      });
    } catch {
      clearTimeout(timer);
      exit();
    }
  };
  const onFatal = (label: string) => (err: unknown): void => {
    try {
      logger.error(`${label}: ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
    } catch { /* ignore */ }
    finish(1);
  };
  const onException = onFatal('Uncaught exception');
  const onRejection = onFatal('Unhandled rejection');
  const signalCodes: Record<string, number> = { SIGHUP: 129, SIGINT: 130, SIGTERM: 143 };
  const signalHandlers = new Map<NodeJS.Signals, () => void>();
  for (const sig of opts.signals ?? []) {
    const handler = (): void => {
      logger.warn(`Received ${sig} — cleaning up...`);
      finish(signalCodes[sig] ?? 1);
    };
    signalHandlers.set(sig, handler);
    process.on(sig, handler);
  }

  process.on('exit', onExit);
  process.on('uncaughtException', onException);
  process.on('unhandledRejection', onRejection);

  return {
    dispose(): void {
      process.removeListener('exit', onExit);
      process.removeListener('uncaughtException', onException);
      process.removeListener('unhandledRejection', onRejection);
      for (const [sig, handler] of signalHandlers) process.removeListener(sig, handler);
    },
  };
}

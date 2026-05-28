import type { ChildProcess } from 'node:child_process';

// Single-flight: only one `aidev run` may be in-flight at a time. The same
// working tree can't safely host parallel runs (lockfile + git branch ops), so
// run.post.ts rejects a second start while one is active and run/cancel.post.ts
// reads from this state to send SIGTERM.
//
// Module-level state survives across requests within the same Nitro worker.
// A server restart drops the reference, which is fine — the spawned child is
// our own subprocess and will exit when the parent (Nitro) goes down.
interface ActiveRun {
  child: ChildProcess;
  status: string;
  startedAt: number;
}

let active: ActiveRun | null = null;

export function getActiveRun(): ActiveRun | null {
  if (active && active.child.exitCode === null && !active.child.killed) {
    return active;
  }
  return null;
}

export function setActiveRun(child: ChildProcess, status: string): void {
  active = { child, status, startedAt: Date.now() };
}

export function clearActiveRun(child: ChildProcess): void {
  // Only clear if the caller still owns the slot — a late `exit` from a
  // previously-cancelled child must not wipe out a freshly-started one.
  if (active && active.child === child) {
    active = null;
  }
}

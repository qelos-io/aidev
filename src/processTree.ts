import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { platform } from 'node:os';

// Module-level cache: pid -> parent pid (or null if unresolvable).
const pidCache = new Map<number, number | null>();

const isWindows = platform() === 'win32';

/**
 * Returns the parent PID of `pid`, or null if it cannot be determined / pid is invalid.
 */
export function getParentPid(pid: number): number | null {
  if (!Number.isInteger(pid) || pid <= 0) return null;
  if (pidCache.has(pid)) return pidCache.get(pid)!;

  let parent: number | null = null;
  try {
    if (isWindows) {
      parent = getParentPidWindows(pid);
    } else {
      parent = getParentPidPosix(pid);
    }
  } catch {
    parent = null;
  }

  pidCache.set(pid, parent);
  return parent;
}

function getParentPidPosix(pid: number): number | null {
  // Linux: /proc/<pid>/stat — 4th field is ppid.
  const statPath = `/proc/${pid}/stat`;
  try {
    const stat = readFileSync(statPath, 'utf8');
    // The 2nd field (comm) may contain spaces and is wrapped in parens.
    // Find the last ')' and parse fields after it.
    const closeParen = stat.lastIndexOf(')');
    if (closeParen === -1) return null;
    const rest = stat.slice(closeParen + 1).trim().split(/\s+/);
    // After comm, fields are: state ppid ... — rest[0] = state, rest[1] = ppid.
    const ppid = parseInt(rest[1], 10);
    return Number.isNaN(ppid) ? null : ppid;
  } catch {
    // /proc unavailable (e.g. macOS) — fall back to ps.
  }

  const r = spawnSync('ps', ['-o', 'ppid=', '-p', String(pid)], {
    encoding: 'utf8',
    timeout: 5000,
  });
  if (r.status !== 0 || r.error) return null;
  const parsed = parseInt((r.stdout ?? '').trim(), 10);
  return Number.isNaN(parsed) ? null : parsed;
}

function getParentPidWindows(pid: number): number | null {
  // Build the WMI filter string in JS and pass it as a single argument — no
  // shell interpolation of the pid.
  const filter = `ProcessId=${pid}`;
  const r = spawnSync(
    'powershell',
    ['-NoProfile', '-Command', `(Get-CimInstance Win32_Process -Filter "${filter}").ParentProcessId`],
    { encoding: 'utf8', timeout: 5000 },
  );
  if (r.status !== 0 || r.error) return null;
  const parsed = parseInt((r.stdout ?? '').trim(), 10);
  return Number.isNaN(parsed) ? null : parsed;
}

/**
 * Walks the ancestor chain of the current process (process.ppid upward) and
 * returns true if `targetPid` appears anywhere in that chain. Stops at PID 0/1
 * (init) or when a PID cannot be resolved. Returns false on any error.
 */
export function isAncestorPid(targetPid: number): boolean {
  if (targetPid <= 0 || targetPid === process.pid) return false;
  const ancestors = getAncestorPids();
  return ancestors.includes(targetPid);
}

/**
 * Returns the list of ancestor PIDs from the immediate parent up to init,
 * excluding the current process. Empty array if nothing could be resolved.
 */
export function getAncestorPids(): number[] {
  const result: number[] = [];
  const visited = new Set<number>();
  let current: number | null = process.ppid;

  while (current !== null && current > 1 && !visited.has(current)) {
    visited.add(current);
    result.push(current);
    current = getParentPid(current);
  }

  return result;
}

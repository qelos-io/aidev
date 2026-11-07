import { spawnSync } from 'node:child_process';
import { platform } from 'node:os';
import { logger } from './logger';

export interface ProcInfo {
  pid: number;
  ppid: number;
  name: string;
  /** Process start time in epoch milliseconds, when it could be determined. */
  startTime?: number;
}

const PS_LINE = /^\s*(\d+)\s+(\d+)\s+(\w{3}\s+\w{3}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2}\s+\d{4})\s+(.+?)\s*$/;

/**
 * Parses the output of `ps -axo pid=,ppid=,lstart=,comm=`.
 * Unparseable lines are skipped.
 */
export function parsePsOutput(output: string): ProcInfo[] {
  const result: ProcInfo[] = [];
  for (const line of output.split(/\r?\n/)) {
    const m = PS_LINE.exec(line);
    if (!m) continue;
    const pid = Number(m[1]);
    const ppid = Number(m[2]);
    if (!Number.isInteger(pid) || !Number.isInteger(ppid)) continue;
    const parsed = Date.parse(m[3].replace(/\s+/g, ' '));
    const proc: ProcInfo = { pid, ppid, name: m[4] };
    if (!Number.isNaN(parsed)) proc.startTime = parsed;
    result.push(proc);
  }
  return result;
}

/** Converts a PowerShell CreationDate value (`/Date(ms)/`, ISO string, or ms number) to epoch ms. */
function parseWindowsDate(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return undefined;
  const legacy = /\/Date\((-?\d+)\)\//.exec(value);
  if (legacy) return Number(legacy[1]);
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? undefined : parsed;
}

/**
 * Parses the JSON from
 * `Get-CimInstance Win32_Process | Select ProcessId,ParentProcessId,Name,CreationDate | ConvertTo-Json`.
 * ConvertTo-Json emits a bare object (not an array) when there is a single process.
 */
export function parseWindowsProcessJson(output: string): ProcInfo[] {
  const text = output.replace(/^﻿/, '').trim();
  if (!text) return [];
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return [];
  }
  const items = Array.isArray(data) ? data : [data];
  const result: ProcInfo[] = [];
  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    const rec = item as Record<string, unknown>;
    const pid = Number(rec.ProcessId);
    const ppid = Number(rec.ParentProcessId);
    if (!Number.isInteger(pid) || !Number.isInteger(ppid)) continue;
    const proc: ProcInfo = { pid, ppid, name: typeof rec.Name === 'string' ? rec.Name : '' };
    const startTime = parseWindowsDate(rec.CreationDate);
    if (startTime !== undefined) proc.startTime = startTime;
    result.push(proc);
  }
  return result;
}

/** Parses the output of `docker ps -q` into container ids. */
export function parseDockerPsOutput(output: string): string[] {
  return output
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => /^[0-9a-f]+$/i.test(l));
}

/**
 * Lists all running processes. Returns [] (and logs a warning) on failure.
 */
export function listProcesses(): ProcInfo[] {
  const isWindows = platform() === 'win32';
  const cmd = isWindows ? 'powershell' : 'ps';
  const args = isWindows
    ? [
        '-NoProfile',
        '-Command',
        'Get-CimInstance Win32_Process | Select ProcessId,ParentProcessId,Name,CreationDate | ConvertTo-Json',
      ]
    : ['-axo', 'pid=,ppid=,lstart=,comm='];

  try {
    const res = spawnSync(cmd, args, {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      windowsHide: true,
      env: isWindows ? process.env : { ...process.env, LC_ALL: 'C' },
    });
    if (res.error || res.status !== 0) {
      logger.warn(`Could not list processes (${cmd}): ${res.error?.message ?? res.stderr?.trim() ?? `exit ${res.status}`}`);
      return [];
    }
    return isWindows ? parseWindowsProcessJson(res.stdout) : parsePsOutput(res.stdout);
  } catch (err) {
    logger.warn(`Could not list processes (${cmd}): ${err instanceof Error ? err.message : String(err)}`);
    return [];
  }
}

/**
 * Lists running docker container ids. Returns [] silently if docker is missing
 * or its daemon is unavailable.
 */
export function listDockerContainers(): string[] {
  try {
    const res = spawnSync('docker', ['ps', '-q'], { encoding: 'utf8', windowsHide: true });
    if (res.error || res.status !== 0) return [];
    return parseDockerPsOutput(res.stdout);
  } catch {
    return [];
  }
}

/** A process recorded for shutdown. pid + startTime identify it (guards against PID reuse). */
export interface TrackedProcess {
  pid: number;
  ppid: number;
  name: string;
  startTime?: number;
}

export interface ProcessTrackerOptions {
  listProcesses?: () => ProcInfo[];
  listDockerContainers?: () => string[];
  /** PID treated as "aidev itself". Defaults to process.pid. */
  selfPid?: number;
  /** Clock used to stamp the beginning of the run. Defaults to Date.now. */
  now?: () => number;
}

/** Start times from `ps` have 1s resolution; allow slack when comparing. */
const START_TIME_TOLERANCE_MS = 2000;

/** True when both start times are known and differ, i.e. the pid belongs to a different process. */
export function isDifferentProcess(a: number | undefined, b: number | undefined): boolean {
  if (a === undefined || b === undefined) return false;
  return Math.abs(a - b) > START_TIME_TOLERANCE_MS;
}

/**
 * Tracks processes (and docker containers) started during an aidev run so they can be
 * cleaned up at the end. `begin()` snapshots the baseline; `capture()` records new
 * descendants/orphans; nothing is killed here.
 */
export class ProcessTracker {
  private readonly lister: () => ProcInfo[];
  private readonly dockerLister: () => string[];
  private readonly selfPid: number;
  private readonly now: () => number;

  private runStart = 0;
  private begun = false;
  private baseline = new Map<number, number | undefined>();
  private baselineContainers = new Set<string>();
  private readonly tracked = new Map<number, TrackedProcess>();
  private readonly containers = new Set<string>();

  constructor(opts: ProcessTrackerOptions = {}) {
    this.lister = opts.listProcesses ?? listProcesses;
    this.dockerLister = opts.listDockerContainers ?? listDockerContainers;
    this.selfPid = opts.selfPid ?? process.pid;
    this.now = opts.now ?? Date.now;
  }

  /** Snapshots the pre-existing processes and containers. */
  begin(): void {
    this.runStart = this.now();
    this.baseline = new Map(this.lister().map((p) => [p.pid, p.startTime]));
    this.baselineContainers = new Set(this.dockerLister());
    this.tracked.clear();
    this.containers.clear();
    this.begun = true;
  }

  /** Records new descendants of aidev, and new orphans, plus new docker containers. */
  capture(): void {
    if (!this.begun) return;
    const procs = this.lister();
    if (procs.length > 0) this.captureProcesses(procs);
    for (const id of this.dockerLister()) {
      if (!this.baselineContainers.has(id)) this.containers.add(id);
    }
  }

  getTrackedProcesses(): TrackedProcess[] {
    return [...this.tracked.values()];
  }

  getTrackedContainers(): string[] {
    return [...this.containers];
  }

  private isBaseline(p: ProcInfo): boolean {
    if (!this.baseline.has(p.pid)) return false;
    // Same pid with a clearly different start time => pid was reused by a new process.
    return !isDifferentProcess(this.baseline.get(p.pid), p.startTime);
  }

  private captureProcesses(procs: ProcInfo[]): void {
    const byPid = new Map<number, ProcInfo>(procs.map((p) => [p.pid, p]));

    // Never touch aidev itself or any of its ancestors.
    const protectedPids = new Set<number>([this.selfPid]);
    for (let cur = byPid.get(this.selfPid); cur && !protectedPids.has(cur.ppid); cur = byPid.get(cur.ppid)) {
      protectedPids.add(cur.ppid);
    }

    const isTracked = (p: ProcInfo): boolean => {
      const t = this.tracked.get(p.pid);
      return !!t && !isDifferentProcess(t.startTime, p.startTime);
    };

    // Walks up the parent chain; true if it reaches aidev or an already tracked process.
    const descendsFromRun = (p: ProcInfo): boolean => {
      const seen = new Set<number>([p.pid]);
      let child = p;
      for (;;) {
        const parent = byPid.get(child.ppid);
        if (!parent || seen.has(parent.pid)) return false;
        // A parent cannot be younger than its child; otherwise the ppid was reused.
        if (
          parent.startTime !== undefined &&
          child.startTime !== undefined &&
          parent.startTime - child.startTime > START_TIME_TOLERANCE_MS
        ) {
          return false;
        }
        if (parent.pid === this.selfPid) return true;
        if (isTracked(parent)) return true;
        seen.add(parent.pid);
        child = parent;
      }
    };

    const isOrphan = (p: ProcInfo): boolean => {
      if (p.startTime === undefined || p.startTime < this.runStart - START_TIME_TOLERANCE_MS) return false;
      if (p.ppid <= 1) return true;
      const parent = byPid.get(p.ppid);
      if (!parent) return true;
      // Parent pid exists but is younger than the child => original parent died, pid reused.
      return parent.startTime !== undefined && parent.startTime - p.startTime > START_TIME_TOLERANCE_MS;
    };

    // Iterate until stable so that chains discovered out of order are all picked up.
    let changed = true;
    while (changed) {
      changed = false;
      for (const p of procs) {
        if (p.pid <= 1 || protectedPids.has(p.pid) || this.isBaseline(p) || isTracked(p)) continue;
        if (descendsFromRun(p) || isOrphan(p)) {
          this.tracked.set(p.pid, { pid: p.pid, ppid: p.ppid, name: p.name, startTime: p.startTime });
          changed = true;
        }
      }
    }
  }
}

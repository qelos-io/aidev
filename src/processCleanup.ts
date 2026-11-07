import { spawnSync } from 'node:child_process';
import { platform } from 'node:os';
import chalk from 'chalk';
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
  /** Sends a signal to a pid. Defaults to process.kill. */
  kill?: (pid: number, signal: NodeJS.Signals) => void;
  /** Runs an external command with array args; returns true on success. Defaults to spawnSync. */
  runCommand?: (cmd: string, args: string[]) => boolean;
  /** Waits for the given ms. Defaults to setTimeout. */
  sleep?: (ms: number) => Promise<void>;
  /** Overrides platform detection (true = Windows). */
  isWindows?: boolean;
  /** Grace period between SIGTERM and SIGKILL. Defaults to 3000ms. */
  graceMs?: number;
}

export interface ShutdownOptions {
  /** Only log what would be stopped; kill nothing. */
  dryRun?: boolean;
}

export interface ShutdownResult {
  processes: TrackedProcess[];
  containers: string[];
}

function defaultRunCommand(cmd: string, args: string[]): boolean {
  const res = spawnSync(cmd, args, { encoding: 'utf8', windowsHide: true });
  return !res.error && res.status === 0;
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
  private readonly killFn: (pid: number, signal: NodeJS.Signals) => void;
  private readonly runCommand: (cmd: string, args: string[]) => boolean;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly isWindows: boolean;
  private readonly graceMs: number;

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
    this.killFn = opts.kill ?? ((pid, signal) => { process.kill(pid, signal); });
    this.runCommand = opts.runCommand ?? defaultRunCommand;
    this.sleep = opts.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.isWindows = opts.isWindows ?? platform() === 'win32';
    this.graceMs = opts.graceMs ?? 3000;
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

  /**
   * Stops the tracked processes that are still alive (matching pid + start time) and the
   * tracked docker containers. Never touches aidev itself, its ancestors, or baseline processes.
   * Errors are logged per item and never thrown.
   */
  async shutdown(opts: ShutdownOptions = {}): Promise<ShutdownResult> {
    const result: ShutdownResult = { processes: [], containers: [] };
    if (!this.begun) return result;
    const dryRun = !!opts.dryRun;
    const prefix = dryRun ? '[dry-run] Would stop' : 'Stopping';

    try {
      result.processes = await this.shutdownProcesses(dryRun, prefix);
    } catch (err) {
      logger.warn(`Process cleanup failed: ${err instanceof Error ? err.message : String(err)}`);
    }

    const ids = [...this.containers].filter((id) => /^[0-9a-f]+$/i.test(id));
    if (ids.length > 0) {
      console.log(chalk.cyan(`${prefix} ${ids.length} docker container(s): ${ids.join(', ')}`));
      if (dryRun) {
        result.containers = ids;
      } else {
        try {
          if (this.runCommand('docker', ['stop', ...ids])) result.containers = ids;
          else logger.warn('docker stop failed for one or more containers');
        } catch (err) {
          logger.warn(`docker stop failed: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    }

    if (result.processes.length === 0 && result.containers.length === 0) {
      logger.debug('Auto-shutdown: nothing to clean up');
    } else {
      console.log(
        chalk.green(
          `${dryRun ? '[dry-run] ' : ''}Auto-shutdown: ${result.processes.length} process(es), ${result.containers.length} container(s)`,
        ),
      );
    }
    if (!dryRun) {
      this.tracked.clear();
      this.containers.clear();
    }
    return result;
  }

  /** Tracked processes that are still the same live process and safe to kill, deepest first. */
  private killableNow(): TrackedProcess[] {
    if (this.tracked.size === 0) return [];
    const procs = this.lister();
    if (procs.length === 0) return [];
    const byPid = new Map<number, ProcInfo>(procs.map((p) => [p.pid, p]));

    const protectedPids = new Set<number>([this.selfPid, process.pid]);
    for (let cur = byPid.get(this.selfPid); cur && !protectedPids.has(cur.ppid); cur = byPid.get(cur.ppid)) {
      protectedPids.add(cur.ppid);
    }

    const depth = (p: ProcInfo): number => {
      const seen = new Set<number>([p.pid]);
      let d = 0;
      for (let cur = byPid.get(p.ppid); cur && !seen.has(cur.pid); cur = byPid.get(cur.ppid)) {
        seen.add(cur.pid);
        d++;
      }
      return d;
    };

    const out: { t: TrackedProcess; depth: number }[] = [];
    for (const t of this.tracked.values()) {
      const live = byPid.get(t.pid);
      if (!live || t.pid <= 1 || protectedPids.has(t.pid)) continue;
      if (isDifferentProcess(t.startTime, live.startTime)) continue;
      if (this.baseline.has(t.pid) && !isDifferentProcess(this.baseline.get(t.pid), live.startTime)) continue;
      out.push({ t, depth: depth(live) });
    }
    return out.sort((a, b) => b.depth - a.depth).map((x) => x.t);
  }

  private async shutdownProcesses(dryRun: boolean, prefix: string): Promise<TrackedProcess[]> {
    const targets = this.killableNow();
    if (targets.length === 0) return [];
    console.log(chalk.cyan(`${prefix} ${targets.length} leftover process(es):`));
    for (const t of targets) console.log(chalk.gray(`  ${t.pid} ${t.name}`));
    if (dryRun) return targets;

    if (this.isWindows) {
      for (const t of targets) {
        try {
          this.runCommand('taskkill', ['/PID', String(t.pid), '/T', '/F']);
        } catch (err) {
          logger.warn(`Failed to kill ${t.pid}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      return targets;
    }

    for (const t of targets) this.signal(t.pid, 'SIGTERM');
    await this.sleep(this.graceMs);
    // Re-verify: only escalate for processes that are still the same live process.
    const remaining = new Set(this.killableNow().map((t) => t.pid));
    for (const t of targets) {
      if (remaining.has(t.pid)) this.signal(t.pid, 'SIGKILL');
    }
    return targets;
  }

  private signal(pid: number, signal: NodeJS.Signals): void {
    try {
      this.killFn(pid, signal);
    } catch (err) {
      if ((err as NodeJS.ErrnoException)?.code !== 'ESRCH') {
        logger.warn(`Failed to send ${signal} to ${pid}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
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

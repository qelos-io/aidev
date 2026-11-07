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

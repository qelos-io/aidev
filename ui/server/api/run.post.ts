import { defineEventHandler, readBody, createEventStream, createError } from 'h3';
import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { getActiveRun, setActiveRun, clearActiveRun } from '../utils/currentRun';

type RunStatus = 'open' | 'pending' | 'review' | 'all';
const STATUSES: ReadonlySet<RunStatus> = new Set(['open', 'pending', 'review', 'all']);

/**
 * Spawn `aidev run --status <status>` from `AIDEV_CWD` and stream stdout/stderr
 * to the browser via SSE. The Run screen uses this for all four action buttons.
 *
 * Why POST + manual SSE: this endpoint side-effects (spawns a process), and
 * EventSource is GET-only — so the frontend uses fetch+ReadableStream and
 * parses SSE frames itself. Same pattern as tasks/[id]/execute.post.ts.
 *
 * SSE event names:
 *   - `stdout` / `stderr`: one line at a time (data = the line, no trailing \n)
 *   - `exit`: JSON `{ code, signal, durationMs }` when the child terminates
 *   - `error`: JSON `{ message, code }` for spawn-level failures (ENOENT etc.)
 *
 * Single-flight: returns 409 if another run is already active. The PID is held
 * in module-level state (utils/currentRun.ts) so /api/run/cancel can SIGTERM it.
 */
export default defineEventHandler(async (event) => {
  const body = await readBody<{ status?: string }>(event);
  const status = (body?.status ?? '') as RunStatus;
  if (!STATUSES.has(status)) {
    throw createError({
      statusCode: 400,
      statusMessage: `Invalid status "${body?.status}". Expected one of: open, pending, review, all.`,
    });
  }

  const cwd = process.env.AIDEV_CWD;
  if (!cwd) {
    throw createError({ statusCode: 500, statusMessage: 'AIDEV_CWD not set' });
  }

  const pkgDir = process.env.AIDEV_PACKAGE_DIR ?? cwd;
  const cli = path.join(pkgDir, 'dist', 'cli.js');
  if (!fs.existsSync(cli)) {
    throw createError({
      statusCode: 503,
      statusMessage:
        `aidev CLI not found at ${cli}. Run \`npm run build\` in the aidev repo before triggering runs.`,
    });
  }

  if (getActiveRun()) {
    throw createError({
      statusCode: 409,
      statusMessage: 'Another aidev run is already in progress. Cancel it before starting a new one.',
    });
  }

  const stream = createEventStream(event);
  const startedAt = Date.now();

  const child = spawn(process.execPath, [cli, 'run', '--status', status], {
    cwd,
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  setActiveRun(child, status);

  // Line-buffer stdout/stderr separately so a partial chunk that splits mid-
  // line doesn't get pushed as two events. Anything remaining when the stream
  // ends (no trailing newline) is flushed in the close handler.
  function pump(source: NodeJS.ReadableStream, eventName: 'stdout' | 'stderr') {
    let buf = '';
    source.setEncoding('utf8');
    source.on('data', (chunk: string) => {
      buf += chunk;
      let nl = buf.indexOf('\n');
      while (nl !== -1) {
        const line = buf.slice(0, nl).replace(/\r$/, '');
        buf = buf.slice(nl + 1);
        stream.push({ event: eventName, data: line });
        nl = buf.indexOf('\n');
      }
    });
    source.on('end', () => {
      if (buf.length > 0) stream.push({ event: eventName, data: buf.replace(/\r$/, '') });
    });
  }

  pump(child.stdout, 'stdout');
  pump(child.stderr, 'stderr');

  child.on('error', (err: NodeJS.ErrnoException) => {
    stream.push({ event: 'error', data: JSON.stringify({ message: err.message, code: err.code }) });
    clearActiveRun(child);
    stream.close();
  });

  child.on('exit', (code, signal) => {
    stream.push({
      event: 'exit',
      data: JSON.stringify({ code, signal, durationMs: Date.now() - startedAt }),
    });
    clearActiveRun(child);
    stream.close();
  });

  // If the browser disconnects (tab closed, navigation away) we kill the child.
  // Otherwise it keeps holding the per-cwd lockfile and the next run would fail
  // with "aidev is already running". The user can explicitly cancel through
  // /api/run/cancel if they want to terminate without disconnecting.
  stream.onClosed(() => {
    if (!child.killed && child.exitCode === null) {
      child.kill('SIGTERM');
    }
    clearActiveRun(child);
  });

  return stream.send();
});

import { defineEventHandler, getRouterParam, createEventStream, createError } from 'h3';
import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { getActiveRun, setActiveRun, clearActiveRun } from '../../../utils/currentRun';

/**
 * Stream `aidev run --task <id>` stdout/stderr to the browser as SSE.
 *
 * The CLI runs in the same cwd the dashboard was launched from (AIDEV_CWD) so
 * branch operations / lockfiles / .env.aidev resolution match what the user
 * would see if they ran the command in their shell. We bind to the dist/cli.js
 * entry point — the same binary `aidev run` invokes — to avoid re-implementing
 * any of the run pipeline here.
 *
 * SSE event names:
 *   - `stdout` / `stderr`: one line at a time (data = the line, no trailing \n)
 *   - `exit`: JSON `{ code, signal }` when the child terminates
 *   - `error`: JSON `{ message }` for spawn-level failures (ENOENT etc.)
 */
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id');
  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'Missing task id' });
  }

  const cwd = process.env.AIDEV_CWD;
  if (!cwd) {
    throw createError({ statusCode: 500, statusMessage: 'AIDEV_CWD not set' });
  }

  const cli = path.join(cwd, 'dist', 'cli.js');
  if (!fs.existsSync(cli)) {
    throw createError({
      statusCode: 503,
      statusMessage:
        `aidev CLI not found at ${cli}. Run \`npm run build\` in the aidev repo before executing tasks.`,
    });
  }

  if (getActiveRun()) {
    throw createError({
      statusCode: 409,
      statusMessage: 'Another aidev run is already in progress. Cancel it before starting a new one.',
    });
  }

  const stream = createEventStream(event);

  const child = spawn(process.execPath, [cli, 'run', '--task', id], {
    cwd,
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  setActiveRun(child, 'task', id);

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
        // Fire-and-forget — the stream's internal queue handles backpressure.
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
    clearActiveRun(child);
    stream.push({ event: 'error', data: JSON.stringify({ message: err.message, code: err.code }) });
    stream.close();
  });

  child.on('exit', (code, signal) => {
    clearActiveRun(child);
    stream.push({ event: 'exit', data: JSON.stringify({ code, signal }) });
    stream.close();
  });

  // If the browser disconnects mid-run, take the spawned aidev down with it.
  // Otherwise the child keeps holding the per-cwd lockfile and the next run
  // would fail with "aidev is already running".
  stream.onClosed(() => {
    if (!child.killed && child.exitCode === null) {
      child.kill('SIGTERM');
    }
    clearActiveRun(child);
  });

  return stream.send();
});

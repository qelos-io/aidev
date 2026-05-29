import { defineEventHandler, createError } from 'h3';
import { getActiveRun } from '../../utils/currentRun';

/**
 * Send SIGTERM to the currently-running `aidev run` child, if any.
 *
 * The run.post.ts handler keeps the child reference in module state; the
 * `exit` listener there is what actually clears the slot — we just deliver
 * the signal. SIGTERM gives aidev a chance to release its lockfile and let
 * any in-progress AI runner detach cleanly, mirroring a Ctrl+C in the shell.
 */
export default defineEventHandler(() => {
  const active = getActiveRun();
  if (!active) {
    throw createError({ statusCode: 409, statusMessage: 'No aidev run is currently active.' });
  }

  const pid = active.child.pid;
  if (typeof pid !== 'number') {
    throw createError({ statusCode: 500, statusMessage: 'Active run has no PID.' });
  }

  try {
    process.kill(pid, 'SIGTERM');
  } catch (err) {
    // ESRCH = process already gone. Treat as success — the SSE stream's
    // `exit` event will reach the client either way.
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== 'ESRCH') {
      throw createError({
        statusCode: 500,
        statusMessage: `Failed to signal pid ${pid}: ${(err as Error).message}`,
      });
    }
  }

  return { ok: true, pid, status: active.status };
});

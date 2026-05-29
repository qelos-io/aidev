# Handover — Run screen

## Purpose

Surface the four entrypoints `aidev run` supports as buttons (Open, Pending,
Review, All), spawn the CLI in the same cwd the dashboard was launched from,
and stream stdout/stderr to the page in real time. Provides a single cancel
control. This is the most-used screen in day-to-day operation.

## Routes

Server (all gated by `ui/server/middleware/auth.ts`):

| Method | Path               | Description                                                                                                                          |
|--------|--------------------|--------------------------------------------------------------------------------------------------------------------------------------|
| POST   | `/api/run`         | Body: `{ status: 'open' \| 'pending' \| 'review' \| 'all' }`. Spawns the CLI and returns an SSE stream of stdout/stderr.            |
| POST   | `/api/run/cancel`  | Sends SIGTERM to the active run's child process. 409 if none active.                                                                 |

Single-flight: `/api/run` returns 409 if another run is already in progress.
The active child reference is held in `ui/server/utils/currentRun.ts` (module-
level state) so the cancel endpoint can SIGTERM it without round-tripping a
run id.

### Spawn invocation

```ts
spawn(process.execPath, [
  path.join(process.env.AIDEV_CWD!, 'dist/cli.js'),
  'run',
  '--status', status,         // 'open' | 'pending' | 'review' | 'all'
], { cwd: process.env.AIDEV_CWD, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] })
```

The CLI accepts `--status` as a long-form alias for the positional `[filter]`
argument (`src/cli.ts`). `--status review` is a new value added in this step:
it skips the open/pending task loops and runs only the in-review code-review
check. See `src/commands/run.ts`'s `getRunSkipReason` for the gating.

If `dist/cli.js` is missing, `/api/run` returns 503 with a message telling the
user to `npm run build` in the aidev repo first.

### SSE event shape

The response is `text/event-stream`. Each event has a name and a single `data:`
line (multi-line JSON is collapsed by the parser on the client):

| Event    | Payload                                                            |
|----------|--------------------------------------------------------------------|
| `stdout` | One line of CLI stdout (no trailing `\n`). UTF-8.                  |
| `stderr` | One line of CLI stderr.                                            |
| `exit`   | JSON `{ code: number\|null, signal: string\|null, durationMs: number }` |
| `error`  | JSON `{ message: string, code?: string }` for spawn failures (ENOENT etc.) |

`stdout` / `stderr` events are line-buffered server-side so a chunk that splits
mid-line never lands as two events. Carriage returns are stripped.

The stream terminates after `exit` (or after `error` on spawn failure). The
client treats `exit` as the cue to flip the UI back to idle and re-enable the
action buttons.

### Cancellation semantics

POST `/api/run/cancel` calls `process.kill(pid, 'SIGTERM')` on the active run.
SIGTERM (not SIGKILL) so aidev's normal shutdown path runs: it releases the
per-cwd lockfile and lets any in-flight AI runner detach cleanly. If the
process has already exited (ESRCH) the endpoint reports success — the SSE
`exit` event will still reach the client. The active-run slot is cleared by
the child's own `exit` handler, not by the cancel endpoint, so a slow shutdown
is handled correctly.

If the browser disconnects mid-stream (tab closed, hard reload, navigation
away that closes the underlying fetch), `stream.onClosed` fires server-side
and SIGTERMs the child as a safety net — otherwise it would keep holding the
lockfile and the next run would fail with "aidev is already running".

## Frontend

`ui/pages/run.vue` — uses `fetch` with a manual SSE parser (not `EventSource`,
which can't POST). The token rides in `Authorization: Bearer …`. Action
buttons disable while a run is active; `Cancel` becomes enabled mid-run. A
status dot reflects state: idle / running (pulsing) / done / failed / error.
Exit code and duration print at the end of the scrollback when the stream
closes.

## Open questions

- The CLI's chalk colors come through as ANSI escapes. The viewer renders them
  literally today. If users complain, add a tiny ANSI-to-HTML pass on the
  client (no extra dep needed — a 30-line parser covers SGR codes).
- Persist run history across page reloads? Today, navigating away aborts the
  fetch (the run continues on the server). A small in-memory ring buffer on
  the server would let the client re-attach.
- Multi-run: today we hard-cap at one run per Nitro worker via the module-
  level slot. Allowing parallel runs is unsafe in the same working tree
  (lockfile + git branch ops), so keep single-flight.

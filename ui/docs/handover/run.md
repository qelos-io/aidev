# Handover — Run screen

## Purpose

Surface the same four entrypoints `aidev run [filter]` supports as buttons,
stream the spawned CLI's stdout/stderr into the page, and provide a cancel
control. This is the most-used screen in day-to-day operation.

## Routes

Server (all gated by `ui/server/middleware/auth.ts`):

| Method | Path                  | Description                                                                                  |
|--------|-----------------------|----------------------------------------------------------------------------------------------|
| POST   | `/api/run`            | Body: `{ status: 'open' \| 'pending' \| 'review' \| 'all' }`. Spawns `node dist/cli.js run <filter>` in `AIDEV_CWD`, returns a run id. |
| GET    | `/api/run/:id/stream` | SSE stream of stdout + stderr lines for the given run id. Accepts `?token=` since `EventSource` cannot set headers. |
| POST   | `/api/run/cancel`     | Body: `{ id }`. Sends SIGINT (then SIGTERM after grace period) to the spawned process.       |
| GET    | `/api/run/status`     | Lightweight poll for current run state, in case the SSE connection drops.                    |

Spawn shape:

```ts
spawn(process.execPath, [
  path.join(process.env.AIDEV_CWD!, 'dist/cli.js'),
  'run',
  filter,
], { cwd: process.env.AIDEV_CWD })
```

If `dist/cli.js` is missing, return 412 with a message telling the user to
`npm run build` from the aidev repo root.

Frontend route: `/run` → `ui/pages/run.vue`.

## Components

_Placeholder — to be defined when the screen is implemented._

Likely needs:

- Four primary buttons (Open / Pending / Review / All) — disable while a run
  is in flight.
- A scrollback panel with auto-scroll, line wrapping toggle, and a "copy all"
  affordance.
- A cancel button (only enabled mid-run).
- A status badge: idle / running / cancelled / errored / done (exit code N).

## Open questions

- Should only one run be in flight at a time, or do we allow parallel runs?
  Parallel is risky (same git working tree). Start with single-flight.
- Persist run history across page reloads? A small in-memory ring buffer on
  the server would survive SPA navigations but not server restarts.
- The CLI's chalk colors come through as ANSI escapes. Render via a small
  ANSI-to-HTML parser, or strip on the server? Render in the browser is
  nicer but adds a dep — pick when implementing.
- Cancel semantics: SIGINT is the right first signal (mirrors Ctrl+C in the
  terminal). Confirm aidev's signal handlers do graceful shutdown before
  finalising the spec.

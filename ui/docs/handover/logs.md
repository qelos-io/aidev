# Handover — Logs screen

## Purpose

View the aidev log file with search/filter, and clear it on demand. The log
path is the value of `LOG_FILE` in `.env.aidev` (or the aidev default if
unset — see `src/logger.ts` / `src/config.ts`). If the file does not exist,
the screen renders an empty state with a hint about when aidev will create it.

## Routes

Server (all gated by `ui/server/middleware/auth.ts`):

| Method | Path                    | Description                                                            |
|--------|-------------------------|------------------------------------------------------------------------|
| GET    | `/api/logs?q=&tail=`    | Tail-read the log file. `q` filters lines (substring or regex), `tail` caps lines from the end. Returns `{ path, lines, truncated }`. |
| GET    | `/api/logs/stream`      | (Optional) SSE stream of new log lines as aidev writes them.            |
| DELETE | `/api/logs`             | Truncate the log file to zero bytes (does not delete it).               |

Re-use:

- `src/logger.ts` for default-log-path resolution.
- `src/config.ts` `loadConfig()` to read `LOG_FILE` override.

Frontend route: `/logs` → `ui/pages/logs.vue`.

## Components

_Placeholder — to be defined when the screen is implemented._

Likely needs:

- A search input (debounced) bound to the `q` query param.
- A monospace scrollback panel with auto-scroll toggle.
- A "Clear logs" destructive action with confirm.
- An empty-state card explaining the file does not exist yet.

## Open questions

- Should search be substring (cheap) or regex (powerful but risky)? Start with
  substring; regex behind a checkbox if requested.
- Tail size default — 1k lines? 10k? Bigger means longer initial paint.
- Should we tail-follow with SSE, or poll? SSE is nicer but adds a long-lived
  connection per open Logs tab. Decide when implementing.
- Do we want to expose log rotation here, or leave that to the OS?

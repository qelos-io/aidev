# Handover — Tasks screen

## Purpose

Browse, edit, comment on, status-change, and execute tasks from the configured
provider (ClickUp / Jira / Linear / Trello / Monday / Notion / Local). All
operations go through the existing aidev `TaskProvider` abstraction so the UI
stays provider-agnostic.

## How the server side wires up

`ui/server/utils/provider.ts` lazy-loads the aidev provider on the first call
within a request and caches the bundle (`{ config, provider, envPath, cwd,
dist }`) on `event.context`. It:

1. Resolves `AIDEV_CWD` and checks that `dist/` exists (returns 503 with a
   clear "run `npm run build`" message otherwise).
2. Reads `.env.aidev` via `readEnvFile`, **deletes those keys from
   `process.env`** so the next `loadConfig` call doesn't see stale values from
   an earlier request, then calls `loadConfig(envPath)` and
   `createProvider(config)` out of the CJS dist via `createRequire`.

The same trick is used in `ui/server/api/config/test.post.ts` — keep them in
sync if you change one.

## Routes

All routes are gated by `ui/server/middleware/auth.ts` (loopback-only + bearer
token).

| Method | Path                              | Provider method(s) called                                 |
|--------|-----------------------------------|-----------------------------------------------------------|
| GET    | `/api/tasks?status=`              | `fetchTasks()` (status `all` / unconfigured filter) or `fetchTasksByStatus([...])` (status `open` / `pending` / `review`). Also calls `fetchAvailableStatuses()` when the provider implements it. |
| GET    | `/api/tasks/:id`                  | `fetchTasks()` + in-memory find, then `getComments(id)`. (TaskProvider has no single-task fetch.) |
| PATCH  | `/api/tasks/:id`                  | `updateStatus(id, status)` when `status` in body; `removeTag(id, tag)` for each entry in `removeTags`. 400 on empty body, 501 when `removeTags` is set on a provider without `removeTag`. |
| POST   | `/api/tasks/:id/comment`          | `postComment(id, text)`. Body `{ text, asAidev? }`. When `asAidev` is true the text is prefixed with `config.commentPrefix`. |
| POST   | `/api/tasks/:id/status`           | `updateStatus(id, status)`.                                |
| POST   | `/api/tasks/:id/execute`          | Spawns `node dist/cli.js run --task <id>` in `AIDEV_CWD`; streams stdout/stderr via SSE using `createEventStream`. |

The `?status=` filter values map to provider-specific status names through
`statusesForFilter()` in `ui/server/utils/provider.ts`. When a value is
recognised but unconfigured (e.g. `?status=pending` but `CLICKUP_PENDING_STATUS`
is blank), the route falls back to `fetchTasks()` so the user still sees
something rather than an empty board.

The PATCH route is intentionally narrow — TaskProvider does not expose
title/description editing (`src/providers/base.ts`), so those fields are
rejected with 400. If a provider gains a richer update method in the future,
extend this route rather than adding a parallel one.

## Execute streaming

`POST /api/tasks/:id/execute` returns a `text/event-stream` response built with
h3's `createEventStream`. Events:

| Event    | Payload                                       |
|----------|-----------------------------------------------|
| `stdout` | One stdout line (no trailing newline).        |
| `stderr` | One stderr line (no trailing newline).        |
| `exit`   | JSON `{ code: number\|null, signal: string\|null }` — emitted once. |
| `error`  | JSON `{ message, code? }` for spawn-level failures (`ENOENT` etc.). |

Implementation notes:

- The child is spawned with `process.execPath` (Node binary that's running the
  Nitro server) targeting `<AIDEV_CWD>/dist/cli.js`. We pass `--task <id>` —
  see [The `--task` CLI flag](#the---task-cli-flag) below.
- Stdout/stderr are line-buffered separately. Partial trailing data (no
  newline) is flushed when the stream ends.
- The server registers `stream.onClosed` to send `SIGTERM` to the child if the
  browser disconnects mid-run; otherwise the CLI's per-cwd lockfile would
  block the next run.
- The Nitro middleware accepts the bearer token via header **or**
  `?token=…` query string. We use the header because the client side issues
  a `POST` via `fetch` (`EventSource` is GET-only and can't carry headers, so
  parsing SSE manually was the only way to keep this a POST without leaking
  the token into URLs and access logs).

## The `--task` CLI flag

`src/commands/run.ts:runCommand` now accepts a final `taskId?: string`
argument. When set:

- The task list fetched from the provider is filtered to that single id.
- Local-task push (`processLocalTasks`), the non-code provider phase, the
  review-task phase, and the post-run `acceptedCommand` auto-merge are all
  skipped. `src/cli.ts:runWithFilter` also threads `taskId` through to
  short-circuit those steps before `runCommand` is even called.
- The existing skip logic still applies — executing a task in a terminal
  status will log `terminal status: <status>` and exit. That's intentional
  so a "run this one task" UI button can't accidentally re-run completed
  work; the user sees the skip reason in the SSE output.

The flag is exposed on the CLI as `aidev run --task <id>` and is the entry
point the execute SSE route spawns.

## Frontend

`ui/pages/tasks.vue` renders a Kanban-style board with columns derived from
the filter mapping returned by `GET /api/tasks` (Open / Pending / In Review /
Done / Other-when-non-empty). Cards show id, title, status badge, priority
badge, and the first three tags. Clicking a card opens a drawer (`UModal`)
with:

- The task description (read-only — no provider edit API).
- A status dropdown driven by `fetchAvailableStatuses()` when available, or
  the union of the four configured bucket statuses as a fallback.
- The full comment list plus an `Add comment` form with an
  `Send as [aidev] comment` toggle that prepends `commentPrefix`.
- An `Execute task` button that POSTs to the execute SSE endpoint and
  renders the streamed output in a scrollable terminal pane below. The
  cancel button aborts the fetch, which causes the server-side
  `stream.onClosed` to SIGTERM the spawned aidev child.

## Open questions

- Multi-tab edit conflicts on the same task — currently last-write-wins.
  Providers don't expose ETags so resolving this would mean polling for
  status drift, which feels like overkill for a dashboard.
- Persistent execute output across navigations — today the SSE stream is
  bound to the drawer; closing it cancels the run. If users want to fire
  and forget, we'd need a small in-memory store keyed by task id plus a
  reconnect endpoint.
- Title / description editing — gated on TaskProvider growing an
  `updateTask()` method. Worth doing as a follow-up if requested.

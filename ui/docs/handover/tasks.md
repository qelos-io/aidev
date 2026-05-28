# Handover — Tasks screen

## Purpose

Browse, edit, comment on, status-change, and execute tasks from the configured
provider (ClickUp / Jira / Linear / Trello). All operations go through the
existing aidev `TaskProvider` abstraction so the UI stays provider-agnostic.

## Routes

Server (all gated by `ui/server/middleware/auth.ts`):

| Method | Path                              | Description                                                  |
|--------|-----------------------------------|--------------------------------------------------------------|
| GET    | `/api/tasks?status=`              | List tasks. `status` accepts `open`, `pending`, `review`, `all` (default `all`). |
| GET    | `/api/tasks/:id`                  | Fetch a single task with comments.                            |
| PATCH  | `/api/tasks/:id`                  | Update task fields the provider supports (title, description). |
| POST   | `/api/tasks/:id/comment`          | Add a comment to a task.                                      |
| POST   | `/api/tasks/:id/status`           | Change task status (provider mapping defined in `.env.aidev`). |
| POST   | `/api/tasks/:id/execute`          | Spawn `aidev run` scoped to one task id; stream stdout via SSE. |

Re-use:

- `src/providers/index.ts` `createProvider()` and the `TaskProvider` interface.
- `src/config.ts` `loadConfig()` for provider config.
- `src/commands/run.ts` for the execute-one-task entry point (may need a small
  argument addition to scope by id — see open questions).

Frontend route: `/tasks` → `ui/pages/tasks.vue`.

## Components

_Placeholder — to be defined when the screen is implemented._

Likely needs:

- A column-grouped board (Open / Pending / Review) or a filterable table.
- A task detail drawer/modal with comments + edit fields.
- An execute button per task that opens a streaming log panel.
- Optimistic UI for status changes with rollback on error.

## Open questions

- `aidev run` today takes a filter, not a single task id. Do we add a
  `--task <id>` flag to `runCommand`, or post-filter in the spawn wrapper?
  The former is cleaner and useful for CLI users too.
- Do we let users create new provider tasks from this screen, or only edit
  existing? Creation is out-of-scope unless requested.
- Should the SSE execute stream persist across page navigations, or be
  bound to the drawer/modal? Persistence implies a small in-memory store.
- Conflict handling when two tabs edit the same task — probably last-write-wins
  with a toast, unless providers expose ETags.

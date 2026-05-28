# aidev UI — Handover

The dashboard is a Nuxt 3 (ESM) app that lives at the repo root under `ui/`.
It is launched by the `aidev ui` CLI command and stays loopback-only.

## Per-screen handover

- [config.md](./config.md) — `.env.aidev` editor + provider/AI ping.
- [logs.md](./logs.md) — log viewer with search and clear.
- [tasks.md](./tasks.md) — provider task board + per-task execute.
- [run.md](./run.md) — Open / Pending / Review / All buttons with live SSE.

## Launch

From a directory containing `.env.aidev` (and after `npm run build` at the
aidev repo root so `dist/cli.js` exists):

```bash
node dist/cli.js ui                # dev mode, port 19422 (default)
node dist/cli.js ui --port 19500   # custom port
node dist/cli.js ui --prod         # serve built Nuxt output if present, fall back to dev
```

When aidev is installed globally (or via `npm link`), `aidev ui …` works the
same way.

The CLI:

1. Generates a 32-byte hex token via `node:crypto`.
2. Prints `http://127.0.0.1:<port>/login?token=<token>` in chalk-green.
3. Spawns Nuxt with these env vars set:
   - `AIDEV_UI_TOKEN` — bearer token the SPA must present
   - `AIDEV_UI_PORT` — port the server binds (also `NITRO_PORT`)
   - `AIDEV_CWD` — the directory aidev was invoked from (where `.env.aidev` lives)
   - `NITRO_HOST=127.0.0.1` — loopback-only listener

Each launch generates a new token; restarting `aidev ui` invalidates the old login.

## Auth flow

```
  ┌─────────────┐  prints token URL   ┌────────────────────┐
  │ aidev ui    │ ──────────────────▶ │ user's terminal    │
  │  (CLI)      │                     └─────────┬──────────┘
  │             │                               │ click
  │  spawns ▼   │                               ▼
  │  Nitro      │      GET /login?token=…  ┌──────────┐
  │  (Nuxt)     │ ◀──────────────────────  │ browser  │
  │             │                          └────┬─────┘
  │  middleware │   stores token in localStorage│
  │  rejects    │      (key: aidev-ui-token)    │
  │  non-loop / │                               │
  │  bad token  │   Authorization: Bearer …     │
  │             │ ◀──────────────────────────── │
  └─────────────┘     every /api/* request      │
                                                ▼
                                         redirects to / 
```

1. User opens the printed `http://127.0.0.1:<port>/login?token=…` URL.
2. `ui/pages/login.vue` reads the `?token=` query, stores it in `localStorage`
   under the key `aidev-ui-token`, and redirects to `/`.
3. All API calls are wrapped by `ui/composables/useApi.ts`, which injects
   `Authorization: Bearer <token>` and on a 401 clears the token and
   bounces the user to `/login`.
4. `ui/server/middleware/auth.ts` enforces both layers server-side:
   - Reject if `req.socket.remoteAddress` is not 127.0.0.1 / ::1 / ::ffff:127.0.0.1.
   - For `/api/*` paths, require `Authorization: Bearer <token>` matching
     `process.env.AIDEV_UI_TOKEN` (also accepts `?token=` for SSE/EventSource
     URLs that cannot set headers).

Tokens are deliberately kept out of public runtime config — only `aidevCwd`
and `port` are exposed to the client.

## Project layout

```
ui/
  app.vue                       # mounts <NuxtLayout><NuxtPage/></NuxtLayout>
  nuxt.config.ts                # @nuxt/ui module, runtime config, loopback nitro
  layouts/
    default.vue                 # sidebar + header shell
  pages/
    login.vue                   # token handshake (no layout)
    index.vue                   # Dashboard
    config.vue                  # .env.aidev editor
    logs.vue                    # log viewer + search + clear
    tasks.vue                   # provider task board + per-task execute
    run.vue                     # Open/Pending/Review/All buttons + SSE viewer
  composables/
    useApi.ts                   # $fetch wrapper that injects bearer + handles 401
  server/
    middleware/
      auth.ts                   # loopback + bearer enforcement
    utils/
      envFile.ts                # read/write .env.aidev preserving comments + order
      logFile.ts                # locate + tail the aidev log file
      provider.ts               # lazy-load aidev's CJS provider into Nitro
      currentRun.ts             # module-level slot tracking the active `aidev run`
    api/
      config.get.ts             # GET /api/config
      config.put.ts             # PUT /api/config
      config/
        test.post.ts            # POST /api/config/test
      logs.get.ts               # GET /api/logs?q=…
      logs.delete.ts            # DELETE /api/logs
      tasks.get.ts              # GET /api/tasks
      tasks/[id].get.ts         # GET /api/tasks/:id
      tasks/[id].patch.ts       # PATCH /api/tasks/:id
      tasks/[id]/comment.post.ts# POST /api/tasks/:id/comment
      tasks/[id]/status.post.ts # POST /api/tasks/:id/status
      tasks/[id]/execute.post.ts# POST /api/tasks/:id/execute  (SSE)
      run.post.ts               # POST /api/run                (SSE)
      run/cancel.post.ts        # POST /api/run/cancel
  docs/handover/                # one md per screen — this directory
```

## Adding a new screen

1. Add `ui/pages/<screen>.vue`. The default layout is auto-applied.
2. Add a nav entry to the `nav` array in `ui/layouts/default.vue`.
3. Add server routes under `ui/server/api/<screen>/...` — they are protected
   automatically by the auth middleware as long as the path starts with `/api/`.
4. Inside components, call the API with the composable:

   ```ts
   const api = useApi();
   const data = await api<MyResponse>('/api/<screen>');
   ```

5. Write a handover doc at `ui/docs/handover/<screen>.md` covering Purpose,
   Routes, Components, and Open questions.

## Reusing aidev CLI logic from server routes

The Nuxt app is ESM, but the parent aidev package is CJS. Nitro server routes
can `import` the CJS modules directly (Node interop). For provider operations,
re-use `createProvider()` from `../../src/providers/index.ts` rather than
re-implementing them.

For executing the CLI (Run screen, single-task execute), spawn:

```ts
spawn(process.execPath, [
  path.join(process.env.AIDEV_CWD!, 'dist/cli.js'),
  'run',
  ...args,
])
```

and stream stdout via h3's `eventStream`.

## Current status

| Step | Status | Notes                                                              |
|------|--------|--------------------------------------------------------------------|
| 1    | done   | CLI command + Nuxt scaffold                                        |
| 2    | done   | Auth middleware, login, layout, stub pages, handover docs          |
| 3    | done   | Config screen — env file routes + dynamic form                     |
| 4    | done   | Logs screen — read / search / clear                                |
| 5    | done   | Tasks screen — provider wrap + per-task execute (SSE)              |
| 6    | done   | Run screen — Open / Pending / Review / All buttons with SSE        |

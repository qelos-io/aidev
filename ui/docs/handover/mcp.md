# Handover — MCP screen

## Purpose

Manage the generic `mcp.json` that `src/mcp.ts` translates into every
configured agent's own MCP convention (see the [MCP guide](https://qelos-io.github.io/aidev/guide/mcp)).
Lets the user add/edit/remove servers without hand-writing JSON, with a raw
JSON tab as an escape hatch. The `BETTER_MCP` / `BETTER_MCP_CONFIG_PATH` flags
stay on the [Config screen](./config.md) (they're plain `.env.aidev` keys) —
this screen only owns the `mcpServers` file itself.

## Routes

All routes are gated by `ui/server/middleware/auth.ts` (loopback + bearer
token). The single source of truth for path resolution and parsing is
`ui/server/utils/mcpFile.ts`, which delegates to the compiled
`dist/mcp.js` (`resolveMcpJsonPath`, `readMcpServers`) so discovery order
(`MCP_JSON_PATH` → `.agents/mcp.json` → `.aidev/mcp.json`) never drifts from
the CLI.

| Method | Path        | Description                                                                 |
|--------|-------------|-------------------------------------------------------------------------------|
| GET    | `/api/mcp`  | Returns `{ path, exists, servers, betterMcp, betterMcpConfigPath }`.          |
| PUT    | `/api/mcp`  | Body `{ servers: Record<string, McpServerDef> }`. Overwrites the whole file. |

### `GET /api/mcp`

```ts
interface McpFileResult {
  path: string;                 // resolved mcp.json path (or the default .aidev/mcp.json when nothing exists yet)
  exists: boolean;
  servers: Record<string, McpServerDef>;
  betterMcp: boolean;           // read straight from .env.aidev, informational only here
  betterMcpConfigPath: string;
}
```

### `PUT /api/mcp`

- Validates the body is `{ servers: object }` and that every value is itself
  an object (`400` otherwise).
- Writes `{"mcpServers": <servers>}` to the resolved path, creating parent
  directories as needed. Always a full overwrite — the UI is expected to
  submit the complete intended server set, same as `PUT /api/config`.
- Returns the same shape as `GET /api/mcp` after the write.

Neither route runs `materializeMcp()` — that only happens when `aidev run`
starts. Editing the servers here takes effect on the *next* run.

## Frontend (`ui/pages/mcp.vue`)

Two views over the same `servers` state, toggled by a header button (no
`UTabs` — the codebase doesn't use that component elsewhere, so this stays a
plain `v-if`/`v-else` pair):

1. **Form view** (default) — one bordered block per server (mirrors the
   `agentBlocks` repeatable-row idiom in `config.vue`): name, URL (remote) or
   command + space-separated args (local), and a `KEY=VALUE`-per-line
   textarea for `env`. "Add server" appends a blank row.
2. **Raw JSON view** — a plain `<textarea>` bound to
   `{"mcpServers": {...}}`, parsed and validated on "Apply to form" (or
   automatically on Save, if you save while still in raw mode).

State:

- `servers: ServerRow[]` — reactive form rows, each with a `uid` for `:key`.
- `original` / `originalRaw` — snapshots for dirty-tracking in each view
  respectively; `dirty` picks the right one based on `rawMode`.
- `rowsToServers()` / `serversToRows()` — pure converters between the API's
  `Record<string, McpServerDef>` shape and the form's row list.

## Reusing aidev internals

`mcpFile.ts` follows the same `createRequire(...).../dist/mcp` bridge as
`ui/server/utils/provider.ts`, gated on `AIDEV_PACKAGE_DIR` and erroring
`503` with a build hint if `dist/` is missing — deliberately **not** routed
through `getProvider()`, since MCP has nothing to do with the task provider
and `getProvider()` would drag in provider-specific required-field
validation (e.g. failing when `CLICKUP_API_KEY` is unset) for a screen that
doesn't need it.

## Edge cases handled

- No `mcp.json` anywhere → `exists: false`, empty server list, form starts
  blank; saving creates `.aidev/mcp.json` (the same default `materializeMcp()`
  would fall back to).
- Malformed on-disk JSON — `readMcpServers()` throws; this bubbles up as a
  `500` from `GET /api/mcp` today (no special-cased recovery — same
  contract as the CLI throwing on `aidev run`).
- A server with both `url` and `command` set: the form disables
  command/args inputs once a URL is entered, and the write only emits `url`.

## Known gaps / open questions

- No per-server "test connection" (unlike the Config screen's provider/AI
  test). Verifying an MCP server actually starts would mean spawning it,
  which is more invasive than the other test endpoints.
- `BETTER_MCP` toggling and the better-mcp `middleware` block aren't
  editable here — `BETTER_MCP`/`BETTER_MCP_CONFIG_PATH` live in `.env.aidev`
  (Config screen), and the better-mcp config file itself has no dedicated UI
  yet.

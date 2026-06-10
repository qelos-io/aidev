# Handover — Config screen

## Purpose

Manage the `.env.aidev` file in the connected working directory (`AIDEV_CWD`).
Lets the user view, edit, save, and validate provider/AI-runner credentials
and flags without leaving the dashboard. If `.env.aidev` does not exist, the
screen offers to create one populated with sane defaults.

## Routes

All routes are gated by `ui/server/middleware/auth.ts` (loopback + bearer
token). The single source of truth for parsing/serializing is
`ui/server/utils/envFile.ts`.

| Method | Path                | Description                                                                                  |
|--------|---------------------|----------------------------------------------------------------------------------------------|
| GET    | `/api/config`       | Returns `{ path, exists, values, keys }` for `<AIDEV_CWD>/.env.aidev`.                       |
| PUT    | `/api/config`       | Body `{ values: Record<string,string> }`. Writes the full set; omitted keys are removed.     |
| POST   | `/api/config/test`  | Body `{ provider?: true }` or `{ ai: <runner-name> }`. Returns `{ ok: boolean, message }`.   |

### `GET /api/config`

Response:

```ts
interface EnvFileResult {
  path: string;            // absolute path to .env.aidev
  exists: boolean;         // false → screen shows the "create defaults" CTA
  values: Record<string, string>;
  keys: string[];          // declaration order in the file
}
```

### `PUT /api/config`

- Walks the existing file line-by-line. For each `KEY=` line it substitutes
  the new value (preserving position) when `KEY` is in `body.values`, and
  drops the line when it isn't.
- Comments and blank lines are preserved verbatim so section dividers survive
  a round trip.
- New keys (in `body.values` but not in the file) are appended at the bottom
  after a blank separator.
- Values containing whitespace, `#`, single, or double quotes are wrapped in
  double quotes, mirroring `envVal()` in `src/commands/init.ts`.
- Returns the same shape as `GET /api/config` after the write.

### `POST /api/config/test`

Probes either the configured task provider or a single AI runner. Returns
`{ ok, message }` without throwing (errors are caught and surfaced via
`ok: false`). The only thrown responses are:

- `500` — `AIDEV_CWD` env var not set (would mean the route ran outside the
  `aidev ui` launcher).
- `503` — `${AIDEV_CWD}/dist/` missing. The route loads the parent aidev
  package's CJS modules from there; without a build it can't import
  `createProvider`. The message tells the user to run `npm run build`.
- `400` — request body specifies neither `provider` nor `ai`.

Provider test:

1. `require('${AIDEV_CWD}/dist/config').loadConfig(envPath)` — reuses the
   real loader so required-key validation matches the CLI.
2. `require('${AIDEV_CWD}/dist/providers').createProvider(config)` — same
   factory the CLI uses.
3. Calls `provider.fetchAvailableStatuses()` if implemented (single GET on
   most providers), else falls back to `fetchTasks()`.

AI test (`ai: <name>` where name is one of `claude | cursor | codex |
antigravity | devin | anthropic-sdk`):

- For CLI-backed runners, spawns the underlying binary with `--version`
  (mapping mirrors `isAvailable()` in `src/ai/*.ts` — e.g. `cursor` →
  `agent --version`).
- For `anthropic-sdk`, which has no CLI, checks that `ANTHROPIC_API_KEY` is
  set and reports back.

## Frontend (`ui/pages/config.vue`)

State:

- `kv: Record<string, string>` — reactive working copy of the file values.
- `original: Record<string, string>` — snapshot for dirty-tracking.
- `dirty` toggles the Save button; `loadError`, `saved`, and per-section
  `testResults` drive the inline `UAlert`s.

Layout (one `UCard` per section):

1. **Header card** — file path, load/save buttons, error and saved alerts,
   and the "Create with defaults" CTA when the file is missing.
2. **Task provider** — `PROVIDER` select drives `providerFields` (a static
   per-provider key list mirroring `src/types.ts`). Inputs marked `secret`
   render as `type=password`. Per-section "Test connection" button.
3. **AI runners** — `AGENTS`, `CLAUDE_MODEL`, `ANTHROPIC_*` inputs.
   Includes an inline agent picker so the Test button can probe any agent
   from the list (not only the primary).
4. **Logging** — `AIDEV_LOG_PATH` input.
5. **Workflow & Git** — shared keys from `src/types.ts` / `src/config.ts`:
   `DEV_NOTES_MODE`, tags, trigger word, hooks path, compression flags, and
   git/GitHub settings.
6. **Other keys** — anything in `kv` not covered by sections 2–5. Each row
   has a delete button; the section header has an `+ Add key` action that
   opens a `UModal` for adding a new `KEY=value`.

The known-key partition lives in `PROVIDER_FIELDS`, `KNOWN_AI_KEYS`,
`KNOWN_WORKFLOW_KEYS`, and `KNOWN_LOG_KEYS` at the top of the `<script setup>`
block. Add a new known section by appending its keys to one of those (or by
introducing a new constant + section card), then exclude them from `managedKeys`
accordingly.

## Reusing aidev internals

`test.post.ts` loads aidev's compiled modules at runtime via
`createRequire(path.join(process.env.AIDEV_CWD, 'package.json'))` and
`require(path.join(process.env.AIDEV_CWD, 'dist', '<module>'))`. This keeps
Nitro from trying to bundle the parent CJS package, and matches the
convention the architecture doc set for the Tasks/Run routes (which will
require `dist/cli.js` and `dist/providers` the same way).

## Edge cases handled

- File missing → `exists: false`, frontend shows "Create with defaults".
- Build artifacts missing → 503 with a build hint (test endpoint only; the
  pure-file read/write endpoints don't need `dist/`).
- Unknown agent → 200 with `ok: false` message; binary missing on PATH →
  `ok: false` with "<bin> not found on PATH".
- Posted keys validated against `^[A-Za-z_][A-Za-z0-9_]*$` before write.

## Known gaps / open questions

- `TASK_PROVIDER` / `AI_TOOL` in the original spec are surfaced here as
  `PROVIDER` / `AGENTS` to match the actual env vars consumed by
  `src/config.ts`. Worth aligning the spec wording on the next pass.
- Field descriptions are hard-coded in the page. A future improvement is to
  pull them from `.env.aidev.example` comments — single source of truth.
- "Other keys" is a power-user escape hatch. We may want to promote
  frequently-edited keys (e.g. `THINKING_TAG`, `ACCEPTED_TAG`) into a
  dedicated section.
- Shoulder-surfing: secrets are masked via `type=password` and detected by
  name suffix (`KEY|TOKEN|SECRET|PASSWORD`). No reveal toggle yet.

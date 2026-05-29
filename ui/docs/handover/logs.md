# Handover — Logs screen

## Purpose

View the aidev log file with substring search, control how much of the tail
is shown, and clear the file when it gets noisy. Path resolution mirrors
`src/logger.ts` so the dashboard always points at the same file the CLI is
writing to.

## Path resolution

`ui/server/utils/logFile.ts` reads `AIDEV_LOG_PATH` from `.env.aidev` and
applies the same rules as `src/logger.ts`:

| Value                  | Resolves to                                |
|------------------------|--------------------------------------------|
| _empty / unset_        | `<cwd>/aidev.log`                          |
| `~` or `~/<rel>`       | Expanded against `os.homedir()`            |
| Absolute path          | Used as-is                                 |
| Relative path          | Resolved against `AIDEV_CWD`               |

> Note: the original draft of this doc referred to the key as `LOG_FILE`. The
> CLI and Config screen both use `AIDEV_LOG_PATH` — that is the canonical name.

## Routes

All gated by `ui/server/middleware/auth.ts`.

| Method | Path                       | Description |
|--------|----------------------------|-------------|
| GET    | `/api/logs?q=&limit=`      | Tail-read the log file. `limit` (default `1000`, max `50000`) caps the number of lines read from the end; `q` filters the tail by case-insensitive substring server-side. Returns `{ path, exists, total, shown, truncated, limit, query, lines }`. |
| DELETE | `/api/logs`                | Truncates the log file to zero bytes via `fs.truncateSync`. Does **not** unlink it — preserves the inode for any open handles. |

### Response shape (`GET /api/logs`)

```ts
interface LogsResponse {
  path: string;       // resolved absolute path
  exists: boolean;    // false → empty-state UI
  total: number;      // total non-empty lines in the file
  shown: number;      // lines.length (after q filter)
  truncated: boolean; // true when total > limit (older lines dropped)
  limit: number;      // echo of the applied tail size
  query: string;      // echo of the applied filter
  lines: string[];
}
```

### Order of operations

Filter is applied **after** the tail slice. So `?limit=1000&q=error` returns
matches found in the last 1000 lines, not the last 1000 matches in history.
If you need to widen the search horizon, raise `limit`.

## Frontend (`ui/pages/logs.vue`)

- Search input (`UInput`) debounced 300ms before becoming the `q` param.
- Tail selector (`USelect`) with presets `200 / 500 / 1000 / 5000 / 10000`.
- `Refresh` button forces an immediate fetch and scrolls to the bottom.
- `Clear log` button opens a `UModal` confirm; on confirm calls `DELETE /api/logs` then reloads.
- Auto-refresh checkbox (default on) polls every 5s while
  `document.visibilityState === 'visible'`. Background polls preserve the
  user's scroll position; explicit reloads scroll to the bottom.
- Empty state when the file is missing (with the resolved path) or empty
  (with a hint about the active filter, if any).

## Edge cases handled

- File doesn't exist → `{ exists: false }` and dashed empty-state card; no error.
- File is empty or all lines filtered out → "No matching lines" card.
- `AIDEV_CWD` not set → 500 (should never happen — CLI always sets it before spawning Nuxt).
- `q` containing regex metacharacters → safe; this is plain substring matching, not regex.
- Trailing newline → stripped from the line count so totals match what users see.

## Re-use / extension hooks

- `resolveLogPath(cwd)` in `ui/server/utils/logFile.ts` is the single source
  of truth for the log location on the UI side. New routes that need to
  touch the log should import this rather than re-implementing.
- The handler reads the entire file synchronously and slices in memory.
  That's fine for typical aidev logs but would need a bounded-read rewrite
  if logs ever grow into the tens of MB. The natural seam is
  `ui/server/api/logs.get.ts` — swap `fs.readFileSync` for a read-from-end
  helper that returns just the last N lines as bytes.

## Open decisions deferred

- **Regex search** — substring is intentional for now (cheap and obvious).
  If users ask, add a checkbox that swaps `String.includes` for `new RegExp`
  with try/catch on the pattern.
- **SSE tail-follow** — currently 5s polling. SSE would be smoother but
  needs a file watcher (`fs.watch`) and graceful client reconnects. Worth
  it only if polling proves laggy in practice.
- **Log rotation** — out of scope; leave to the OS / log shipper.

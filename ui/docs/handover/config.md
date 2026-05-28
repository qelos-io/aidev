# Handover — Config screen

## Purpose

Manage the `.env.aidev` file in the connected working directory (`AIDEV_CWD`).
Lets the user view, edit, and validate provider/AI-runner credentials and
flags without leaving the dashboard. If `.env.aidev` does not exist, the
screen offers to create one populated with defaults.

## Routes

Server (all gated by `ui/server/middleware/auth.ts`):

| Method | Path                | Description                                                                       |
|--------|---------------------|-----------------------------------------------------------------------------------|
| GET    | `/api/config`       | Read `.env.aidev`, return parsed key/value pairs preserving order and comments.    |
| PUT    | `/api/config`       | Write `.env.aidev` from posted key/value pairs; round-trip through a preserving parser. |
| POST   | `/api/config/test`  | Instantiate the configured provider + AI runner and run a lightweight ping.        |
| POST   | `/api/config/init`  | Create `.env.aidev` from the same template `aidev init` uses (if missing).         |

Source-of-truth helpers to re-use from the parent package:

- `src/config.ts` — `loadConfig()` plus the env-file parser
- `src/commands/init.ts` — template content for a fresh `.env.aidev`
- `src/providers/index.ts` — `createProvider()` for the ping
- `src/ai/index.ts` — `createRunners()` for the AI ping

Frontend route: `/config` → `ui/pages/config.vue`.

## Components

_Placeholder — to be defined when the screen is implemented._

Likely needs:

- A keyed editable table or stacked field list with descriptions.
- A "Test connection" button per group (Provider, AI Runner).
- A "Create .env.aidev" empty state when the file is missing.
- Mask + reveal toggle for secret-looking values (tokens, keys).

## Open questions

- Do we want field-level descriptions baked into the UI, or pulled from
  `.env.aidev.example` comments? (Leaning toward the latter — single source of truth.)
- Should the test endpoint accept staged values from the form, or always read
  from disk? Staged-values is friendlier but means re-implementing config
  validation client-side.
- How do we surface secrets safely? Loopback-only mitigates exfiltration, but
  shoulder-surfing remains a concern.

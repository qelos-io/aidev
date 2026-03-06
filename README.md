# aidev

[![npm version](https://img.shields.io/npm/v/aidev.svg?style=flat-square)](https://www.npmjs.com/package/aidev)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=flat-square)](./LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18-brightgreen.svg?style=flat-square)](https://nodejs.org)

**aidev** turns your ClickUp tasks into merged code — automatically.

It polls your task manager, checks whether tasks are clear, runs Claude or Cursor to implement them, pushes a branch, and moves the task to review. All without touching your keyboard.

```
ClickUp task  →  AI implements  →  git push  →  "in review"
```

---

## Table of Contents

- [How it works](#how-it-works)
- [Quick start](#quick-start)
- [Commands](#commands)
- [Configuration](#configuration)
- [AI agents](#ai-agents)
- [Dev notes mode](#dev-notes-mode)
- [Scheduling](#scheduling)
- [Logging](#logging)
- [Providers](#providers)
- [Contributing](#contributing)

---

## How it works

1. **Fetch** — pulls all tasks tagged with your configured tag from ClickUp
2. **Filter** — skips done/cancelled tasks and tasks that already have a branch
3. **Clarify** — in `smart` mode, asks the AI if the task description is clear enough; if not, posts a question as a comment and marks the task `pending`
4. **Wait** — pending tasks are re-checked on the next run; if a human replied, implementation proceeds with the reply as extra context
5. **Implement** — checks out a fresh branch, runs your configured AI agent(s), falls back to the next agent if one fails
6. **Ship** — commits all changes, pushes the branch, posts a comment with the branch name and a PR link, moves the task to your "in review" status

---

## Quick start

```bash
npm install -g @qelos/aidev
```

Navigate to your project and run the interactive setup:

```bash
cd my-project
aidev init
```

The wizard will ask for your ClickUp credentials, git settings, and preferred AI agents. Sensitive values (API keys) can be left blank if they are already set as environment variables in your shell.

Once configured:

```bash
aidev run
```

---

## Commands

| Command | Description |
|---|---|
| `aidev init` | Interactive setup — creates `.env.aidev` |
| `aidev run` | Process all open + pending-with-replies tasks |
| `aidev run open` | Only open (non-pending) tasks |
| `aidev run pending` | Only pending tasks — check for human replies |
| `aidev schedule set` | Interactive cron picker for this directory |
| `aidev schedule set "<expr>"` | Set a specific cron expression |
| `aidev schedule get` | Show the current schedule for this directory |
| `aidev help` | Show command and config reference |

### Global flags

| Flag | Description |
|---|---|
| `-e, --env <path>` | Load config from a custom env file instead of `.env.aidev` |
| `-V, --version` | Print version |

**Examples**

```bash
# Use a shared env file for a staging environment
aidev --env /shared/.env.staging run

# Only process tasks that are waiting for a reply
aidev run pending

# Schedule to run every 30 minutes
aidev schedule set "*/30 * * * *"
```

---

## Configuration

Run `aidev init` for an interactive setup, or create `.env.aidev` manually using `.env.aidev.example` as a template.

### ClickUp

| Variable | Default | Description |
|---|---|---|
| `CLICKUP_API_KEY` | — | Personal API token — can be set as a shell env var |
| `CLICKUP_TEAM_ID` | — | Workspace / team ID — can be set as a shell env var |
| `CLICKUP_TAG` | — | Tasks with this tag will be picked up |
| `CLICKUP_PENDING_STATUS` | `pending` | Status name for "waiting for reply" |
| `CLICKUP_IN_REVIEW_STATUS` | `review` | Status set after implementation |
| `ASSIGNEE_TAG` | — | Only process tasks assigned to this user (optional) |

> **Tip:** `CLICKUP_API_KEY` and `CLICKUP_TEAM_ID` are intentionally omitted from `.env.aidev` if you leave them blank during `aidev init` — they will be read from your shell environment instead.

### Git & GitHub

| Variable | Default | Description |
|---|---|---|
| `GIT_REMOTE` | auto-detected | Remote name — detected via `git remote get-url origin` if unset |
| `GITHUB_BASE_BRANCH` | `main` | Base branch; new task branches are cut from here |
| `GITHUB_REPO` | — | `owner/repo` — used to generate PR links in comments |

### AI agents

| Variable | Default | Description |
|---|---|---|
| `AGENTS` | `claude,cursor` | Comma-separated list of agents in priority order |
| `DEV_NOTES_MODE` | `smart` | When to ask for clarification (`smart` or `always`) |

---

## AI agents

aidev supports multiple AI agents with automatic fallback. The first available agent in the list is used; if it fails, the next one is tried with the previous agent's output as additional context.

**Supported agents**

| Agent | Requires |
|---|---|
| `claude` | [Claude CLI](https://github.com/anthropics/claude-code) installed and authenticated |
| `cursor` | [Cursor](https://cursor.sh) installed with Agent mode |

**Configure agent order in `.env.aidev`:**

```bash
# Claude first, fall back to Cursor
AGENTS=claude,cursor

# Cursor only
AGENTS=cursor

# Cursor first (useful when working locally with a monitor)
AGENTS=cursor,claude
```

---

## Dev notes mode

Controls when aidev asks ClickUp for clarification before implementing.

| Mode | Behaviour |
|---|---|
| `smart` | Asks the AI whether the task description is clear enough. Only posts a clarification question if it's ambiguous. |
| `always` | Always posts "any dev notes?" before implementing every task. |

When a question is posted, the task is moved to `CLICKUP_PENDING_STATUS`. On the next run, aidev checks whether a human has replied and, if so, includes the reply as context for the AI.

---

## Scheduling

aidev can run on a cron schedule, one entry per project directory.

```bash
# Interactive picker
aidev schedule set

# Or pass an expression directly
aidev schedule set "*/15 * * * *"

# Check what's scheduled for the current directory
aidev schedule get
```

**Preset options (interactive picker)**

| Option | Expression |
|---|---|
| Every 15 minutes | `*/15 * * * *` |
| Every 30 minutes | `*/30 * * * *` |
| Every hour | `0 * * * *` |
| Every 5 hours | `0 */5 * * *` |
| Every day at 8am | `0 8 * * *` |

Each directory gets its own cron entry identified by a `# aidev-cwd:/path` marker — running `schedule set` again replaces the existing entry rather than adding a duplicate.

---

## Logging

Every run appends to `aidev.log` in your project directory:

```
────────────────────────────────────────────────────────────
2026-03-06T08:00:00.000Z [run] started
────────────────────────────────────────────────────────────
2026-03-06T08:00:00.120Z [info] Fetching tasks (filter: all)...
2026-03-06T08:00:01.340Z [task] [abc123] "Fix login flow" (status: open)
2026-03-06T08:00:12.780Z [info] Running claude...
2026-03-06T08:00:45.210Z [success] Task implemented: branch abc123/fix-login-flow pushed
2026-03-06T08:00:45.890Z [success] Done. Processed: 1, Skipped: 3
```

ANSI colour codes are stripped so the file stays readable in any editor or `tail -f`. `aidev.log` is added to `.gitignore` automatically by `aidev init`.

---

## Providers

| Provider | Status |
|---|---|
| ClickUp | ✅ Implemented |
| Jira | 🔜 Stub — contributions welcome |
| Notion | 🔜 Stub — contributions welcome |
| Trello | 🔜 Stub — contributions welcome |

The `TaskProvider` interface makes it straightforward to add new providers. See [CONTRIBUTING.md](./CONTRIBUTING.md).

---

## Contributing

Contributions are welcome — new providers, new AI runners, bug fixes, and docs improvements.

See [CONTRIBUTING.md](./CONTRIBUTING.md) for the full guide.

---

## License

[MIT](./LICENSE)

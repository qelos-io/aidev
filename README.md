# @qelos/aidev

[![npm version](https://img.shields.io/npm/v/%40qelos%2Faidev.svg?style=flat-square)](https://www.npmjs.com/package/@qelos/aidev)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=flat-square)](./LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18-brightgreen.svg?style=flat-square)](https://nodejs.org)

**aidev** turns your tasks into merged code — automatically.

It polls your task manager (ClickUp, Jira, or local markdown files), checks whether tasks are clear, runs Claude, Cursor, or Windsurf to implement them, pushes a branch, and moves the task to review. All without touching your keyboard.

```
Task (ClickUp / Jira / local)  →  AI implements  →  git push  →  "in review"
```

---

## Table of Contents

- [How it works](#how-it-works)
- [Quick start](#quick-start)
- [Commands](#commands)
- [Concurrency lock](#concurrency-lock)
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
3. **Clarify** — in `smart` mode, asks the AI if the task description is clear enough; if not, posts a question as a comment (prefixed with `[aidev]`) and marks the task `pending`
4. **Wait** — pending tasks are re-checked on the next run; if a human replied or the trigger word is found, implementation proceeds with the conversation as context
5. **Implement** — checks out a fresh branch (or reuses an existing one), runs your configured AI agent(s), falls back to the next agent if one fails
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
| `aidev stop` | Stop any running aidev process in the current directory |
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

## Concurrency lock

`aidev run` writes a PID lock file (`.aidev.lock`) in the current directory when it starts and removes it when it finishes. If a second invocation detects a live process already holding the lock, it logs a warning and exits immediately — preventing two agents from committing to the same branch at the same time.

```
$ aidev run
[aidev] aidev is already running in this directory (PID 12345). Use "aidev stop" to terminate it.
```

Use `aidev stop` to send `SIGTERM` to the running process and clean up the lock file:

```bash
aidev stop
```

Stale lock files (left behind by a crash) are detected automatically — the next `aidev run` will overwrite them if the stored PID is no longer alive.

---

## Configuration

Run `aidev init` for an interactive setup, or create `.env.aidev` manually using `.env.aidev.example` as a template.

### Global env file (`AIDEV_ENV_EXTEND`)

If you work across multiple projects, you can keep shared settings (API keys, agent list, etc.) in a single global file and reference it from each project's `.env.aidev`:

```bash
# ~/.aidev.global
CLICKUP_API_KEY=pk_...
CLICKUP_TEAM_ID=123456
AGENTS=claude,cursor
```

```bash
# my-project/.env.aidev  — project-specific values override the global ones
AIDEV_ENV_EXTEND=~/.aidev.global
CLICKUP_TAG=my-project
```

**Priority order (highest → lowest):**

1. Shell environment variables (e.g. set in `~/.zshrc`) — never overwritten
2. Local `.env.aidev` values
3. `AIDEV_ENV_EXTEND` file values (global base)

`AIDEV_ENV_EXTEND` can be set in two ways:

- **Per-project** — add `AIDEV_ENV_EXTEND=/path/to/file` inside `.env.aidev`
- **Shell-wide** — `export AIDEV_ENV_EXTEND=~/.aidev.global` in `~/.zshrc` (applies to every project automatically)

`aidev init` will ask for this path and pre-fill it if the variable is already in your shell environment.

### ClickUp

| Variable | Default | Description |
|---|---|---|
| `CLICKUP_API_KEY` | — | Personal API token — can be set as a shell env var |
| `CLICKUP_TEAM_ID` | — | Workspace / team ID — can be set as a shell env var |
| `CLICKUP_TAG` | — | Tasks with this tag will be picked up |
| `CLICKUP_PENDING_STATUS` | `pending` | Status name for "waiting for reply" |
| `CLICKUP_IN_REVIEW_STATUS` | `review` | Status set after implementation |
| `ASSIGNEE_TAG` | — | Only process tasks assigned to this user (optional) |
| `THINKING_TAG` | — | Tasks with this tag are analyzed and broken into sub-tasks before execution (optional) |
| `NON_CODE_TAG` | — | Tasks with this tag run without git branching (optional) |
| `NON_CODE_CLICKUP_TEAM_ID` | same as `CLICKUP_TEAM_ID` | Different workspace for non-code tasks (optional) |

> **Tip:** `CLICKUP_API_KEY` and `CLICKUP_TEAM_ID` are intentionally omitted from `.env.aidev` if you leave them blank during `aidev init` — they will be read from your shell environment instead.

### Git & GitHub

| Variable | Default | Description |
|---|---|---|
| `GIT_REMOTE` | auto-detected | Remote name — detected via `git remote get-url origin` if unset |
| `GITHUB_BASE_BRANCH` | `main` | Base branch; new task branches are cut from here |
| `GITHUB_REPO` | — | `owner/repo` — used to generate PR links in comments |

### Behaviour

| Variable | Default | Description |
|---|---|---|
| `AIDEV_ENV_EXTEND` | — | Path to a global env file loaded as the base for this project (see above) |
| `AGENTS` | `claude,cursor` | Comma-separated list of agents in priority order |
| `DEV_NOTES_MODE` | `smart` | When to ask for clarification (`smart` or `always`) |
| `AIDEV_TRIGGER_WORD` | `aidev-continue` | Comment containing this word re-triggers a skipped task |

---

## AI agents

aidev supports multiple AI agents with automatic fallback. The first available agent in the list is used; if it fails, the next one is tried with the previous agent's output as additional context.

**Supported agents**

| Agent | Requires |
|---|---|
| `claude` | [Claude CLI](https://github.com/anthropics/claude-code) installed and authenticated |
| `cursor` | Cursor **Agent CLI** (`agent`) in PATH and authenticated — see [setup](#cursor-agent-cli-setup) below |
| `windsurf` | [Windsurf](https://windsurf.com) installed with CLI available in PATH |

### Cursor Agent CLI setup

**macOS / Linux**

The `agent` binary is bundled with Cursor IDE. Install the shell command from inside Cursor:

1. Open the Command Palette (`Cmd+Shift+P`)
2. Run **Shell Command: Install 'cursor' command in PATH**

Or add Cursor's bin directory to your `~/.zshrc` / `~/.bashrc` manually:

```bash
export PATH="$PATH:/Applications/Cursor.app/Contents/Resources/app/bin"
```

**Windows**

The Cursor IDE (`cursor.exe`) is separate from the headless Agent CLI. Install it in PowerShell:

```powershell
irm 'https://cursor.com/install?win32=true' | iex
```

**Authentication (required)**

After installing, you must authenticate before `aidev` can use the Cursor runner. Choose one of:

```bash
# Option 1: interactive login (opens browser)
agent login

# Option 2: set API key from https://cursor.com/settings
export CURSOR_API_KEY=your_key_here
```

Run `agent --version` to confirm the binary is on your PATH. If authentication is missing, aidev will log a clear warning and skip the Cursor runner automatically.

**Configure agent order in `.env.aidev`:**

```bash
# Claude first, fall back to Cursor
AGENTS=claude,cursor

# Cursor only
AGENTS=cursor

# Cursor first (useful when working locally with a monitor)
AGENTS=cursor,claude

# All three: Claude first, then Windsurf, then Cursor
AGENTS=claude,windsurf,cursor

# Windsurf only
AGENTS=windsurf
```

---

## Trigger word & re-processing

aidev prefixes every comment it posts with `[aidev]`. This lets it distinguish its own comments from human replies when deciding whether to re-process a task.

A task is normally skipped when:
- A remote branch already exists for it, **or**
- It is `pending` and no human has replied yet

To force aidev to pick the task up again, post a comment containing the **trigger word** (default: `aidev-continue`). aidev will reuse the existing branch and continue implementation from where it left off.

```bash
# Customise the trigger word in .env.aidev
AIDEV_TRIGGER_WORD=please-retry
```

The trigger word match is case-insensitive, so `aidev-continue`, `AIDEV-CONTINUE`, and `Aidev-Continue` all work.

For pending tasks, a regular human reply (any comment without `[aidev]`) also triggers re-processing — the trigger word is an additional explicit mechanism.

---

## Non-code tasks

Tasks tagged with `NON_CODE_TAG` are executed **without git branching** — no checkout, commit, push, or PR creation. The AI agent runs the task directly in the current working directory.

This is useful for:
- Research or investigation tasks
- Documentation updates that don't go through PR review
- Running scripts or commands
- Any task where you want the AI to act without creating a branch

```bash
# In .env.aidev
NON_CODE_TAG=non-code

# Optionally use a different ClickUp team for non-code tasks
NON_CODE_CLICKUP_TEAM_ID=987654

# Or a different Jira project
NON_CODE_JIRA_PROJECT=OPS
```

Non-code tasks follow the same lifecycle as regular tasks (clarification → implementation → review), except the implementation step skips all git operations. After completion, the task status is moved to your configured "in review" status.

If `NON_CODE_TAG` is not configured, non-code task processing is disabled entirely.

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

### macOS: Full Disk Access required

On macOS (Ventura and later), cron jobs are silently blocked unless `/usr/sbin/cron` has Full Disk Access:

1. Open **System Settings → Privacy & Security → Full Disk Access**
2. Click **+** and add `/usr/sbin/cron`
3. Re-run `aidev schedule set` to apply your schedule

Without this, cron will appear to be configured but jobs will never fire.

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
| Jira | ✅ Implemented |
| Local | ✅ Implemented |
| Notion | 🔜 Stub — contributions welcome |
| Trello | 🔜 Stub — contributions welcome |

The `TaskProvider` interface makes it straightforward to add new providers. See [CONTRIBUTING.md](./CONTRIBUTING.md).

### Local provider

Set `PROVIDER=local` in `.env.aidev` to manage tasks entirely via local markdown files — no external API needed.

```bash
aidev init   # choose "local" when prompted for provider
```

Tasks live in `.aidev/tasks/` under status folders:

```
.aidev/tasks/
  open/          # new tasks ready for implementation
  pending/       # waiting for human reply
  progress/      # currently being implemented
  review/        # implementation complete, awaiting review
  done/          # finished
```

**Task file format** (e.g. `.aidev/tasks/open/a1b2c3d4-fix-login-bug.md`):

```markdown
---
title: Fix login page bug
priority: 2
assignee: david
estimated: 2h
tags: frontend, auth
created: 2026-03-12T10:00:00.000Z
---

The login form should redirect users to the dashboard after successful authentication.
```

The filename must start with a short ID (hex characters) followed by a dash and a slug. The YAML frontmatter carries task metadata; everything after `---` is the task description.

#### Code vs non-code tasks

By default, local tasks are treated as **code tasks** — aidev creates a git branch, runs the AI agent, commits, pushes, and opens a PR.

To mark a task as **non-code** (research, docs, investigation — no git branching), add `type: non-code` to the frontmatter:

```markdown
---
title: Compare OAuth2 providers
type: non-code
tags: research
---

Evaluate Auth0, Clerk, and Supabase Auth. Write a recommendation.
```

Non-code tasks follow the same lifecycle but skip all git operations. The AI response is posted as a session comment instead of a PR.

**Session file** (comments) — `.aidev/tasks/open/a1b2c3d4-fix-login-bug.session.md`:

```markdown
<!-- aidev session log — append your comments below using "## your-name" as header -->

---

## aidev — 2026-03-12T10:05:00.000Z

[aidev] Starting implementation on branch `a1b2c3d4/fix-login-bug`

---

## david — 2026-03-12T10:10:00.000Z

Please use the new auth API endpoint for this.
```

To add a comment, append a `---` separator followed by a `## your-name` header and your message. aidev parses these entries automatically and uses them as conversation context, just like ClickUp/Jira comments.

The `.aidev/` folder is automatically added to `.gitignore` during `aidev init`.

---

## Contributing

Contributions are welcome — new providers, new AI runners, bug fixes, and docs improvements.

See [CONTRIBUTING.md](./CONTRIBUTING.md) for the full guide.

---

## License

[MIT](./LICENSE)

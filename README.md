# @qelos/aidev

[![npm version](https://img.shields.io/npm/v/%40qelos%2Faidev.svg?style=flat-square)](https://www.npmjs.com/package/@qelos/aidev)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=flat-square)](./LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18-brightgreen.svg?style=flat-square)](https://nodejs.org)

**aidev** turns your tasks into merged code — automatically.

It polls your task manager (ClickUp, Jira, Linear, Monday.com, Notion, Trello, or local markdown files), checks whether tasks are clear, runs Claude, Cursor, or Windsurf to implement them, pushes a branch, and moves the task to review. All without touching your keyboard.

```
Task (ClickUp / Jira / Monday / Notion / Trello / local)  →  AI implements  →  git push  →  "in review"
```

---

## Table of Contents

- [How it works](#how-it-works)
- [Quick start](#quick-start)
- [Commands](#commands)
- [Concurrency lock](#concurrency-lock)
- [Configuration](#configuration)
- [AI agents](#ai-agents)
- [Auto-merge accepted PRs](#auto-merge-accepted-prs)
- [Dev notes mode](#dev-notes-mode)
- [Scheduling](#scheduling)
- [Hooks](#hooks)
- [Logging](#logging)
- [Providers](#providers)
- [Contributing](#contributing)

---

## How it works

1. **Fetch** — pulls all tasks tagged with your configured tag from your task provider
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

The wizard will ask for your task provider credentials, git settings, and preferred AI agents.

> **Note:** `aidev init` currently supports **ClickUp, Jira, Linear, Local, and Monday.com**. For **Notion** and **Trello**, create `.env.aidev` manually using `.env.aidev.example` as a template (see [Configuration](#configuration)).
>
> For ClickUp, API keys can be left blank if they are already set as environment variables in your shell. For Jira, Linear, and Monday.com, the wizard requires credentials to be entered directly — to use shell env vars instead, edit `.env.aidev` after init and remove the values you want read from your environment.

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
| `aidev run accepted` | Auto-merge PRs for tasks in review with the accepted tag |
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
| `CLICKUP_TAG` | — | Tasks with this tag will be picked up (set to `*` to match all tasks) |
| `CLICKUP_PENDING_STATUS` | `pending` | Status name for "waiting for reply" |
| `CLICKUP_IN_REVIEW_STATUS` | `review` | Status set after implementation |
| `ASSIGNEE_TAG` | — | Only process tasks assigned to this user (optional) |
| `THINKING_TAG` | — | Tasks with this tag are analyzed and broken into sub-tasks before execution (optional) |
| `NON_CODE_TAG` | — | Tasks with this tag run without git branching (optional) |
| `NON_CODE_CLICKUP_TEAM_ID` | same as `CLICKUP_TEAM_ID` | Different workspace for non-code tasks (optional) |

> **Tip:** For ClickUp, API keys and tokens are intentionally omitted from `.env.aidev` if you leave them blank during `aidev init` — they will be read from your shell environment instead. For Jira, Linear, and Monday.com, the wizard requires these values; to use shell env vars, remove the entries from `.env.aidev` after init.

> **Wildcard tag (`*`):** Set `CLICKUP_TAG=*` (or `JIRA_LABEL=*` / `LINEAR_LABEL=*` / `TRELLO_LABEL=*`) to match **all** tasks regardless of tags/labels. This is useful when the AI dev has its own dedicated user in the task provider and every task assigned to it should be processed.

### Jira

| Variable | Default | Description |
|---|---|---|
| `JIRA_BASE_URL` | — | Jira instance URL (e.g. `https://mycompany.atlassian.net`) |
| `JIRA_EMAIL` | — | Email for Jira authentication |
| `JIRA_API_TOKEN` | — | API token — generate from [Atlassian account settings](https://id.atlassian.com/manage-profile/security/api-tokens) |
| `JIRA_PROJECT` | — | Project key (e.g. `PROJ`) |
| `JIRA_LABEL` | — | Issues with this label will be picked up (set to `*` to match all issues) |
| `JIRA_PENDING_STATUS` | `To Do` | Status name for "waiting for reply" |
| `JIRA_IN_REVIEW_STATUS` | `In Review` | Status set after implementation |
| `NON_CODE_JIRA_PROJECT` | same as `JIRA_PROJECT` | Different project for non-code tasks (optional) |

### Linear

| Variable | Default | Description |
|---|---|---|
| `LINEAR_API_KEY` | — | Personal API key from Linear Settings → API |
| `LINEAR_TEAM_ID` | — | Team UUID from your workspace |
| `LINEAR_LABEL` | — | Issues with this label will be picked up (set to `*` to match all issues) |
| `LINEAR_PENDING_STATUS` | `Backlog` | Status name for "waiting for reply" |
| `LINEAR_IN_REVIEW_STATUS` | `In Review` | Status set after implementation |
| `NON_CODE_LINEAR_TEAM_ID` | same as `LINEAR_TEAM_ID` | Different team for non-code tasks (optional) |

### Monday.com

| Variable | Default | Description |
|---|---|---|
| `MONDAY_API_TOKEN` | — | API token from monday.com Developer settings |
| `MONDAY_BOARD_ID` | — | Board ID (from the board URL) |
| `MONDAY_STATUS_COLUMN_ID` | `status` | Column ID for the status field |
| `MONDAY_GROUP_ID` | — | Group ID to filter items (optional) |

### Notion

| Variable | Default | Description |
|---|---|---|
| `NOTION_API_KEY` | — | Integration token from Notion → Settings → My integrations |
| `NOTION_DATABASE_ID` | — | Database ID from the database URL (32-char hex) |
| `NOTION_STATUS_PROPERTY` | `Status` | Name of the status property in the database |
| `NOTION_PENDING_STATUS` | `pending` | Status value for "waiting for reply" |
| `NOTION_IN_REVIEW_STATUS` | `review` | Status value set after implementation |

### Trello

| Variable | Default | Description |
|---|---|---|
| `TRELLO_API_KEY` | — | Developer API key from [trello.com/power-ups/admin](https://trello.com/power-ups/admin) |
| `TRELLO_TOKEN` | — | Auth token generated via Trello's token flow |
| `TRELLO_BOARD_ID` | — | Board ID from the board URL |
| `TRELLO_LABEL` | — | Label name on cards to pick up (set to `*` to match all cards assigned to the token user) |
| `TRELLO_OPEN_LIST` | `To Do` | List name for open/new cards |
| `TRELLO_PENDING_LIST` | `Blocked` | List name for "waiting for reply" |
| `TRELLO_IN_PROGRESS_LIST` | `Doing` | List name for cards being worked on |
| `TRELLO_IN_REVIEW_LIST` | `In Review` | List name for completed cards awaiting review |
| `TRELLO_OPEN_STATUS` | `open` | Semantic status mapped to the open list |
| `TRELLO_PENDING_STATUS` | `pending` | Semantic status mapped to the pending list |
| `TRELLO_IN_REVIEW_STATUS` | `review` | Semantic status mapped to the review list |

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
| `AIDEV_COMMENT_PREFIX` | `[aidev]` | Custom prefix for all aidev comments posted to task providers |
| `AIDEV_HOOKS_PATH` | — | Path to a `.ts` or `.js` module that exports hook functions (see [Hooks](#hooks)) |
| `ACCEPTED_TAG` | — | Tasks in review with this tag are auto-merged (see [Auto-merge accepted PRs](#auto-merge-accepted-prs)) |
| `DONE_STATUS` | — | Status to set after auto-merging an accepted PR (e.g. `done`) |
| `PR_SIGNATURE` | `Automated PR by aidev.` | Custom signature line appended to the PR body |

---

## Hooks

Set `AIDEV_HOOKS_PATH` in `.env.aidev` to a path relative to the project directory or an absolute path. `aidev init` writes `.aidev/aidev.hooks.ts` and sets `AIDEV_HOOKS_PATH=.aidev/aidev.hooks.ts` by default.

The module should export an object (or `export default`) whose properties are optional async functions. Only known hook names are used; anything else is ignored. If a hook throws, the current operation stops (for example the whole run after `beforeRun`, or conflict resolution after `beforeResolveConflicts`). If a hook returns an object, it replaces the context for that step (for example append to `context.prompt` in `beforeEachTask` and return the updated context).

**Hook names**

| Hook | When | Context notes |
|---|---|---|
| `beforeRun` / `afterRun` | Start / end of `aidev run` | `afterRun` includes `processed` and `skipped` counts |
| `beforeEachTask` / `afterEachTask` | Around each code task implementation | `prompt`, `branchName`, `task`; `afterEachTask` has `success` |
| `beforeResolveConflicts` / `afterResolveConflicts` | Merge conflict resolution with AI | `conflictFiles`, `prompt`; `afterResolveConflicts` has `resolved` |
| `beforeNonCodeTask` / `afterNonCodeTask` | Non-code tasks | `afterNonCodeTask` includes agent `output` |
| `beforeThinkingTask` / `afterThinkingTask` | Thinking-tag tasks (subtask plan) | `beforeThinkingTask` may adjust `subtasks` before steps run |

**Second argument: `vm`**

Each hook receives `(context, vm)`. The `vm` object exposes:

- `runAI(prompt)` — runs the first available configured AI agent
- `postComment(taskId, text)`, `updateStatus(taskId, status)`, `getComments(taskId)` — same family of operations as the task provider
- `log.info` / `log.warn` / `log.error` — prefixed hook logging

**TypeScript hooks**

`.ts` hook files are loaded at runtime via [jiti](https://www.npmjs.com/package/jiti) — no TypeScript compiler or toolchain needed. Just write a plain `.ts` file with the hook functions and aidev handles the rest.

---

## AI agents

aidev supports multiple AI agents with automatic fallback. The first available agent in the list is used; if it fails, the next one is tried with the previous agent's output as additional context.

**Supported agents**

| Agent | Requires |
|---|---|
| `antigravity` | Google **Antigravity** CLI (`agy` or `antigravity`) in PATH — see [Antigravity](https://antigravity.google/download) |
| `claude` | [Claude CLI](https://github.com/anthropics/claude-code) installed and authenticated |
| `cursor` | Cursor **Agent CLI** (`agent`) in PATH — see [Windows](#windows-cursor-agent-cli) below |
| `windsurf` | [Windsurf](https://windsurf.com) installed with CLI available in PATH |

### Windows: Cursor Agent CLI

On Windows, the Cursor IDE (`cursor.exe`) is separate from the headless Agent CLI. The runner uses the `agent` binary. Install it in PowerShell:

```powershell
irm 'https://cursor.com/install?win32=true' | iex
```

Then ensure `agent` is on your PATH and run `agent --version` to confirm. Without this, the Cursor runner will report as unavailable.

**Configure agent order in `.env.aidev`:**

```bash
# Claude first, fall back to Cursor
AGENTS=claude,cursor

# Cursor only
AGENTS=cursor

# Cursor first (useful when working locally with a monitor)
AGENTS=cursor,claude

# Claude first, then Windsurf, then Cursor
AGENTS=claude,windsurf,cursor

# Antigravity first, then Claude
AGENTS=antigravity,claude

# Windsurf only
AGENTS=windsurf
```

---

## Trigger word & re-processing

aidev prefixes every comment it posts with `[aidev]` (configurable via `AIDEV_COMMENT_PREFIX`). This lets it distinguish its own comments from human replies when deciding whether to re-process a task.

A task is normally skipped when:
- A remote branch already exists for it, **or**
- It is `pending` and no human has replied yet

To force aidev to pick the task up again, post a comment containing the **trigger word** (default: `aidev-continue`). aidev will reuse the existing branch and continue implementation from where it left off.

```bash
# Customise the trigger word in .env.aidev
AIDEV_TRIGGER_WORD=please-retry
```

The trigger word match is case-insensitive, so `aidev-continue`, `AIDEV-CONTINUE`, and `Aidev-Continue` all work.

For pending tasks, a regular human reply (any comment without the configured prefix) also triggers re-processing — the trigger word is an additional explicit mechanism.

```bash
# Customise the comment prefix in .env.aidev
AIDEV_COMMENT_PREFIX=[mybot]
```

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

## Auto-merge accepted PRs

When a task has been reviewed and is ready to merge, tag it with your configured `ACCEPTED_TAG`. On the next run, aidev will automatically merge the PR via the GitHub CLI (`gh`), update the task status, and sync your local main branch.

This feature is **optional** — it only activates when both `ACCEPTED_TAG` is configured and the `gh` CLI is installed and authenticated.

```bash
# In .env.aidev
ACCEPTED_TAG=accepted
DONE_STATUS=done
```

**How it works:**

1. Finds all tasks in your "in review" status that have the accepted tag
2. For each task: merges the PR with squash and deletes the remote branch (`gh pr merge --squash --delete-branch`)
3. Updates the task status to `DONE_STATUS` (if configured)
4. Checks out the base branch and pulls the latest changes

**Run it manually:**

```bash
aidev run accepted
```

**Automatic mode:** When `ACCEPTED_TAG` is set and `gh` is available, accepted PRs are also auto-merged at the end of every `aidev run`.

> **Prerequisites:** The [GitHub CLI](https://cli.github.com/) must be installed and authenticated (`gh auth login`). `aidev init` will prompt you for these settings if it detects `gh` on your PATH.

---

## Dev notes mode

Controls when aidev asks the task provider for clarification before implementing.

| Mode | Behaviour |
|---|---|
| `smart` | Asks the AI whether the task description is clear enough. Only posts a clarification question if it's ambiguous. |
| `always` | Always posts "any dev notes?" before implementing every task. |

When a question is posted, the task is moved to the configured pending status (e.g. `CLICKUP_PENDING_STATUS`, `JIRA_PENDING_STATUS`, etc.). On the next run, aidev checks whether a human has replied and, if so, includes the reply as context for the AI.

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

| Provider | Status | `aidev init` support |
|---|---|---|
| ClickUp | ✅ Implemented | ✅ Interactive wizard |
| Jira | ✅ Implemented | ✅ Interactive wizard |
| Linear | ✅ Implemented | ✅ Interactive wizard |
| Monday.com | ✅ Implemented | ✅ Interactive wizard |
| Local | ✅ Implemented | ✅ Interactive wizard |
| Notion | ✅ Implemented | Manual `.env.aidev` config |
| Trello | ✅ Implemented | Manual `.env.aidev` config |

> **Notion & Trello:** These providers are fully functional but not yet included in the `aidev init` wizard. To use them, set `PROVIDER=notion` or `PROVIDER=trello` in `.env.aidev` and fill in the required variables from the [Configuration](#configuration) section above.

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

Downloaded task attachments are stored in `.aidev/assets/<task-id>/`, and `aidev init` adds `.aidev/assets/` to `.gitignore` automatically.

---

## Contributing

Contributions are welcome — new providers, new AI runners, bug fixes, and docs improvements.

See [CONTRIBUTING.md](./CONTRIBUTING.md) for the full guide.

---

## License

[MIT](./LICENSE)

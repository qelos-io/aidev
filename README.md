# @qelos/aidev

[![npm version](https://img.shields.io/npm/v/%40qelos%2Faidev.svg?style=flat-square)](https://www.npmjs.com/package/@qelos/aidev)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=flat-square)](./LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18-brightgreen.svg?style=flat-square)](https://nodejs.org)

**aidev** turns your tasks into merged code — automatically.

It polls your task manager (ClickUp, Jira, Linear, Monday.com, Notion, Trello, or local markdown files), checks whether tasks are clear, runs Claude, Cursor, or Windsurf to implement them, pushes a branch, and moves the task to review. All without touching your keyboard.

```
Task  →  AI implements  →  git push  →  "in review"  →  AI resolves code review comments
```

---

## Table of Contents

- [How it works](#how-it-works)
- [Quick start](#quick-start)
- [Commands](#commands)
- [Concurrency lock](#concurrency-lock)
- [Configuration](#configuration)
- [AI agents](#ai-agents)
- [Code review resolution](#code-review-resolution)
- [Auto-merge accepted PRs](#auto-merge-accepted-prs)
- [Dev notes mode](#dev-notes-mode)
- [Blocked tasks](#blocked-tasks)
- [Local tasks file (`aidev.tasks.json`)](#local-tasks-file-aidevtasksjson)
- [Scheduling](#scheduling)
- [Hooks](#hooks)
- [Logging](#logging)
- [Providers](#providers)
- [UI dashboard](#ui-dashboard)
- [Contributing](#contributing)

---

## How it works

1. **Fetch** — pulls all tasks tagged with your configured tag from your task provider
2. **Filter** — skips done/cancelled tasks, tasks that already have a branch, and tasks that are blocked by other open tasks
3. **Clarify** — in `smart` mode, asks the AI if the task description is clear enough; if not, posts a question as a comment (prefixed with `[aidev]`) and marks the task `pending`
4. **Wait** — pending tasks are re-checked on the next run; if a human replied or the trigger word is found, implementation proceeds with the conversation as context
5. **Implement** — checks out a fresh branch (or reuses an existing one), runs your configured AI agent(s), falls back to the next agent if one fails
6. **Ship** — commits all changes, pushes the branch, posts a comment with the branch name and a PR link, moves the task to your "in review" status
7. **Review** — checks tasks already in review for unresolved PR code review comments; if found, runs an AI agent to fix code or reply to discussion threads

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

> **Note:** `aidev init` currently supports **ClickUp, Jira, Linear, Local, Monday.com, and Trello**. For **Notion**, create `.env.aidev` manually using `.env.aidev.example` as a template (see [Configuration](#configuration)).
>
> For ClickUp, API keys can be left blank if they are already set as environment variables in your shell. For Jira, Linear, Monday.com, and Trello, the wizard requires credentials to be entered directly — to use shell env vars instead, edit `.env.aidev` after init and remove the values you want read from your environment.

Once configured:

```bash
aidev run
```

---

## Commands

| Command | Description |
|---|---|
| `aidev init` | Interactive setup — creates `.env.aidev` |
| `aidev run` | Process open + pending tasks, then check review tasks for unresolved PR comments |
| `aidev run open` | Only open (non-pending) tasks |
| `aidev run pending` | Only pending tasks — check for human replies |
| `aidev run accepted` | Auto-merge PRs for tasks in review with the accepted tag |
| `aidev run tasks` | Publish all entries in `aidev.tasks.json` and exit (no AI run) |
| `aidev tasks add` | Add a new entry to `aidev.tasks.json` (interactive) |
| `aidev tasks ls` | List entries currently queued in `aidev.tasks.json` |
| `aidev tasks update [id]` | Edit a queued entry (interactive if `id` omitted) |
| `aidev tasks remove [id]` | Delete a queued entry (interactive if `id` omitted) |
| `aidev tasks push` | Same as `aidev run tasks` — publish all queued entries and exit |
| `aidev stop` | Stop any running aidev process in the current directory |
| `aidev ui` | Launch the local web dashboard (see [UI dashboard](#ui-dashboard)) |
| `aidev schedule set` | Interactive cron picker for this directory |
| `aidev schedule set "<expr>"` | Set a specific cron expression |
| `aidev schedule set "<expr>" -e <path>` | Set a schedule that uses a custom env file when it fires |
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
| `THINKING_TAG` | `thinking` | Tasks with this tag are analyzed and broken into sub-tasks before execution |
| `PLANNING_TAG` | `planning` | Tasks with this tag are split into self-contained sub-tickets pushed back to the provider |
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

Linear calls them "labels" — the same concept as `CLICKUP_TAG` / `JIRA_LABEL`. Tasks created via `aidev.tasks.json` with `tags` are mapped to Linear labels on the configured team, and missing labels are created automatically. Default status names align with Linear's standard workflow (`Backlog`, `Todo`, `In Progress`, `In Review`, `Done`); if your team renamed those states (e.g. `Triage` instead of `Backlog`), aidev also falls back to matching by Linear's underlying state type.

| Variable | Default | Description |
|---|---|---|
| `LINEAR_API_KEY` | — | Personal API key from Linear Settings → API |
| `LINEAR_TEAM_ID` | — | Team UUID from your workspace |
| `LINEAR_LABEL` | — | Issues with this label will be picked up (set to `*` to match all issues) |
| `LINEAR_PENDING_STATUS` | `Pending` | Status name for "waiting for reply" |
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
| `ACCEPTED_TAG` | `accepted` | Tasks in review with this tag are auto-merged (see [Auto-merge accepted PRs](#auto-merge-accepted-prs)) |
| `DONE_STATUS` | auto-detected | Status to set after auto-merging an accepted PR. When unset, aidev picks the first match of `done`, `closed`, `finish`, `success`, `prod` from the board's statuses |
| `PR_SIGNATURE` | `Automated PR by aidev.` | Custom signature line appended to the PR body |
| `AIDEV_AUTO_COMPRESS` | `true` | Auto-compress older comments when the prompt grows large. Set to `false` / `0` / `no` to opt out |
| `AIDEV_COMPRESS_THRESHOLD` | `12000` | Char-length threshold that triggers compression |

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
| `beforeReviewTask` / `afterReviewTask` | Review tasks with unresolved PR comments | `threads`, `prompt`, `branchName`; `afterReviewTask` has `success`, `resolvedCount` |

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

## Blocked tasks

If a task lists other tasks as blockers (via your provider's dependency feature), aidev will skip it until all blockers are closed.

**How it works:**

1. When a task is fetched, its blocking dependencies are read from the provider.
2. Before running the AI agent, aidev fetches each blocker task and checks its status.
3. If any blocker is still open (not in a done/closed/cancelled/complete/resolved state), the task is skipped with a log message:

```
skipped: blocked by task <id> (status: in progress)
```

4. Once all blockers are resolved, the task is picked up on the next run as normal.

**Per-provider support:**

| Provider | Blocking support | Source |
|---|---|---|
| ClickUp | Native | `dependencies` with `type === 0` ("waiting on") |
| Jira | Native | Issue links where the link type inward direction is `"is blocked by"` |
| Linear | Native | Issue relations of type `blocked` |
| Monday.com | Native | Dependency-type column values on the board |
| Notion | Optional | A Relation property named **Blocked By** (case-insensitive) in the database — see note below |
| Trello | Not supported | Trello has no native blocking concept |
| Local | Not applicable | — |

> **Notion setup:** To enable blocked-by checking for Notion, add a **Relation** property named `Blocked By` to your task database and point it at the same (or another) task database. If the property is absent, the check is silently skipped and all tasks proceed normally.

**Edge cases:**

- If a blocker task cannot be fetched (deleted or inaccessible), it is treated as non-blocking.
- Only direct blockers are checked — circular or transitive dependencies are not followed.
- If a future provider does not implement `fetchTaskById`, the blocker check is silently skipped and the task proceeds (fail open).

No additional configuration is required for providers with native support; the behaviour is automatic when the provider exposes dependency data.

---

## Auto-compress

For long-running tasks with many comments, the combined prompt (description + conversation history + review threads) can grow past the AI agent's effective context window. When the assembled context exceeds `AIDEV_COMPRESS_THRESHOLD` characters (default `12000`), aidev summarises the older comments via the configured AI agent and keeps only the **latest comment verbatim** — so the agent always sees the user's most recent intent without ambiguity.

Compressed summaries are cached under `.aidev/sessions/<taskId>.json` and reused across runs; new comments invalidate the cache and trigger a re-summarisation of the delta. The directory is added to `.gitignore` automatically.

This is **on by default**. To opt out:

```bash
# In .env.aidev
AIDEV_AUTO_COMPRESS=false

# Or raise the threshold instead of disabling
AIDEV_COMPRESS_THRESHOLD=24000
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

## Code review resolution

When `aidev run` executes, it also checks tasks in **review** status for unresolved PR code review comments. If any actionable threads are found, an AI agent is run to address them — either by fixing the code or replying to discussion comments.

**How it works:**

1. Fetches all tasks in your configured "in review" status
2. For each task, finds the associated PR by branch name (via `gh` CLI)
3. Fetches unresolved review threads from the PR
4. Filters out threads where the last comment is from aidev itself (to avoid re-processing)
5. Runs an AI agent to address the remaining threads — code fixes are committed and pushed, discussion replies are posted directly on the thread
6. Resolved threads are marked as resolved on GitHub

This runs automatically as part of every `aidev run` (after processing open/pending tasks). No additional configuration is needed beyond having `gh` CLI installed and authenticated.

> **Prerequisites:** The [GitHub CLI](https://cli.github.com/) must be installed and authenticated (`gh auth login`). If `gh` is not available, review task processing is silently skipped.

---

## Auto-merge accepted PRs

When a task has been reviewed and is ready to merge, tag it with `accepted` (the default — override via `ACCEPTED_TAG`). On the next run, aidev will automatically merge the PR via the GitHub CLI (`gh`), update the task status, and sync your local main branch.

This feature works out of the box whenever the `gh` CLI is installed and authenticated.

```bash
# In .env.aidev (both optional)
# ACCEPTED_TAG=accepted   # the tag aidev looks for on review tasks (default: accepted)
# DONE_STATUS=done        # status to apply after merge — auto-detected when omitted
```

**How it works:**

1. Finds all tasks in your "in review" status that have the accepted tag (`accepted` by default)
2. For each task: merges the PR with squash and deletes the remote branch (`gh pr merge --squash --delete-branch`)
3. Updates the task status to `DONE_STATUS`. When unset, aidev probes the board for one of `done`, `closed`, `finish`, `success`, `prod` and uses the first match
4. Checks out the base branch and pulls the latest changes

**Run it manually:**

```bash
aidev run accepted
```

**Automatic mode:** Whenever `gh` is available, accepted PRs are also auto-merged at the end of every `aidev run`.

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

## Local tasks file (`aidev.tasks.json`)

`aidev.tasks.json` is an **outbound queue** — a JSON file that sits at the root of your project and holds task templates that aidev will publish to your configured provider (ClickUp, Jira, Linear, etc.). It is the opposite direction from the [Local provider](#local-provider): the local provider **stores** tasks on disk, while `aidev.tasks.json` **pushes** tasks to a remote provider.

Typical uses:

- **Recurring tasks** — with a `cron` expression, an entry publishes a fresh task on every matching tick (daily standup reminders, weekly reviews, monthly housekeeping).
- **Staged work** — queue a batch of tasks in a commit so they appear in the provider together when `aidev` next runs.
- **AI-authored tasks** — another AI agent or script can append entries to the file; `aidev` will pick them up and create real tickets.

The file is added to `.gitignore` by `aidev init` — each developer or automation environment maintains their own queue.

### File format

`aidev.tasks.json` is a JSON array of task entries. Each entry has the shape:

```ts
interface LocalTask {
  id: string;              // UUID — generated automatically by "aidev tasks add"
  title: string;           // required — task title on the remote provider
  description: string;     // task body / description
  type: 'code' | 'non-code'; // routes to the non-code provider when set to 'non-code'
  priority?: number;       // 1=urgent, 2=high, 3=normal, 4=low
  assignee?: string;       // currently informational (reserved for future use)
  dueDate?: string;        // ISO date, e.g. "2026-05-01"
  tags?: string[];         // extra tags appended to the provider-configured tag
  listId?: string;         // override provider list / project ID for this task only
  cron?: string;           // 5-field cron — if set, the task is re-published on every tick
  lastPushedAt?: number;   // epoch ms of the last successful push (managed by aidev for cron entries)
}
```

**Example** (`aidev.tasks.json`):

```json
[
  {
    "id": "7f3a9c2d-5b1e-4a6f-9d8c-1e2f3a4b5c6d",
    "title": "Daily standup notes",
    "description": "Post yesterday / today / blockers to the team channel.",
    "type": "non-code",
    "priority": 3,
    "tags": ["standup"],
    "cron": "0 9 * * 1-5"
  },
  {
    "id": "2b8e1f7a-4c9d-4e5a-8b6c-9f1e2d3c4b5a",
    "title": "Upgrade dependencies",
    "description": "Run `npm outdated`, bump minor/patch versions, verify tests pass.",
    "type": "code",
    "priority": 2,
    "tags": ["maintenance"]
  }
]
```

### Lifecycle

1. **Every `aidev run`** (regardless of filter) begins by reading `aidev.tasks.json` and attempting to publish each entry via the configured provider's `createTask` API.
2. **One-shot entries** (no `cron` field) are **removed from the file** after a successful push — they become a real ticket and won't be duplicated on the next run.
3. **Cron entries** remain in the file. `lastPushedAt` is updated on each successful push; on the next run, aidev checks whether the cron has fired at least once since `lastPushedAt` before republishing. A fresh entry with a cron fires on the first run that matches.
4. **Failures** are logged and the entry is kept — the next run retries.

### Routing

- `type: 'code'` → published with the code tag (`CLICKUP_TAG` / `JIRA_LABEL` / `LINEAR_LABEL`, etc.) to the primary provider.
- `type: 'non-code'` → published with `NON_CODE_TAG` to the non-code provider (a separate team / project if `NON_CODE_CLICKUP_TEAM_ID`, `NON_CODE_JIRA_PROJECT`, or `NON_CODE_LINEAR_TEAM_ID` is configured, otherwise the primary).
- Per-task `tags` are appended to the resolved default tag.
- Per-task `listId` overrides the provider-default list / project for that single task.

### Managing entries

Use the built-in commands rather than hand-editing JSON (although hand-editing is fine — the file is plain JSON):

```bash
aidev tasks add              # interactive prompt: title, description, type, priority, due date, tags, list, cron
aidev tasks ls               # table of queued entries
aidev tasks update [id]      # edit an entry by table ID (interactive picker if no id)
aidev tasks remove [id]      # delete an entry by table ID (interactive picker if no id)
aidev tasks push             # publish everything now (same as "aidev run tasks") — useful for dry-running or in scripts
```

`aidev tasks push` and `aidev run tasks` do the same thing: they only process `aidev.tasks.json` and exit without pulling tasks from the provider or invoking the AI. This is useful when you want to decouple queue publishing from the main AI loop — for example, running `aidev tasks push` from a separate cron entry or CI job.

---

## Scheduling

aidev can run on a cron schedule, one entry per project directory.

```bash
# Interactive picker
aidev schedule set

# Or pass an expression directly
aidev schedule set "*/15 * * * *"

# Run a schedule against a custom env file (so the scheduled run uses
# that config — useful when several env files live alongside one repo)
aidev schedule set "*/15 * * * *" -e /path/to/custom/.env.aidev

# Check what's scheduled for the current directory
aidev schedule get
```

The `-e <path>` option is baked into the scheduled entry itself (the cron
line on Linux, the LaunchAgent plist on macOS, or the Task Scheduler `/tr`
command on Windows), so each run will pick up the right env file without
relying on the shell environment at firing time.

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

To write the log somewhere else, set `AIDEV_LOG_PATH` to an absolute, relative, or `~/`-prefixed path that includes the **file name** (not just the folder). Relative paths are resolved against the project cwd and missing parent directories are created on first write.

```bash
AIDEV_LOG_PATH=logs/aidev.log         # → <cwd>/logs/aidev.log
AIDEV_LOG_PATH=/var/log/aidev.log     # absolute
AIDEV_LOG_PATH=~/aidev/run.log        # under your home directory
```

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
| Trello | ✅ Implemented | ✅ Interactive wizard |

> **Notion:** This provider is fully functional but not yet included in the `aidev init` wizard. To use it, set `PROVIDER=notion` in `.env.aidev` and fill in the required variables from the [Configuration](#configuration) section above.

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

## UI dashboard

`aidev ui` starts a local Nuxt dashboard for managing `.env.aidev`, browsing the log file, working with provider tasks, and triggering `aidev run` from a browser. The server binds to `127.0.0.1` only and requires a one-shot token printed when the command starts — nothing is exposed beyond your machine.

**Run it:**

```bash
aidev ui                 # http://127.0.0.1:19422
aidev ui --port 19500    # pick a different port
```

If you installed aidev from npm (e.g. `npm install -g @qelos/aidev`), the prebuilt Nuxt output is included in the package and `aidev ui` serves it directly — no extra setup. If you're hacking on the dashboard from a source checkout, install dev deps once (`cd ui && npm install`) and `aidev ui` will run Nuxt in dev mode with hot reload; pass `--prod` to serve the built output instead (after `cd ui && npm run build`).

The command prints a `http://127.0.0.1:<port>/login?token=<token>` URL — click it to authenticate. The token is regenerated on every launch and stored in the browser's `localStorage` for the session.

See `ui/docs/handover/` for the per-screen design notes used when extending the dashboard.

---

## Contributing

Contributions are welcome — new providers, new AI runners, bug fixes, and docs improvements.

See [CONTRIBUTING.md](./CONTRIBUTING.md) for the full guide.

---

## License

[MIT](./LICENSE)

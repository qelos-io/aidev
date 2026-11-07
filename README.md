# @qelos/aidev

[![npm version](https://img.shields.io/npm/v/%40qelos%2Faidev.svg?style=flat-square)](https://www.npmjs.com/package/@qelos/aidev)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=flat-square)](./LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D22-brightgreen.svg?style=flat-square)](https://nodejs.org)
[![Docs](https://img.shields.io/badge/docs-GitHub%20Pages-6366f1?style=flat-square)](https://qelos-io.github.io/aidev/)

**aidev** turns your tasks into merged code — automatically.

It polls your task manager (ClickUp, Jira, Linear, Monday.com, Notion, Trello, or local markdown files), checks whether tasks are clear, runs your configured AI agent (aider, Claude, Cursor, Devin, and more) to implement them, pushes a branch, and moves the task to review.

```
Task  →  AI implements  →  git push  →  "in review"  →  agent review  →  AI resolves code review comments
```

## Quick start

```bash
npm install -g @qelos/aidev
cd my-project
aidev init
aidev run
```

## Documentation

Full documentation is published at **[qelos-io.github.io/aidev](https://qelos-io.github.io/aidev/)**.

| Topic | Link |
|---|---|
| Getting started | [guide/getting-started](https://qelos-io.github.io/aidev/guide/getting-started) |
| Commands | [guide/commands](https://qelos-io.github.io/aidev/guide/commands) |
| Configuration | [guide/configuration](https://qelos-io.github.io/aidev/guide/configuration) |
| Providers | [guide/providers](https://qelos-io.github.io/aidev/guide/providers) |
| AI agents | [guide/agents](https://qelos-io.github.io/aidev/guide/agents) |
| MCP servers | [guide/mcp](https://qelos-io.github.io/aidev/guide/mcp) |
| Contributing | [contributing](https://qelos-io.github.io/aidev/contributing) |

To work on the docs locally:

```bash
cd documentation
npm install
npm run dev
```

## Child process config inheritance

When `aidev run` is launched with custom configuration (a custom `-e` env file path, a custom log path, or custom env vars), any `aidev` subcommand invoked by the spawned AI agent **in the same directory** automatically inherits the parent's resolved config — including those custom values. No user configuration is required; it is automatic.

This matters because AI agents frequently shell out to other `aidev` commands (e.g. `aidev tasks push`). Without inheritance those child commands would load config from the default on-disk location and miss the parent's custom `-e` path / env vars.

**Requirements:**
- The parent `aidev run` must be a true ancestor process of the child (parent, grandparent, …).
- The parent and child must be running in the same working directory.

**Mechanism:**
1. `aidev run` acquires a directory lock (`.aidev.lock` containing its PID) and starts a local IPC config server on a per-PID socket.
2. A child `aidev` subcommand reads `.aidev.lock` from its CWD, verifies the lock holder is alive and is an ancestor of the child process, then requests the resolved `Config` over the IPC socket and adopts it wholesale (applying the parent's published env vars to `process.env`).
3. If there is no lock, the lock holder is dead, or the lock holder is not an ancestor, the child falls back to normal disk-based config loading.

Because `aidev run` holds the directory lock while running, a child `aidev run` invoked in the same directory will exit at the lock rather than start a second concurrent run.

## Auto-shutdown of agent sub-processes

Agent clients (claude, cursor, …) often leave things running: dev servers (node, python, go) and docker containers. With `AIDEV_AUTO_SHUTDOWN` enabled (the default), aidev stops those leftovers once the whole run is finished and every task is done. Processes are left alone between task iterations.

Cleanup is conservative: it never stops aidev itself, processes that existed before the run started, or unrelated processes.

| Variable | Default | Description |
|----------|---------|-------------|
| `AIDEV_AUTO_SHUTDOWN` | `true` | Stop processes started by agent clients after the run. Set to `false` / `0` / `no` to disable. |

## Skills source (external skills / rules)

Point aidev at an external skills/rules source — a local folder or a git repo you can access — and `aidev run` exposes it read-only to the AI agents. The source is never committed or modified by aidev.

| Variable | Default | Description |
|----------|---------|-------------|
| `AIDEV_SKILLS_SOURCE` | _(unset = disabled)_ | Local folder path, or a git URL (`https://…`, `git@…`, `ssh://…`, or anything ending in `.git`). |
| `AIDEV_SKILLS_BRANCH` | `main` | Branch to track for git sources. |
| `AIDEV_SKILLS_SUBDIR` | _(repo root)_ | Subfolder of the source where skills/rules live. |

`aidev init` asks for the source (optional) and writes it to `.env.aidev`.

**How it works**

- **Resolved once per `aidev run`**, before any task is processed. A missing or unreadable source fails the run early with a clear message. Child `aidev` processes inherit the resolved config and never re-clone.
- **Layout detection**: `skills/`, `rules/`, `agents/`, `.agents/*`, `.claude/skills`, `.cursor/rules`, or a flat folder containing `SKILL.md` files.
- **Git sources** are cloned into a user-level cache (`~/.aidev/skills-cache/<hash>`), outside your repo, and forced to the latest `origin/<branch>` on every run. If the network is down, the existing cache is used with a warning.
- **Passed to agents directly** (CLI flags / prompt hint) for Claude, Cursor, Codex, OpenCode and aider. Only agents with no such option (e.g. antigravity, devin, anthropic-sdk) get a symlink fallback (`.agents/skills/aidev-skills`, plus `.claude/skills` / `.cursor/rules` as needed; a junction on Windows). Links are created at the start of the run and removed when it ends, including on Ctrl+C. aidev never overwrites an existing real file or folder at those paths.

**Guarantees**

- **Read-only**: git caches are made read-only after each update (best-effort on Windows) and agents are told not to modify the source.
- **Never committed**: `aidev-skills` is added to `.git/info/exclude` (your `.gitignore` is untouched), and aidev's commit steps unstage any `aidev-skills` path or symlink pointing outside the repo, even if the exclude entry is missing.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md).

## License

[MIT](./LICENSE)

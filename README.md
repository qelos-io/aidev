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

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md).

## License

[MIT](./LICENSE)

# @qelos/aidev

[![npm version](https://img.shields.io/npm/v/%40qelos%2Faidev.svg?style=flat-square)](https://www.npmjs.com/package/@qelos/aidev)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=flat-square)](./LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D22-brightgreen.svg?style=flat-square)](https://nodejs.org)
[![Docs](https://img.shields.io/badge/docs-GitHub%20Pages-6366f1?style=flat-square)](https://qelos-io.github.io/aidev/)

**aidev** turns your tasks into merged code — automatically.

It polls your task manager (ClickUp, Jira, Linear, Monday.com, Notion, Trello, or local markdown files), checks whether tasks are clear, runs your configured AI agent (aider, Claude, Cursor, Devin, and more) to implement them, pushes a branch, and moves the task to review.

```
Task  →  AI implements  →  git push  →  "in review"  →  AI resolves code review comments
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
| Contributing | [contributing](https://qelos-io.github.io/aidev/contributing) |

To work on the docs locally:

```bash
cd documentation
npm install
npm run dev
```

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md).

## License

[MIT](./LICENSE)

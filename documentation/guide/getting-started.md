# Getting started

**aidev** connects your task manager to your AI coding agents. It fetches tagged tasks, clarifies ambiguous work, implements changes on a git branch, pushes a PR, and can even resolve review comments — all on a schedule or on demand.

## Install

```bash
npm install -g @qelos/aidev
```

Requires **Node.js 22+**.

## Interactive setup

Navigate to your project and run:

```bash
cd my-project
aidev init
```

The wizard asks for your task provider credentials, git settings, and preferred AI agents.

::: tip Init wizard coverage
`aidev init` supports **ClickUp, Jira, Linear, Local, Monday.com, and Trello**. For **Notion**, create `.env.aidev` manually using `.env.aidev.example` as a template (see [Configuration](/guide/configuration)).
:::

For ClickUp, API keys can be left blank if they are already set as environment variables in your shell. For Jira, Linear, Monday.com, and Trello, the wizard requires credentials to be entered directly — to use shell env vars instead, edit `.env.aidev` after init and remove the values you want read from your environment.

## First run

Once configured:

```bash
aidev run
```

This processes open and pending tasks, then checks review tasks for unresolved PR comments.

## What to read next

- [How it works](/guide/how-it-works) — the full task lifecycle
- [Commands](/guide/commands) — every CLI command and flag
- [Configuration](/guide/configuration) — all environment variables
- [Providers](/guide/providers) — pick your task source
- [AI agents](/guide/agents) — configure agent priority and fallback

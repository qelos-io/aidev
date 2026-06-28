# Configuration

Run `aidev init` for an interactive setup, or create `.env.aidev` manually using `.env.aidev.example` as a template in the repository root.

## Global env file (`AIDEV_ENV_EXTEND`)

If you work across multiple projects, keep shared settings (API keys, agent list, etc.) in a single global file and reference it from each project's `.env.aidev`:

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

## Provider-specific settings

Each provider has its own env vars — see the dedicated pages:

- [ClickUp](/guide/configuration/clickup)
- [Jira](/guide/configuration/jira)
- [Linear](/guide/configuration/linear)
- [Monday.com](/guide/configuration/monday)
- [Notion](/guide/configuration/notion)
- [Trello](/guide/configuration/trello)

## Git, GitHub, and behaviour

- [Git & GitHub](/guide/configuration/git)
- [Behaviour](/guide/configuration/behaviour)

## Wildcard tags

Set `CLICKUP_TAG=*` (or `JIRA_LABEL=*` / `LINEAR_LABEL=*` / `TRELLO_LABEL=*`) to match **all** tasks regardless of tags/labels. Useful when the AI dev has its own dedicated user and every assigned task should be processed.

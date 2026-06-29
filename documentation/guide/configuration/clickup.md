# ClickUp configuration

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

::: tip Shell env vars
For ClickUp, API keys and tokens are intentionally omitted from `.env.aidev` if you leave them blank during `aidev init` — they will be read from your shell environment instead.
:::

[← Back to configuration overview](/guide/configuration)

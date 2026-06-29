# Linear configuration

Linear calls them "labels" — the same concept as `CLICKUP_TAG` / `JIRA_LABEL`. Tasks created via `aidev.tasks.json` with `tags` are mapped to Linear labels on the configured team, and missing labels are created automatically.

Default status names align with Linear's standard workflow (`Backlog`, `Todo`, `In Progress`, `In Review`, `Done`); if your team renamed those states (e.g. `Triage` instead of `Backlog`), aidev also falls back to matching by Linear's underlying state type.

| Variable | Default | Description |
|---|---|---|
| `LINEAR_API_KEY` | — | Personal API key from Linear Settings → API |
| `LINEAR_TEAM_ID` | — | Team UUID from your workspace |
| `LINEAR_LABEL` | — | Issues with this label will be picked up (set to `*` to match all issues) |
| `LINEAR_PENDING_STATUS` | `Pending` | Status name for "waiting for reply" |
| `LINEAR_IN_REVIEW_STATUS` | `In Review` | Status set after implementation |
| `NON_CODE_LINEAR_TEAM_ID` | same as `LINEAR_TEAM_ID` | Different team for non-code tasks (optional) |

[← Back to configuration overview](/guide/configuration)

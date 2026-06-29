# Jira configuration

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

[← Back to configuration overview](/guide/configuration)

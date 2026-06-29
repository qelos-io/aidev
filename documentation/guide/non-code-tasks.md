# Non-code tasks

Tasks tagged with `NON_CODE_TAG` are executed **without git branching** — no checkout, commit, push, or PR creation. The AI agent runs the task directly in the current working directory.

Useful for:

- Research or investigation tasks
- Documentation updates that don't go through PR review
- Running scripts or commands
- Any task where you want the AI to act without creating a branch

```bash
NON_CODE_TAG=non-code
NON_CODE_CLICKUP_TEAM_ID=987654
NON_CODE_JIRA_PROJECT=OPS
```

Non-code tasks follow the same lifecycle as regular tasks (clarification → implementation → review), except the implementation step skips all git operations.

If `NON_CODE_TAG` is not configured, non-code task processing is disabled entirely.

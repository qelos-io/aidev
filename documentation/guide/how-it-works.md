# How it works

<FlowDiagram />

## Step by step

1. **Fetch** — pulls all tasks tagged with your configured tag from your task provider
2. **Filter** — skips done/cancelled tasks, tasks that already have a branch, and tasks blocked by other open tasks
3. **Clarify** — in `smart` mode, asks the AI if the task description is clear enough; if not, posts a question as a comment (prefixed with `[aidev]`) and marks the task `pending`
4. **Wait** — pending tasks are re-checked on the next run; if a human replied or the trigger word is found, implementation proceeds with the conversation as context
5. **Implement** — checks out a fresh branch (or reuses an existing one), runs your configured AI agent(s), falls back to the next agent if one fails
6. **Ship** — commits all changes, pushes the branch, posts a comment with the branch name and a PR link, moves the task to your "in review" status
7. **Agent review** — for in-review tasks tagged with `agent review`, fetches the PR diff via `gh`, runs an AI review, and posts inline comments (or an approving review when no issues are found)
8. **Code review** — checks tasks already in review for unresolved human PR review comments; if found, runs an AI agent to fix code or reply to discussion threads
9. **Merge** — tasks tagged `accepted` are squash-merged via `gh` (see [Auto-merge](/guide/auto-merge))

## At a glance

```
Task  →  AI implements  →  git push  →  "in review"  →  agent review  →  resolve PR comments  →  accepted  →  merge
```

## Related

- [Concurrency lock](/guide/concurrency) — one run per directory
- [Dev notes mode](/guide/dev-notes) — when clarification is posted
- [Blocked tasks](/guide/blocked-tasks) — dependency handling
- [Agent review](/guide/agent-review) — proactive AI review of the PR diff
- [Code review](/guide/code-review) — reactive resolution of human PR review threads
- [Auto-merge](/guide/auto-merge) — merge accepted PRs

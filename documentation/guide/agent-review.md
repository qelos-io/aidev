# Agent review

When a task is in your configured **in review** status and tagged with `agent review` (the default — override via `AGENT_REVIEW_TAG`), aidev fetches the pull request diff via the GitHub CLI, runs an AI code review, and posts the results on the PR. This is a **proactive** review of the diff — it does not wait for human reviewers to leave comments.

For **reactive** handling of existing human review threads, see [Code review resolution](/guide/code-review).

```bash
# In .env.aidev (both optional)
# AGENT_REVIEW_TAG=agent review
# AUTO_REVIEW=false
```

## Prerequisites

- The [GitHub CLI](https://cli.github.com/) must be installed and authenticated (`gh auth login`)
- `GITHUB_REPO` must be set to `owner/repo` in `.env.aidev` so aidev can resolve the repository and PR links

Agent review uses `gh` to fetch the PR diff and post the review. No local checkout of the PR branch is required.

::: info Provider support
Tagging requires a provider that supports `addTag` / `removeTag`. If your provider does not implement these, apply the tag manually in your task manager.
:::

## How it works

1. At the end of every `aidev run`, finds all tasks in your "in review" status that have the agent review tag
2. For each task, resolves the open PR by branch name (`<taskId>/<slugified-title>`) via `gh`
3. Fetches the PR diff with `gh pr diff`
4. Posts a start comment on the task — remove the agent review tag before the next run if you want to skip this review
5. Runs your configured AI agent(s) with the diff and task context
6. Parses the agent output as a JSON array of inline review comments
7. Posts a GitHub pull request review — inline comments when issues are found, or an approving review when the array is empty
8. Removes the agent review tag on success and posts a completion comment on the task

If the AI runners fail, output cannot be parsed, or `gh` returns an error, the tag is left in place so you can retry on the next run.

## Triggering a review

### Manually

Add the agent review tag to a task that is already in **in review** status and has an open pull request. On the next `aidev run`, aidev processes it.

```bash
aidev run
```

### Automatically (`AUTO_REVIEW`)

When `AUTO_REVIEW=true`, aidev applies `AGENT_REVIEW_TAG` as soon as an **open** task is picked up for implementation. The tag stays on the task through implementation; once the task moves to in review and `aidev run` executes again, the automated review runs.

```bash
# In .env.aidev
AUTO_REVIEW=true
```

## Custom review prompt

Place a skill file at `.agents/skills/aidev-review/SKILL.md` in your project root. When present, its contents replace the default review instructions. aidev still appends the task description, PR link, diff, and JSON output contract after your skill text.

Use this to steer the reviewer toward project-specific conventions, security policies, or areas of focus.

## JSON output contract

The AI agent must respond with a JSON array. Each item is an inline review comment:

| Field | Type | Description |
|---|---|---|
| `path` | string | File path as it appears in the PR diff |
| `line` | number | Line number on the **new** file (right side of the diff) |
| `body` | string | Review comment explaining the issue and suggested fix |

Example:

```json
[
  {
    "path": "src/auth.ts",
    "line": 42,
    "body": "Missing null check — `user` can be undefined when the session expires."
  }
]
```

An empty array `[]` means the review completed with no issues. aidev posts an **approving** GitHub review with a summary comment instead of inline comments.

## After the review

On success, aidev removes the agent review tag so the same task is not reviewed again on every run.

To merge the PR, tag the task with `accepted` (see [Auto-merge](/guide/auto-merge)). The typical flow is:

1. Task reaches **in review** (implementation complete, PR open)
2. Agent review runs (proactive diff review)
3. Human reviewers leave comments if needed; [code review resolution](/guide/code-review) addresses unresolved threads on subsequent runs
4. When satisfied, tag the task `accepted` to squash-merge the PR

Agent review and auto-merge are independent features — agent review does not apply the `accepted` tag or merge the PR.

## Related

- [Code review resolution](/guide/code-review) — reactive fixes for unresolved human PR review threads
- [Auto-merge](/guide/auto-merge) — merge PRs for tasks tagged `accepted`
- [Behaviour configuration](/guide/configuration/behaviour) — `AGENT_REVIEW_TAG` and `AUTO_REVIEW`

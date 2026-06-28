# Auto-merge accepted PRs

When a task has been reviewed and is ready to merge, tag it with `accepted` (the default — override via `ACCEPTED_TAG`). On the next run, aidev will automatically merge the PR via the GitHub CLI (`gh`), update the task status, and sync your local main branch.

```bash
# In .env.aidev (both optional)
# ACCEPTED_TAG=accepted
# DONE_STATUS=done
```

## How it works

1. Finds all tasks in your "in review" status that have the accepted tag
2. For each task: merges the PR with squash and deletes the remote branch (`gh pr merge --squash --delete-branch`)
3. Updates the task status to `DONE_STATUS` (auto-detected when omitted)
4. Checks out the base branch and pulls the latest changes

## Run manually

```bash
aidev run accepted
```

Whenever `gh` is available, accepted PRs are also auto-merged at the end of every `aidev run`.

::: info Prerequisites
The [GitHub CLI](https://cli.github.com/) must be installed and authenticated (`gh auth login`).
:::

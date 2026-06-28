# Code review resolution

When `aidev run` executes, it also checks tasks in **review** status for unresolved PR code review comments. If any actionable threads are found, an AI agent is run to address them — either by fixing the code or replying to discussion comments.

## How it works

1. Fetches all tasks in your configured "in review" status
2. For each task, finds the associated PR by branch name (via `gh` CLI)
3. Fetches unresolved review threads from the PR
4. Filters out threads where the last comment is from aidev itself
5. Runs an AI agent to address the remaining threads — code fixes are committed and pushed, discussion replies are posted directly on the thread
6. Resolved threads are marked as resolved on GitHub

This runs automatically as part of every `aidev run` (after processing open/pending tasks). No additional configuration is needed beyond having `gh` CLI installed and authenticated.

::: info Prerequisites
The [GitHub CLI](https://cli.github.com/) must be installed and authenticated (`gh auth login`). If `gh` is not available, review task processing is silently skipped.
:::

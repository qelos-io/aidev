# Git & GitHub configuration

| Variable | Default | Description |
|---|---|---|
| `GIT_REMOTE` | auto-detected | Remote name — detected via `git remote get-url origin` if unset |
| `GITHUB_BASE_BRANCH` | `main` | Base branch; new task branches are cut from here |
| `GITHUB_REPO` | — | `owner/repo` — used to generate PR links in comments |
| `AIDEV_WORKTREE` | `false` | Run each task branch in its own [git worktree](/guide/worktrees) under `.aidev/worktrees/` |
| `WORKTREE_TAG` | `worktree` | Task tag that enables worktree mode for that task only |

[← Back to configuration overview](/guide/configuration)

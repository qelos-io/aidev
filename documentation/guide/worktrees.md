# Git worktrees

By default aidev checks out each task branch in your main working tree. With **worktree mode** enabled, the task branch is instead created with `git worktree add` under the git-ignored `.aidev/worktrees/<branch>` folder (`/` in the branch name is sanitized to keep it a single folder).

The AI agent, commits, pushes, conflict handling and diff capture all run inside that folder. Your main checkout is left untouched, so it may be dirty while aidev works. `.aidev` bookkeeping (lock file, active-task file, assets, logs) stays in the main repo directory.

Worktree mode is **opt-in** and off by default.

```bash
# In .env.aidev (both optional)
# AIDEV_WORKTREE=false
# WORKTREE_TAG=worktree
```

## Enabling worktrees

There are three ways to turn it on. Precedence is **CLI flag > task tag > env var**.

| Method | Description |
|---|---|
| `aidev run --worktree` / `--no-worktree` | Force worktrees on or off for this run, overriding everything else |
| Task tag | A task carrying the tag `WORKTREE_TAG` (default `worktree`, matched case-insensitively) uses a worktree for that task only |
| `AIDEV_WORKTREE=true` (or `1`) in `.env.aidev` | Use worktrees for every code task |

## Configuration

| Variable | Default | Description |
|---|---|---|
| `AIDEV_WORKTREE` | `false` | Run each task branch in a git worktree |
| `WORKTREE_TAG` | `worktree` | Task tag that turns worktree mode on for that task |

## Cleanup

**When a task ends.** On success, failure or abort, the task's worktree is removed and the branch is kept. If the worktree still holds uncommitted changes, it is left in place so the work is not lost.

**Reuse.** If a worktree already exists for the branch (for example when continuing a task after a reply), it is reused. A stale directory left behind by a crash is pruned and recreated.

**Weekly cleanup.** The [weekly cleanup](/guide/commands#aidev-clean) (also available as `aidev clean`) removes stale worktrees under `.aidev/worktrees`: those whose branch was deleted or merged, whose task is no longer active, or that show no activity for more than 7 days. The worktree of the currently active task is never removed. It then runs `git worktree prune` and deletes leftover directories git no longer knows about. The number removed is included in the cleanup log.

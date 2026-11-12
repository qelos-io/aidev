# Commands

## Core commands

| Command | Description |
|---|---|
| `aidev init` | Interactive setup — creates `.env.aidev` |
| `aidev run` | Process open + pending tasks, resolve unresolved PR review comments, run agent review on tagged in-review tasks, then auto-merge accepted PRs |
| `aidev run open` | Only open (non-pending) tasks |
| `aidev run pending` | Only pending tasks — check for human replies |
| `aidev run accepted` | Auto-merge PRs for tasks in review with the accepted tag |
| `aidev run tasks` | Publish all entries in `aidev.tasks.json` and exit (no AI run) |
| `aidev tasks add` | Add a new entry to `aidev.tasks.json` (interactive) |
| `aidev tasks ls` | List entries currently queued in `aidev.tasks.json` |
| `aidev tasks update [id]` | Edit a queued entry (interactive if `id` omitted) |
| `aidev tasks remove [id]` | Delete a queued entry (interactive if `id` omitted) |
| `aidev tasks push` | Same as `aidev run tasks` — publish all queued entries and exit |
| `aidev clean` | Remove stale local branches and clear git stashes, after confirmation (see [below](#aidev-clean)) |
| `aidev clean --dry-run` | Show what would be removed without changing anything |
| `aidev clean -y` | Clean without the confirmation prompt (`--yes`) |
| `aidev stop` | Stop any running aidev process in the current directory |
| `aidev ui` | Launch the local web dashboard (see [UI dashboard](/guide/ui-dashboard)) |
| `aidev schedule set` | Interactive cron picker for this directory |
| `aidev schedule set "<expr>"` | Set a specific cron expression |
| `aidev schedule set "<expr>" -e <path>` | Set a schedule that uses a custom env file when it fires |
| `aidev schedule get` | Show the current schedule for this directory |
| `aidev help` | Show command and config reference |

## `aidev clean`

Local housekeeping for the repo `aidev` works in. It tidies up branches left behind by finished or abandoned tasks.

When run, it:

1. Fetches the base branch (`GITHUB_BASE_BRANCH`) from the remote and checks it out, updating it to match the remote.
2. Force-deletes every **local** branch that does not belong to an active task. Branches follow the `<taskId>/<task-name>` convention, so a branch is kept if its leading `<taskId>` matches a task that is still active (open, pending, in progress or in review). The base branch and protected branches are never deleted.
3. Clears all git stashes.

Remote branches are never touched. If the active task list can't be fetched from the provider, `aidev clean` aborts without deleting anything.

Before changing anything it prints the plan (including the branches to be deleted) and asks `Proceed? [y/N]`.

| Option | Description |
|---|---|
| `--dry-run` | Only print what would be done; change nothing |
| `-y, --yes` | Skip the confirmation prompt |

::: tip Automatic weekly cleanup
The same cleanup also runs automatically, without a prompt, at most once a week: on the first `aidev run` that happens on a Monday. The last run time is stored in the gitignored `.aidev/last-cleanup.log`.
:::

## Global flags

| Flag | Description |
|---|---|
| `-e, --env <path>` | Load config from a custom env file instead of `.env.aidev` |
| `-V, --version` | Print version |

## Examples

```bash
# Use a shared env file for a staging environment
aidev --env /shared/.env.staging run

# Only process tasks that are waiting for a reply
aidev run pending

# Preview what a cleanup would remove
aidev clean --dry-run

# Schedule to run every 30 minutes
aidev schedule set "*/30 * * * *"
```

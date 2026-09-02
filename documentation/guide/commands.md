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
| `aidev stop` | Stop any running aidev process in the current directory |
| `aidev ui` | Launch the local web dashboard (see [UI dashboard](/guide/ui-dashboard)) |
| `aidev schedule set` | Interactive cron picker for this directory |
| `aidev schedule set "<expr>"` | Set a specific cron expression |
| `aidev schedule set "<expr>" -e <path>` | Set a schedule that uses a custom env file when it fires |
| `aidev schedule get` | Show the current schedule for this directory |
| `aidev help` | Show command and config reference |

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

# Schedule to run every 30 minutes
aidev schedule set "*/30 * * * *"
```

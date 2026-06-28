# Logging

Every run appends to `aidev.log` in your project directory:

```
────────────────────────────────────────────────────────────
2026-03-06T08:00:00.000Z [run] started
────────────────────────────────────────────────────────────
2026-03-06T08:00:00.120Z [info] Fetching tasks (filter: all)...
2026-03-06T08:00:01.340Z [task] [abc123] "Fix login flow" (status: open)
2026-03-06T08:00:12.780Z [info] Running claude...
2026-03-06T08:00:45.210Z [success] Task implemented: branch abc123/fix-login-flow pushed
2026-03-06T08:00:45.890Z [success] Done. Processed: 1, Skipped: 3
```

ANSI colour codes are stripped so the file stays readable. `aidev.log` is added to `.gitignore` automatically by `aidev init`.

## Custom log path

Set `AIDEV_LOG_PATH` to an absolute, relative, or `~/`-prefixed path that includes the **file name**:

```bash
AIDEV_LOG_PATH=logs/aidev.log
AIDEV_LOG_PATH=/var/log/aidev.log
AIDEV_LOG_PATH=~/aidev/run.log
```

## Log pruning

At the start of every run, aidev removes log lines older than **14 days**. Change the retention window with `AIDEV_LOG_TTL_DAYS`:

```bash
AIDEV_LOG_TTL_DAYS=7
AIDEV_LOG_TTL_DAYS=30
AIDEV_LOG_TTL_DAYS=0     # disable pruning
```

# Trigger word & re-processing

aidev prefixes every comment it posts with `[aidev]` (configurable via `AIDEV_COMMENT_PREFIX`). This lets it distinguish its own comments from human replies.

A task is normally skipped when:

- A remote branch already exists for it, **or**
- It is `pending` and no human has replied yet

To force aidev to pick the task up again, post a comment containing the **trigger word** (default: `aidev-continue`). aidev will reuse the existing branch and continue implementation.

```bash
AIDEV_TRIGGER_WORD=please-retry
```

The trigger word match is case-insensitive.

For pending tasks, a regular human reply (any comment without the configured prefix) also triggers re-processing.

```bash
AIDEV_COMMENT_PREFIX=[mybot]
```

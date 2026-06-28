# Auto-compress

For long-running tasks with many comments, the combined prompt can grow past the AI agent's effective context window. When the assembled context exceeds `AIDEV_COMPRESS_THRESHOLD` characters (default `12000`), aidev summarises older comments via the configured AI agent and keeps only the **latest comment verbatim**.

Compressed summaries are cached under `.aidev/sessions/<taskId>.json` and reused across runs.

This is **on by default**. To opt out:

```bash
AIDEV_AUTO_COMPRESS=false
AIDEV_COMPRESS_THRESHOLD=24000
```

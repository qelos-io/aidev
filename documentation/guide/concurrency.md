# Concurrency lock

`aidev run` writes a PID lock file (`.aidev.lock`) in the current directory when it starts and removes it when it finishes. If a second invocation detects a live process already holding the lock, it logs a warning and exits immediately — preventing two agents from committing to the same branch at the same time.

```
$ aidev run
[aidev] aidev is already running in this directory (PID 12345). Use "aidev stop" to terminate it.
```

Use `aidev stop` to send `SIGTERM` to the running process and clean up the lock file:

```bash
aidev stop
```

Stale lock files (left behind by a crash) are detected automatically — the next `aidev run` will overwrite them if the stored PID is no longer alive.

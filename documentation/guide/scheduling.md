# Scheduling

aidev can run on a cron schedule, one entry per project directory.

```bash
aidev schedule set
aidev schedule set "*/15 * * * *"
aidev schedule set "*/15 * * * *" -e /path/to/custom/.env.aidev
aidev schedule get
```

The `-e <path>` option is baked into the scheduled entry itself, so each run picks up the right env file without relying on the shell environment at firing time.

## Preset options (interactive picker)

| Option | Expression |
|---|---|
| Every 15 minutes | `*/15 * * * *` |
| Every 30 minutes | `*/30 * * * *` |
| Every hour | `0 * * * *` |
| Every 5 hours | `0 */5 * * *` |
| Every day at 8am | `0 8 * * *` |

Each directory gets its own cron entry identified by a `# aidev-cwd:/path` marker — running `schedule set` again replaces the existing entry.

## macOS: Full Disk Access required

On macOS (Ventura and later), cron jobs are silently blocked unless `/usr/sbin/cron` has Full Disk Access:

1. Open **System Settings → Privacy & Security → Full Disk Access**
2. Click **+** and add `/usr/sbin/cron`
3. Re-run `aidev schedule set`

Without this, cron will appear configured but jobs will never fire.

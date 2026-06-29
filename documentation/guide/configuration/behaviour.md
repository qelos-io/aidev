# Behaviour configuration

| Variable | Default | Description |
|---|---|---|
| `AIDEV_ENV_EXTEND` | — | Path to a global env file loaded as the base for this project |
| `AGENTS` | `claude,cursor` | Comma-separated list of agents in priority order |
| `DEV_NOTES_MODE` | `smart` | When to ask for clarification (`smart` or `always`) |
| `AIDEV_TRIGGER_WORD` | `aidev-continue` | Comment containing this word re-triggers a skipped task |
| `AIDEV_COMMENT_PREFIX` | `[aidev]` | Custom prefix for all aidev comments posted to task providers |
| `AIDEV_HOOKS_PATH` | — | Path to a `.ts` or `.js` module that exports hook functions (see [Hooks](/guide/hooks)) |
| `ACCEPTED_TAG` | `accepted` | Tasks in review with this tag are auto-merged (see [Auto-merge](/guide/auto-merge)) |
| `DONE_STATUS` | auto-detected | Status to set after auto-merging an accepted PR |
| `PR_SIGNATURE` | `Automated PR by aidev.` | Custom signature line appended to the PR body |
| `AIDEV_SAFE_MODE` | `true` | Redact secret env values from AI prompts |
| `AIDEV_AUTO_COMPRESS` | `true` | Auto-compress older comments when the prompt grows large |
| `AIDEV_COMPRESS_THRESHOLD` | `12000` | Char-length threshold that triggers compression |

[← Back to configuration overview](/guide/configuration)

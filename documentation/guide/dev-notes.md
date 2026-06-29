# Dev notes mode

Controls when aidev asks the task provider for clarification before implementing.

| Mode | Behaviour |
|---|---|
| `smart` | Asks the AI whether the task description is clear enough. Only posts a clarification question if it's ambiguous. |
| `always` | Always posts "any dev notes?" before implementing every task. |

When a question is posted, the task is moved to the configured pending status (e.g. `CLICKUP_PENDING_STATUS`, `JIRA_PENDING_STATUS`, etc.). On the next run, aidev checks whether a human has replied and, if so, includes the reply as context for the AI.

Configure via `DEV_NOTES_MODE` in `.env.aidev`.

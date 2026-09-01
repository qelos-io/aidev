# Behaviour configuration

| Variable | Default | Description |
|---|---|---|
| `AIDEV_ENV_EXTEND` | — | Path to a global env file loaded as the base for this project |
| `AGENTS` | `claude,cursor` | Comma-separated list of agents in priority order |
| `DEV_NOTES_MODE` | `smart` | When to ask for clarification (`smart` or `always`) |
| `AIDEV_TRIGGER_WORD` | `aidev-continue` | Comment containing this word re-triggers a skipped task |
| `AIDEV_COMMENT_PREFIX` | `[aidev-$PROJECT_NAME]` | Prefix for aidev comments; `$PROJECT_NAME` expands to the project folder name |
| `CONSULT_TAG` | `{folder}-consult` | Tag/label this agent watches for consult requests |
| `CONSULTED_TAG` | `{folder}-consulted` | Stats marker applied after consult completes |
| `AIDEV_HOOKS_PATH` | — | Path to a `.ts` or `.js` module that exports hook functions (see [Hooks](/guide/hooks)) |
| `ACCEPTED_TAG` | `accepted` | Tasks in review with this tag are auto-merged (see [Auto-merge](/guide/auto-merge)) |
| `AUTO_APPROVE` | `false` | When `true`, apply `ACCEPTED_TAG` as soon as an open task is picked up |
| `AGENT_REVIEW_TAG` | `agent review` | Tasks in review with this tag get an automated PR code review |
| `AUTO_REVIEW` | `false` | When `true`, apply `AGENT_REVIEW_TAG` as soon as an open task is picked up |
| `DONE_STATUS` | auto-detected | Status to set after auto-merging an accepted PR |
| `PR_SIGNATURE` | `Automated PR by aidev.` | Custom signature line appended to the PR body |
| `AIDEV_SAFE_MODE` | `true` | Redact secret env values from AI prompts (see [Safe mode](#safe-mode) below) |
| `AIDEV_AUTO_COMPRESS` | `true` | Auto-compress older comments when the prompt grows large |
| `AIDEV_COMPRESS_THRESHOLD` | `12000` | Char-length threshold that triggers compression |
| `MCP_JSON_PATH` | auto-discovered | Path to a generic `mcp.json` injected into every agent — see [MCP servers](/guide/mcp) |
| `BETTER_MCP` | `false` | Route all MCP traffic through the better-mcp Docker proxy (requires `docker`) |
| `BETTER_MCP_CONFIG_PATH` | `.aidev/better-mcp.json` | User-authored better-mcp base config; `mcpServers` is injected, `middleware` is preserved |

## Safe mode

When `AIDEV_SAFE_MODE` is enabled (default), aidev scans task prompts for values that match keys in `.env` / `.env.aidev`. Matches are replaced with placeholders and the original values are written to:

```
.aidev/assets/secrets/task-<task-id>.secrets
```

That file lives under the git-ignored [`.aidev/assets/`](/guide/agents#task-assets-aidevassets) tree alongside downloaded ticket attachments (`.aidev/assets/<task-id>/`).

### How agents access redacted secrets

Secret files are **not** meant to be read into model context. During a run, aidev appends prompt instructions that tell agents to use shell workflows (`grep`, `ls`, piping into commands) instead of opening `*.secrets` files directly.

Attachment files under `.aidev/assets/<task-id>/` follow different rules: agents may read them and copy them into the project (e.g. images into `public/`). See [Task assets](/guide/agents#task-assets-aidevassets) for Cursor `--add-dir`, `.cursorignore` negation, and the prompt fallback used by other agents.

[← Back to configuration overview](/guide/configuration)

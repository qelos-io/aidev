# MCP servers

aidev can hand every configured AI agent a shared set of [MCP](https://modelcontextprotocol.io) servers — filesystem access, GitHub, a database, whatever your workflow needs — from a **single generic config file**. Each agent has its own convention for where MCP config lives and what shape it's in; aidev translates your one file into all of them automatically before each run.

## The generic `mcp.json`

Use the same shape Claude Desktop and Cursor already use:

```json
{
  "mcpServers": {
    "fs": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "."]
    },
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": { "GITHUB_PERSONAL_ACCESS_TOKEN": "ghp_..." }
    }
  }
}
```

A server can also be remote (`{ "url": "https://mcp.example.com" }` instead of `command`/`args`).

### Discovery

| Source | When |
|---|---|
| `MCP_JSON_PATH` | Always wins when set. Absolute, `~/`-relative, or relative to the project. |
| `.agents/mcp.json` | Auto-discovered when `MCP_JSON_PATH` is unset. |
| `.aidev/mcp.json` | Auto-discovered when neither of the above exists. |

If none apply, the feature is off — no files are written, no agent flags change.

## Per-agent translation

| Agent | Target | Mechanism |
|---|---|---|
| `claude` | `.aidev/mcp/claude.json` | `claude --mcp-config <path> --strict-mcp-config` |
| `anthropic-sdk` | *(in-process)* | `mcpServers` + `strictMcpConfig: true` passed to the SDK's `query()` |
| `cursor` | `.cursor/mcp.json` | Plus `--approve-mcps` on the `agent` CLI (headless runs otherwise reject MCP calls) |
| `antigravity` | `.agents/mcp_config.json` | Convention path (note the underscore) |
| `devin` | `.devin/config.json` | `{"mcpServers": {...}, "permissions": {...}}` — existing `permissions` are preserved |
| `opencode` | `opencode.json` | Renamed to `mcp`, `command`+`args` collapsed into one array, `local`/`remote` inferred |
| `codex` | `.codex/config.toml` | `[mcp_servers.<name>]` tables (project-scoped `.codex/config.toml` requires the directory to be [trusted](https://developers.openai.com/codex)) |
| `aider` | — | No MCP support. aidev logs this and moves on. |

aidev only writes files for agents actually listed in your `AGENTS` config — it won't create a `.codex/config.toml` in a project that never runs codex.

### Existing convention files

If a target file already exists with content aidev didn't write itself, aidev backs it up once as `<file>.aidev-backup` before overwriting it (also gitignored), and logs a warning. `opencode.json` and `.devin/config.json` are *merged* — every unrelated top-level key (like `opencode.json`'s `$schema`, or `.devin/config.json`'s `permissions`) survives; only the MCP block is replaced.

## Gitignore

Every file aidev generates or manages for MCP is added to `.gitignore` automatically — on `aidev init` (when `MCP_JSON_PATH` is configured) and again on every `aidev run` (so enabling the feature later still gets covered). Managed patterns: `.aidev/mcp/`, `.aidev/better-mcp.json`, `.cursor/mcp.json`, `.agents/mcp_config.json`, `.devin/config.json`, `.codex/config.toml`, `opencode.json`, `*.aidev-backup`.

## better-mcp mode

Set `BETTER_MCP=true` to route every agent through [better-mcp](https://github.com/qelos-io/better-mcp) — a single proxy that namespaces tool names, and can log, redact, and offload responses — instead of connecting each agent directly to every server.

Requires `docker` on PATH. Pull the image once:

```bash
docker pull ghcr.io/qelos/better-mcp:latest
```

When enabled, aidev:

1. Reads `BETTER_MCP_CONFIG_PATH` (default `.aidev/better-mcp.json`) if it exists, keeping any `middleware` block you've hand-tuned there (logging, redaction, response offloading — see the [better-mcp config reference](https://github.com/qelos-io/better-mcp#config)).
2. Injects your `mcp.json` servers into it and forces `namespace: true`, then writes it back.
3. Replaces what every agent sees with a **single** server:

```json
{
  "mcpServers": {
    "better-mcp": {
      "command": "docker",
      "args": ["run", "--rm", "-i", "-v", "/abs/path/.aidev/better-mcp.json:/app/mcp.json:ro", "ghcr.io/qelos/better-mcp:latest"]
    }
  }
}
```

If `docker` isn't found, aidev logs a warning and falls back to injecting your raw servers directly — a missing proxy never blocks a run.

### Servers run inside the container

In better-mcp mode, your upstream MCP servers execute **inside the Docker image**, not on the host. Only `node`/`npx` are guaranteed available there — aidev warns (per server) when a command isn't one of those. A server with a relative `command` or a `cwd` pointing at your project won't resolve; a filesystem server aimed at a host path won't see your repo unless you mount it yourself into the container.

## Secrets

Literal values in a server's `env` block land in every materialized file verbatim (that's why they're all gitignored). `AIDEV_SAFE_MODE` redaction only scans `.env`/`.env.aidev` — it does not redact values that live solely in `mcp.json`. Prefer `${VAR}` references where the target agent supports them (Claude, Cursor, Antigravity) so the literal value never touches disk.

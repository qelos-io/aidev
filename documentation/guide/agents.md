# AI agents

aidev supports multiple AI agents with automatic fallback. The first available agent in the list is used; if it fails, the next one is tried with the previous agent's output as additional context.

<AgentGrid />

## Supported agents

| Agent | Requires |
|---|---|
| `aider` | [aider](https://aider.chat) installed with an LLM API key set |
| `antigravity` | Google **Antigravity** CLI (`agy` or `antigravity`) in PATH |
| `anthropic-sdk` | `ANTHROPIC_API_KEY` set; drives Claude in-process via the Anthropic Agent SDK |
| `claude` | [Claude CLI](https://github.com/anthropics/claude-code) installed and authenticated |
| `codex` | [OpenAI Codex CLI](https://github.com/openai/codex) installed and authenticated |
| `cursor` | Cursor **Agent CLI** (`agent`) in PATH |
| `devin` | [Devin CLI](https://docs.devin.ai/cli) installed and authenticated |
| `opencode` | [OpenCode CLI](https://opencode.ai) installed (`npm install -g opencode-ai`) |

## Claude CLI

The `claude` agent shells out to the [Claude CLI](https://github.com/anthropics/claude-code). Install it and authenticate (`claude login` or set credentials via your environment).

aidev runs:

```bash
claude -p "<prompt>" --dangerously-skip-permissions --model <model>
```

If the chosen model is unavailable on your plan, aidev retries with the CLI default and then `--model auto`.

### Environment variables

| Variable | Default | Description |
|---|---|---|
| `CLAUDE_MODEL` | `opusplan` | Model passed to `claude --model`. `opusplan` routes planning to opus and coding to sonnet, saving tokens vs. running opus end-to-end. |

```bash
# .env.aidev
AGENTS=claude,cursor
CLAUDE_MODEL=opusplan
```

## Cursor

The `cursor` agent uses the Cursor **Agent CLI** (`agent` binary) — not the Cursor IDE (`cursor.exe`). aidev passes the prompt on stdin and runs headless with auto-approval flags.

```bash
agent --print --force --trust --workspace <cwd> --model auto
```

### Windows: Cursor Agent CLI

On Windows, the Cursor IDE (`cursor.exe`) is separate from the headless Agent CLI. Install it in PowerShell:

```powershell
irm 'https://cursor.com/install?win32=true' | iex
```

Then ensure `agent` is on your PATH and run `agent --version` to confirm.

### Environment variables

Cursor has no aidev-specific env vars. Authentication and model selection are handled by the `agent` CLI itself.

```bash
AGENTS=cursor
```

## Anthropic SDK

The `anthropic-sdk` agent runs Claude **in-process** via [`@anthropic-ai/claude-agent-sdk`](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk) instead of shelling out to the `claude` CLI. The SDK package must be installed in the project (it ships as a dependency of aidev).

Because the SDK uses the `claude_code` system prompt preset with `cwd` set to the project root, it automatically picks up `.claude/skills`, `.claude/commands`, and `.claude/agents` from the repo.

### Environment variables

| Variable | Default | Description |
|---|---|---|
| `ANTHROPIC_API_KEY` | — | Single key or comma-separated pool; the runner rotates round-robin across `run()` calls and retries |
| `ANTHROPIC_BASE_URL` | — | Optional API base URL override |
| `ANTHROPIC_MODEL` | `claude-opus-4-6` | Model id passed to the SDK |
| `ANTHROPIC_SDK_MAX_RETRIES` | `3` | Retries after transient SDK errors (connection drops, mid-stream failures). Set to `0` to disable. |

```bash
AGENTS=anthropic-sdk
ANTHROPIC_API_KEY=sk-ant-key-1,sk-ant-key-2
ANTHROPIC_MODEL=claude-opus-4-6
ANTHROPIC_SDK_MAX_RETRIES=3
```

`ANTHROPIC_MODEL` is separate from `CLAUDE_MODEL` so the SDK runner and Claude CLI runner can target different models.

## Aider

[aider](https://aider.chat) is an open-source AI pair programming tool that connects to many LLMs. Install it and set an API key for your preferred model:

```bash
pip install aider-install
aider-install
export ANTHROPIC_API_KEY=sk-ant-...
# or
export OPENAI_API_KEY=sk-...
```

aidev runs:

```bash
aider --message "<prompt>" --yes-always <extra-args>
```

Aider inherits `ANTHROPIC_API_KEY` and `OPENAI_API_KEY` from the environment automatically.

### Environment variables

| Variable | Default | Description |
|---|---|---|
| `AIDER_ARGS` | — | Extra CLI flags passed to aider (space-separated) |

```bash
AGENTS=aider,claude
AIDER_ARGS=--model gpt-4o --no-auto-commits
AIDER_ARGS=--model claude-sonnet-4-6 --no-auto-commits
```

## Codex

The `codex` agent uses the [OpenAI Codex CLI](https://github.com/openai/codex) in non-interactive mode.

```bash
npm install -g @openai/codex
codex login   # or set OPENAI_API_KEY
```

aidev runs:

```bash
codex exec --ask-for-approval never --sandbox workspace-write --cd <cwd> "<prompt>"
```

### Environment variables

Codex has no aidev-specific env vars. Set `OPENAI_API_KEY` or authenticate via `codex login`.

```bash
AGENTS=codex
```

## OpenCode

The `opencode` agent uses the [OpenCode CLI](https://opencode.ai) for non-interactive agent runs.

```bash
npm install -g opencode-ai
```

aidev runs:

```bash
opencode run --dangerously-skip-permissions --dir <cwd> [--model <model>] "<prompt>"
```

### Environment variables

| Variable | Default | Description |
|---|---|---|
| `OPENCODE_CONFIG_DIR` | — | Custom config directory for agents, commands, modes, and plugins |
| `OPENCODE_MODEL` | — | Model in `provider/model` format (e.g. `anthropic/claude-sonnet-4-6`) |

```bash
AGENTS=opencode
OPENCODE_CONFIG_DIR=/path/to/my/config-directory
OPENCODE_MODEL=anthropic/claude-sonnet-4-6
```

## Devin

The `devin` agent uses the [Devin CLI](https://docs.devin.ai/cli) in single-turn print mode. Install and authenticate per Devin's docs.

aidev writes the prompt to a temp file (to avoid command-line length limits) and runs:

```bash
devin -p --permission-mode bypass --prompt-file <tmpfile>
```

### Environment variables

Devin has no aidev-specific env vars. Authentication is handled by the `devin` CLI.

```bash
AGENTS=devin
```

## Antigravity

The `antigravity` agent uses Google's [Antigravity](https://antigravity.google/download) CLI (`agy` or `antigravity` on some installs). aidev passes the prompt on stdin and opens the current workspace.

```bash
agy --agent --print .
```

### Environment variables

Antigravity has no aidev-specific env vars.

```bash
AGENTS=antigravity,claude
```

## Task assets (`.aidev/assets/`)

Providers download ticket attachments to `.aidev/assets/<task-id>/`. With **safe mode** enabled (default), secret values redacted from prompts are written to `.aidev/assets/secrets/task-<id>.secrets`. The whole tree is **git-ignored** (via `aidev init`) so attachments and secrets are not committed.

Because git-ignored paths are often out of scope for agents, aidev grants access in two layers:

1. **Cursor Agent CLI** — when task assets exist on disk, aidev passes `--add-dir` for each existing asset directory (`.aidev/assets/` and `.aidev/assets/<task-id>/`) in addition to `--workspace`. `aidev init` also adds `.cursorignore` negation rules (`!.aidev/assets/`, `!.aidev/assets/**`) so Cursor can index the folder without removing the gitignore entry.
2. **Prompt instructions (all agents)** — when attachments exist or the task description references `.aidev/assets/`, aidev appends a short **Aidev task assets** section to the prompt before `runner.run()`. Runners without CLI support (Claude, Aider, Codex, etc.) rely on this fallback.

### Attachments vs secrets

| Path | Agent access |
|---|---|
| `.aidev/assets/<task-id>/…` | Read and copy into the project as needed (e.g. logos → `public/`). |
| `.aidev/assets/secrets/task-<id>.secrets` | Available for **shell workflows only** — use `grep`, `ls`, or pipe values into commands. Do **not** read `*.secrets` files into chat context or use a Read tool on them. |

See [Behaviour configuration — Safe mode](/guide/configuration/behaviour#safe-mode) for `AIDEV_SAFE_MODE` and secrets redaction.

## Configure agent order

```bash
# Claude first, fall back to Cursor
AGENTS=claude,cursor

# Cursor only
AGENTS=cursor

# Aider first, fall back to Claude CLI
AGENTS=aider,claude

# Antigravity first, then Claude
AGENTS=antigravity,claude

# In-process SDK with CLI fallback
AGENTS=anthropic-sdk,claude,cursor
```

See also [Behaviour configuration](/guide/configuration/behaviour) for the `AGENTS` variable reference.

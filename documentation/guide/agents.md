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

## Aider

[aider](https://aider.chat) is an open-source AI pair programming tool that connects to many LLMs. Install it and set an API key for your preferred model:

```bash
pip install aider-install
aider-install
export ANTHROPIC_API_KEY=sk-ant-...
# or
export OPENAI_API_KEY=sk-...
```

Pass extra CLI flags via `AIDER_ARGS` in `.env.aidev`:

```bash
AIDER_ARGS=--model gpt-4o --no-auto-commits
AIDER_ARGS=--model claude-sonnet-4-6 --no-auto-commits
```

## Windows: Cursor Agent CLI

On Windows, the Cursor IDE (`cursor.exe`) is separate from the headless Agent CLI. Install it in PowerShell:

```powershell
irm 'https://cursor.com/install?win32=true' | iex
```

Then ensure `agent` is on your PATH and run `agent --version` to confirm.

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
```

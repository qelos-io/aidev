export interface AgentInfo {
  id: string;
  name: string;
  icon: string;
  requires: string;
  docsUrl?: string;
}

export const agents: AgentInfo[] = [
  {
    id: 'aider',
    name: 'Aider',
    icon: '/icons/aider.svg',
    requires: 'aider CLI + an LLM API key (OpenAI, Anthropic, etc.)',
    docsUrl: 'https://aider.chat',
  },
  {
    id: 'antigravity',
    name: 'Antigravity',
    icon: 'https://cdn.simpleicons.org/google/4285F4',
    requires: 'Google Antigravity CLI (agy or antigravity) in PATH',
    docsUrl: 'https://antigravity.google/download',
  },
  {
    id: 'anthropic-sdk',
    name: 'Anthropic SDK',
    icon: 'https://cdn.simpleicons.org/anthropic/CC9B7A',
    requires: 'ANTHROPIC_API_KEY — runs Claude in-process via the Agent SDK',
    docsUrl: 'https://docs.anthropic.com',
  },
  {
    id: 'claude',
    name: 'Claude',
    icon: 'https://cdn.simpleicons.org/anthropic/CC9B7A',
    requires: 'Claude CLI installed and authenticated',
    docsUrl: 'https://github.com/anthropics/claude-code',
  },
  {
    id: 'codex',
    name: 'Codex',
    icon: '/icons/codex.svg',
    requires: 'OpenAI Codex CLI installed and authenticated',
    docsUrl: 'https://github.com/openai/codex',
  },
  {
    id: 'cursor',
    name: 'Cursor',
    icon: 'https://cdn.simpleicons.org/cursor/000000',
    requires: 'Cursor Agent CLI (agent) in PATH',
    docsUrl: 'https://cursor.com',
  },
  {
    id: 'devin',
    name: 'Devin',
    icon: '/icons/devin.svg',
    requires: 'Devin CLI installed and authenticated',
    docsUrl: 'https://docs.devin.ai/cli',
  },
  {
    id: 'opencode',
    name: 'OpenCode',
    icon: '/icons/opencode.svg',
    requires: 'OpenCode CLI (npm install -g opencode-ai)',
    docsUrl: 'https://opencode.ai',
  },
];

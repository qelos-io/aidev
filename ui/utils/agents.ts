/** Display + install metadata for the AI assistants aidev can drive. */
export interface AgentMeta {
  id: string;
  name: string;
  blurb: string;
  /** 'cli' assistants need a program on this computer; 'api' ones need a key. */
  kind: 'cli' | 'api';
  image?: string;
  icon?: string;
  color?: string;
  install?: { command?: string; url: string };
}

export const AGENT_META: Record<string, AgentMeta> = {
  claude: {
    id: 'claude', name: 'Claude Code', kind: 'cli', blurb: 'Anthropic’s coding assistant',
    icon: 'i-simple-icons-anthropic', color: '#CC9B7A',
    install: { command: 'npm install -g @anthropic-ai/claude-code', url: 'https://github.com/anthropics/claude-code' },
  },
  cursor: {
    id: 'cursor', name: 'Cursor', kind: 'cli', blurb: 'Cursor’s command-line agent',
    icon: 'i-simple-icons-cursor', color: '#111827',
    install: { command: 'curl https://cursor.com/install -fsS | bash', url: 'https://cursor.com' },
  },
  codex: {
    id: 'codex', name: 'OpenAI Codex', kind: 'cli', blurb: 'OpenAI’s coding assistant',
    image: '/agents/codex.webp',
    install: { command: 'npm install -g @openai/codex', url: 'https://github.com/openai/codex' },
  },
  opencode: {
    id: 'opencode', name: 'OpenCode', kind: 'cli', blurb: 'Open-source coding assistant',
    image: '/agents/opencode.png',
    install: { command: 'npm install -g opencode-ai', url: 'https://opencode.ai' },
  },
  devin: {
    id: 'devin', name: 'Devin', kind: 'cli', blurb: 'Cognition’s software engineer',
    image: '/agents/devin.svg',
    install: { url: 'https://docs.devin.ai/cli' },
  },
  antigravity: {
    id: 'antigravity', name: 'Antigravity', kind: 'cli', blurb: 'Google’s coding assistant',
    icon: 'i-simple-icons-google', color: '#4285F4',
    install: { url: 'https://antigravity.google/download' },
  },
  'anthropic-sdk': {
    id: 'anthropic-sdk', name: 'Anthropic API', kind: 'api', blurb: 'Claude through an API key, no program needed',
    icon: 'i-simple-icons-anthropic', color: '#CC9B7A',
    install: { url: 'https://console.anthropic.com/settings/keys' },
  },
};

export const AGENT_IDS = ['antigravity', 'anthropic-sdk', 'claude', 'codex', 'cursor', 'devin', 'opencode'] as const;

export function agentMeta(id: string): AgentMeta {
  return AGENT_META[id] ?? { id, name: id, kind: 'cli', blurb: '', icon: 'i-lucide-bot' };
}

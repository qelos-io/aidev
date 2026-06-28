import { Config } from '../types';
import { AIRunner } from './base';
import { AiderRunner } from './aider';
import { AntigravityRunner } from './antigravity';
import { AnthropicSdkRunner } from './anthropicSdk';
import { ClaudeRunner } from './claude';
import { CodexRunner } from './codex';
import { CursorRunner } from './cursor';
import { DevinRunner } from './devin';
import { OpencodeRunner } from './opencode';
import { logger } from '../logger';

const registry: Record<string, AIRunner> = {
  aider: new AiderRunner(),
  antigravity: new AntigravityRunner(),
  'anthropic-sdk': new AnthropicSdkRunner(),
  claude: new ClaudeRunner(),
  codex: new CodexRunner(),
  cursor: new CursorRunner(),
  devin: new DevinRunner(),
  opencode: new OpencodeRunner(),
};

export function createRunners(config: Config): AIRunner[] {
  const runners = config.agents.map((name) => registry[name]);
  const available = runners.filter((r) => r.isAvailable()).map((r) => r.name);
  const unavailable = runners.filter((r) => !r.isAvailable()).map((r) => r.name);

  logger.info(`Configured runners (in order): ${runners.map((r) => r.name).join(', ')}`);
  if (unavailable.length > 0) {
    logger.warn(`Runners not found on this system: ${unavailable.join(', ')} — they will be skipped`);
  }
  if (available.length === 0) {
    logger.error('No configured runners are available on this system');
  }

  return runners;
}

export { AIRunner };

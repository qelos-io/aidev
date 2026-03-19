import { Config } from '../types';
import { AIRunner } from './base';
import { AntigravityRunner } from './antigravity';
import { ClaudeRunner } from './claude';
import { CursorRunner } from './cursor';
import { WindsurfRunner } from './windsurf';
import { logger } from '../logger';

const registry: Record<string, AIRunner> = {
  antigravity: new AntigravityRunner(),
  claude: new ClaudeRunner(),
  cursor: new CursorRunner(),
  windsurf: new WindsurfRunner(),
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

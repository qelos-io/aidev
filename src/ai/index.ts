import { Config } from '../types';
import { AIRunner } from './base';
import { ClaudeRunner } from './claude';
import { CursorRunner } from './cursor';

const registry: Record<string, AIRunner> = {
  claude: new ClaudeRunner(),
  cursor: new CursorRunner(),
};

export function createRunners(config: Config): AIRunner[] {
  return config.agents.map((name) => registry[name]);
}

export { AIRunner };

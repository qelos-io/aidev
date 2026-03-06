import { Config } from '../types';
import { AIRunner } from './base';
import { ClaudeRunner } from './claude';
import { CursorRunner } from './cursor';
import { WindsurfRunner } from './windsurf';

const registry: Record<string, AIRunner> = {
  claude: new ClaudeRunner(),
  cursor: new CursorRunner(),
  windsurf: new WindsurfRunner(),
};

export function createRunners(config: Config): AIRunner[] {
  return config.agents.map((name) => registry[name]);
}

export { AIRunner };

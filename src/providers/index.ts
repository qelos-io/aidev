import { Config } from '../types';
import { TaskProvider } from './base';
import { ClickUpProvider } from './clickup';
import { JiraProvider } from './jira';

export function createProvider(config: Config): TaskProvider {
  switch (config.provider.toLowerCase()) {
    case 'clickup':
      return new ClickUpProvider(config);
    case 'jira':
      return new JiraProvider(config);
    case 'notion':
      throw new Error('Notion provider is not yet implemented. Contributions welcome!');
    case 'trello':
      throw new Error('Trello provider is not yet implemented. Contributions welcome!');
    default:
      throw new Error(`Unknown provider: ${config.provider}`);
  }
}

export { TaskProvider };

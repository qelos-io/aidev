import { Config } from '../types';
import { TaskProvider } from './base';
import { ClickUpProvider } from './clickup';
import { JiraProvider } from './jira';
import { LinearProvider } from './linear';
import { LocalProvider, TaskMode } from './local';
import { MondayProvider } from './monday';
import { NotionProvider } from './notion';

export function createProvider(config: Config, mode?: TaskMode): TaskProvider {
  switch (config.provider.toLowerCase()) {
    case 'clickup':
      return new ClickUpProvider(config);
    case 'jira':
      return new JiraProvider(config);
    case 'linear':
      return new LinearProvider(config);
    case 'local':
      return new LocalProvider(process.cwd(), mode || 'code');
    case 'monday':
      return new MondayProvider(config);
    case 'notion':
      return new NotionProvider(config);
    case 'trello':
      throw new Error('Trello provider is not yet implemented. Contributions welcome!');
    default:
      throw new Error(`Unknown provider: ${config.provider}`);
  }
}

export { TaskProvider };

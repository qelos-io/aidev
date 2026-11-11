import { Config } from '../types';
import { TaskProvider } from './base';
import { ClickUpProvider } from './clickup';
import { JiraProvider } from './jira';
import { LinearProvider } from './linear';
import { LocalProvider, TaskMode } from './local';
import { MondayProvider } from './monday';
import { NotionProvider } from './notion';
import { TrelloProvider } from './trello';

/**
 * `baseDir` is where the `local` provider keeps its `.aidev/tasks` folders. It
 * defaults to the process working directory, which is right for the CLI. The
 * dashboard server runs from its own package folder, so it passes the project
 * directory explicitly.
 */
export function createProvider(config: Config, mode?: TaskMode, baseDir: string = process.cwd()): TaskProvider {
  switch (config.provider.toLowerCase()) {
    case 'clickup':
      return new ClickUpProvider(config);
    case 'jira':
      return new JiraProvider(config);
    case 'linear':
      return new LinearProvider(config);
    case 'local': {
      const resolvedMode = mode || 'code';
      const tagFilter =
        resolvedMode === 'consult'
          ? config.consultTag
          : resolvedMode === 'non-code'
            ? config.nonCodeTag
            : config.clickupTag;
      return new LocalProvider(baseDir, resolvedMode, tagFilter);
    }
    case 'monday':
      return new MondayProvider(config);
    case 'notion':
      return new NotionProvider(config);
    case 'trello':
      return new TrelloProvider(config);
    default:
      throw new Error(`Unknown provider: ${config.provider}`);
  }
}

export { TaskProvider };

import { Config } from './types';

export function getPendingStatus(config: Config): string {
  const p = (config.provider || 'clickup').toLowerCase();
  if (p === 'jira') return config.jiraPendingStatus;
  if (p === 'linear') return config.linearPendingStatus;
  if (p === 'notion') return config.notionPendingStatus;
  if (p === 'trello') return config.trelloPendingStatus;
  return config.clickupPendingStatus;
}

export function getOpenStatus(config: Config): string {
  const p = (config.provider || 'clickup').toLowerCase();
  if (p === 'jira') return 'open';
  if (p === 'linear') return 'open';
  if (p === 'trello') return config.trelloOpenStatus || 'open';
  return config.clickupOpenStatus || 'open';
}

/** Semantic status written when aidev starts implementing a task. */
export function getInProgressStatus(_config: Config): string {
  return 'in progress';
}

export function isActiveImplementationStatus(status: string, config: Config): boolean {
  const normalized = status.toLowerCase();
  return normalized === getOpenStatus(config).toLowerCase()
    || normalized === getPendingStatus(config).toLowerCase()
    || normalized === getInProgressStatus(config).toLowerCase();
}

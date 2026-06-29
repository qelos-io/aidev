export interface ProviderInfo {
  id: string;
  name: string;
  status: 'implemented';
  initSupport: boolean | 'manual';
  icon: string;
  description: string;
  blocking: 'native' | 'optional' | 'none';
}

export const providers: ProviderInfo[] = [
  {
    id: 'clickup',
    name: 'ClickUp',
    status: 'implemented',
    initSupport: true,
    icon: 'https://cdn.simpleicons.org/clickup/7B68EE',
    description: 'Poll tasks by tag from your ClickUp workspace.',
    blocking: 'native',
  },
  {
    id: 'jira',
    name: 'Jira',
    status: 'implemented',
    initSupport: true,
    icon: 'https://cdn.simpleicons.org/jira/0052CC',
    description: 'Sync issues by label from Atlassian Jira.',
    blocking: 'native',
  },
  {
    id: 'linear',
    name: 'Linear',
    status: 'implemented',
    initSupport: true,
    icon: 'https://cdn.simpleicons.org/linear/5E6AD2',
    description: 'Pick up labeled issues from Linear teams.',
    blocking: 'native',
  },
  {
    id: 'monday',
    name: 'Monday.com',
    status: 'implemented',
    initSupport: true,
    icon: '/icons/monday.svg',
    description: 'Work items from a Monday.com board.',
    blocking: 'native',
  },
  {
    id: 'notion',
    name: 'Notion',
    status: 'implemented',
    initSupport: 'manual',
    icon: 'https://cdn.simpleicons.org/notion/000000',
    description: 'Database-backed tasks via a Notion integration.',
    blocking: 'optional',
  },
  {
    id: 'trello',
    name: 'Trello',
    status: 'implemented',
    initSupport: true,
    icon: 'https://cdn.simpleicons.org/trello/0052CC',
    description: 'Cards on a Trello board filtered by label.',
    blocking: 'none',
  },
  {
    id: 'local',
    name: 'Local',
    status: 'implemented',
    initSupport: true,
    icon: '/icons/local.svg',
    description: 'Markdown task files under .aidev/tasks/ — no API required.',
    blocking: 'none',
  },
];

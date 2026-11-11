/** Display metadata for the task tools (providers) aidev can read tasks from. */
export interface ProviderMeta {
  id: string;
  name: string;
  image?: string;
  icon?: string;
  color?: string;
}

export const PROVIDER_META: Record<string, ProviderMeta> = {
  clickup: { id: 'clickup', name: 'ClickUp', icon: 'i-simple-icons-clickup', color: '#7B68EE' },
  jira: { id: 'jira', name: 'Jira', icon: 'i-simple-icons-jira', color: '#0052CC' },
  linear: { id: 'linear', name: 'Linear', icon: 'i-simple-icons-linear', color: '#5E6AD2' },
  monday: { id: 'monday', name: 'Monday', image: '/providers/monday.svg' },
  notion: { id: 'notion', name: 'Notion', icon: 'i-simple-icons-notion', color: '#000000' },
  trello: { id: 'trello', name: 'Trello', icon: 'i-simple-icons-trello', color: '#0052CC' },
  local: { id: 'local', name: 'Local', image: '/providers/local.svg' },
};

export function providerMeta(id: string): ProviderMeta {
  const key = (id || '').toLowerCase();
  return PROVIDER_META[key] ?? { id: key, name: id || 'Unknown', icon: 'i-lucide-list-checks' };
}

/** Select/menu item (label, value and its icon or logo) for a provider. */
export function providerItem(id: string) {
  const m = providerMeta(id);
  const label = id === 'local' ? 'Local (no external tool)' : m.name;
  return m.image ? { label, value: id, avatar: { src: m.image, alt: '' } } : { label, value: id, icon: m.icon };
}

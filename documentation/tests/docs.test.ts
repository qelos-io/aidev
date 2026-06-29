import { describe, it, expect } from 'vitest';
import { providers } from '../.vitepress/data/providers';
import { agents } from '../.vitepress/data/agents';
import { mount } from '@vue/test-utils';
import ProviderGrid from '../.vitepress/theme/components/ProviderGrid.vue';
import AgentGrid from '../.vitepress/theme/components/AgentGrid.vue';

describe('providers data', () => {
  it('lists all seven implemented providers', () => {
    expect(providers).toHaveLength(7);
    expect(providers.map((p) => p.id).sort()).toEqual(
      ['clickup', 'jira', 'linear', 'local', 'monday', 'notion', 'trello'].sort(),
    );
  });

  it('assigns an icon to every provider', () => {
    for (const provider of providers) {
      expect(provider.icon.length).toBeGreaterThan(0);
    }
  });
});

describe('agents data', () => {
  it('lists all eight supported agents', () => {
    expect(agents).toHaveLength(8);
    expect(agents.map((a) => a.id).sort()).toEqual(
      ['aider', 'antigravity', 'anthropic-sdk', 'claude', 'codex', 'cursor', 'devin', 'opencode'].sort(),
    );
  });

  it('assigns an icon to every agent', () => {
    for (const agent of agents) {
      expect(agent.icon.length).toBeGreaterThan(0);
    }
  });
});

describe('ProviderGrid', () => {
  it('renders a card for each provider', () => {
    const wrapper = mount(ProviderGrid);
    expect(wrapper.findAll('.icon-card')).toHaveLength(providers.length);
    expect(wrapper.text()).toContain('ClickUp');
    expect(wrapper.text()).toContain('Local');
  });
});

describe('AgentGrid', () => {
  it('renders a card for each agent', () => {
    const wrapper = mount(AgentGrid);
    expect(wrapper.findAll('.icon-card')).toHaveLength(agents.length);
    expect(wrapper.text()).toContain('Claude');
    expect(wrapper.text()).toContain('Cursor');
  });
});

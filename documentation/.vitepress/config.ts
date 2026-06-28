import { defineConfig } from 'vitepress';

export default defineConfig({
  title: 'aidev',
  description: 'Turn tasks into merged code — automatically.',
  base: '/aidev/',
  head: [
    ['link', { rel: 'icon', href: '/aidev/icons/aider.svg' }],
  ],
  themeConfig: {
    logo: '/icons/aider.svg',
    nav: [
      { text: 'Guide', link: '/guide/getting-started' },
      { text: 'Providers', link: '/guide/providers' },
      { text: 'Agents', link: '/guide/agents' },
      { text: 'GitHub', link: 'https://github.com/qelos-io/aidev' },
      { text: 'npm', link: 'https://www.npmjs.com/package/@qelos/aidev' },
    ],
    sidebar: [
      {
        text: 'Introduction',
        items: [
          { text: 'What is aidev?', link: '/guide/getting-started' },
          { text: 'How it works', link: '/guide/how-it-works' },
          { text: 'Commands', link: '/guide/commands' },
        ],
      },
      {
        text: 'Configuration',
        items: [
          { text: 'Overview', link: '/guide/configuration' },
          { text: 'ClickUp', link: '/guide/configuration/clickup' },
          { text: 'Jira', link: '/guide/configuration/jira' },
          { text: 'Linear', link: '/guide/configuration/linear' },
          { text: 'Monday.com', link: '/guide/configuration/monday' },
          { text: 'Notion', link: '/guide/configuration/notion' },
          { text: 'Trello', link: '/guide/configuration/trello' },
          { text: 'Git & GitHub', link: '/guide/configuration/git' },
          { text: 'Behaviour', link: '/guide/configuration/behaviour' },
        ],
      },
      {
        text: 'Features',
        items: [
          { text: 'AI agents', link: '/guide/agents' },
          { text: 'Providers', link: '/guide/providers' },
          { text: 'Hooks', link: '/guide/hooks' },
          { text: 'Code review', link: '/guide/code-review' },
          { text: 'Auto-merge', link: '/guide/auto-merge' },
          { text: 'Dev notes mode', link: '/guide/dev-notes' },
          { text: 'Blocked tasks', link: '/guide/blocked-tasks' },
          { text: 'Auto-compress', link: '/guide/auto-compress' },
          { text: 'Non-code tasks', link: '/guide/non-code-tasks' },
          { text: 'Trigger word', link: '/guide/trigger-word' },
          { text: 'Local tasks queue', link: '/guide/local-tasks' },
          { text: 'Scheduling', link: '/guide/scheduling' },
          { text: 'Logging', link: '/guide/logging' },
          { text: 'Concurrency lock', link: '/guide/concurrency' },
          { text: 'UI dashboard', link: '/guide/ui-dashboard' },
        ],
      },
      {
        text: 'Project',
        items: [
          { text: 'Contributing', link: '/contributing' },
        ],
      },
    ],
    socialLinks: [
      { icon: 'github', link: 'https://github.com/qelos-io/aidev' },
    ],
    editLink: {
      pattern: 'https://github.com/qelos-io/aidev/edit/main/documentation/:path',
      text: 'Edit this page on GitHub',
    },
    footer: {
      message: 'Released under the MIT License.',
      copyright: 'Copyright © Qelos',
    },
  },
});

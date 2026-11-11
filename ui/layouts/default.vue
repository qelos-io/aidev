<template>
  <div class="shell">
    <!-- Sidebar (desktop) -->
    <aside class="sidebar" aria-label="Main navigation">
      <NuxtLink to="/" class="brand" aria-label="aidev home">
        <img src="/aidev-logo.png" alt="AI Dev" class="brand-logo" width="168" height="84" />
      </NuxtLink>

      <button type="button" class="search-trigger" @click="paletteOpen = true">
        <UIcon name="i-lucide-search" class="size-4" aria-hidden="true" />
        <span class="search-text">Search…</span>
        <UKbd value="meta" /><UKbd value="K" />
      </button>

      <nav class="nav">
        <section v-for="group in groups" :key="group.label" class="nav-group">
          <h2 class="nav-group-label">{{ group.label }}</h2>
          <NuxtLink
            v-for="item in group.items"
            :key="item.to"
            :to="item.to"
            class="nav-link"
            active-class="nav-link--active"
            exact-active-class="nav-link--active"
          >
            <UIcon :name="item.icon" class="nav-icon" aria-hidden="true" />
            <span class="nav-text">
              <span class="nav-title">{{ item.label }}</span>
              <span class="nav-hint">{{ item.hint }}</span>
            </span>
          </NuxtLink>
        </section>
      </nav>

      <div class="sidebar-foot">
        <UColorModeButton size="sm" color="neutral" variant="ghost" />
        <UButton size="sm" color="neutral" variant="ghost" icon="i-lucide-log-out" @click="logout">
          Sign out
        </UButton>
      </div>
    </aside>

    <div class="main">
      <header class="topbar">
        <UButton
          class="menu-btn"
          color="neutral"
          variant="ghost"
          icon="i-lucide-menu"
          aria-label="Open menu"
          @click="drawerOpen = true"
        />
        <div class="project" :title="cwd">
          <UIcon name="i-lucide-folder-open" class="size-4 shrink-0" aria-hidden="true" />
          <span class="project-label">Project</span>
          <strong class="project-name">{{ projectName }}</strong>
          <code class="project-path">{{ cwd }}</code>
        </div>
        <UButton
          class="search-btn"
          color="neutral"
          variant="ghost"
          icon="i-lucide-search"
          aria-label="Search"
          @click="paletteOpen = true"
        />
      </header>

      <main class="content">
        <div class="content-inner">
          <slot />
        </div>
      </main>
    </div>

    <!-- Mobile drawer -->
    <USlideover v-model:open="drawerOpen" side="left" title="Menu" description="Navigate aidev">
      <template #body>
        <nav class="nav">
          <section v-for="group in groups" :key="group.label" class="nav-group">
            <h2 class="nav-group-label">{{ group.label }}</h2>
            <NuxtLink
              v-for="item in group.items"
              :key="item.to"
              :to="item.to"
              class="nav-link"
              exact-active-class="nav-link--active"
              @click="drawerOpen = false"
            >
              <UIcon :name="item.icon" class="nav-icon" aria-hidden="true" />
              <span class="nav-text">
                <span class="nav-title">{{ item.label }}</span>
                <span class="nav-hint">{{ item.hint }}</span>
              </span>
            </NuxtLink>
          </section>
        </nav>
      </template>
    </USlideover>

    <!-- Command palette -->
    <UModal v-model:open="paletteOpen" title="Search" description="Jump to any page or action" :ui="{ content: 'max-w-xl' }">
      <template #content>
        <UCommandPalette
          :groups="paletteGroups"
          placeholder="Where do you want to go?"
          close
          @update:open="paletteOpen = $event"
          @update:model-value="onPick"
        />
      </template>
    </UModal>
  </div>
</template>

<script setup lang="ts">
import { clearApiToken } from '~/composables/useApi';

interface NavItem { to: string; label: string; hint: string; icon: string; keywords?: string[] }

const router = useRouter();
const config = useRuntimeConfig();
const cwd = computed(() => (config.public.aidevCwd as string) || '');
const projectName = computed(() => cwd.value.split(/[\\/]/).filter(Boolean).pop() || 'Current folder');

const drawerOpen = ref(false);
const paletteOpen = ref(false);

const groups: { label: string; items: NavItem[] }[] = [
  {
    label: 'Work',
    items: [
      { to: '/', label: 'Home', hint: 'What aidev is doing', icon: 'i-lucide-layout-dashboard' },
      { to: '/tasks', label: 'Tasks', hint: 'Your to-do board', icon: 'i-lucide-kanban' },
      { to: '/run', label: 'Run', hint: 'Start aidev now', icon: 'i-lucide-play' },
    ],
  },
  {
    label: 'Set up',
    items: [
      { to: '/config', label: 'Settings', hint: 'Connections & AI tools', icon: 'i-lucide-sliders-horizontal', keywords: ['config', 'env', 'provider', 'api key', 'token'] },
      { to: '/schedule', label: 'Schedule', hint: 'Run automatically', icon: 'i-lucide-calendar-clock', keywords: ['cron', 'timer', 'interval'] },
      { to: '/hooks', label: 'Custom steps', hint: 'Hooks around each run', icon: 'i-lucide-workflow', keywords: ['hooks', 'script', 'before', 'after'] },
      { to: '/mcp', label: 'Connected tools', hint: 'MCP servers for the AI', icon: 'i-lucide-plug', keywords: ['mcp', 'servers', 'integrations'] },
    ],
  },
  {
    label: 'History',
    items: [
      { to: '/logs', label: 'Activity log', hint: 'What happened and why', icon: 'i-lucide-scroll-text', keywords: ['logs', 'errors', 'debug'] },
    ],
  },
];

const paletteGroups = computed(() => [
  {
    id: 'pages',
    label: 'Go to',
    items: groups.flatMap((g) =>
      g.items.map((i) => ({
        label: i.label,
        suffix: i.hint,
        icon: i.icon,
        to: i.to,
        // UCommandPalette matches on label/suffix; keywords ride along in the suffix-less label list
        keywords: i.keywords,
      })),
    ),
  },
  {
    id: 'actions',
    label: 'Actions',
    items: [
      { label: 'Run aidev on new tasks', icon: 'i-lucide-play', to: '/run?autorun=open' },
      { label: 'Run aidev on waiting tasks', icon: 'i-lucide-hourglass', to: '/run?autorun=pending' },
      { label: 'Sign out', icon: 'i-lucide-log-out', onSelect: logout },
    ],
  },
]);

function onPick(item: { to?: unknown } | undefined) {
  paletteOpen.value = false;
  if (typeof item?.to === 'string') router.push(item.to);
}

defineShortcuts({
  meta_k: { usingInput: true, handler: () => { paletteOpen.value = !paletteOpen.value; } },
});

function logout() {
  clearApiToken();
  router.replace('/login');
}
</script>

<style scoped>
.shell {
  display: grid;
  grid-template-columns: 17rem 1fr;
  height: 100dvh;
  overflow: hidden;
  background: var(--wb-ground);
}

.sidebar {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  padding: 1.25rem 0.875rem 0.875rem;
  background: var(--wb-sidebar);
  border-right: 1px solid var(--ui-border);
  overflow-y: auto;
}

.brand {
  display: flex;
  align-items: center;
  gap: 0.625rem;
  padding: 0 0.5rem;
  text-decoration: none;
  color: var(--ui-text-highlighted);
}
.brand-logo { height: 3.25rem; width: auto; margin: -0.5rem 0 -0.5rem -0.25rem; }

.search-trigger {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  width: 100%;
  padding: 0.55rem 0.75rem;
  border-radius: 0.75rem;
  border: 1px solid var(--ui-border);
  background: var(--ui-bg);
  color: var(--wb-ink-soft);
  font-size: 0.875rem;
  text-align: left;
  cursor: pointer;
  transition: border-color 0.15s, box-shadow 0.15s;
}
.search-text { flex: 1; white-space: nowrap; }
.search-trigger:hover { border-color: var(--ui-border-accented); }
.search-trigger:focus-visible { outline: 2px solid var(--ui-primary); outline-offset: 2px; }

.nav { display: flex; flex-direction: column; gap: 1.25rem; }
.nav-group { display: flex; flex-direction: column; gap: 0.125rem; }
.nav-group-label {
  margin: 0 0 0.25rem;
  padding: 0 0.75rem;
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--wb-ink-soft);
}

.nav-link {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  min-height: 2.75rem;
  padding: 0.4rem 0.75rem;
  border-radius: 0.75rem;
  color: var(--ui-text);
  text-decoration: none;
  transition: background-color 0.15s;
}
.nav-link:hover { background: var(--ui-bg-elevated); }
.nav-link:focus-visible { outline: 2px solid var(--ui-primary); outline-offset: -2px; }
.nav-link--active {
  background: color-mix(in oklch, var(--ui-primary) 12%, transparent);
  color: var(--ui-text-highlighted);
}
.nav-link--active .nav-icon { color: var(--ui-primary); }
.nav-icon { width: 1.25rem; height: 1.25rem; flex-shrink: 0; color: var(--wb-ink-soft); }
.nav-text { display: flex; flex-direction: column; min-width: 0; line-height: 1.25; }
.nav-title { font-size: 0.9375rem; font-weight: 600; }
.nav-hint { font-size: 0.75rem; color: var(--wb-ink-soft); }

.sidebar-foot {
  margin-top: auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-top: 0.75rem;
  border-top: 1px solid var(--ui-border);
}

.main { display: flex; flex-direction: column; min-width: 0; min-height: 0; overflow: hidden; }

.topbar {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-shrink: 0;
  padding: 0.625rem 1.5rem;
  min-height: 3.25rem;
}
.menu-btn, .search-btn { display: none; }
.project {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  min-width: 0;
  flex: 1;
  color: var(--wb-ink-soft);
  font-size: 0.875rem;
}
.project-label { display: none; }
.project-name { color: var(--ui-text-highlighted); font-weight: 600; white-space: nowrap; }
.project-path {
  font-family: var(--font-mono);
  font-size: 0.75rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}

.content { flex: 1; min-height: 0; overflow-y: auto; padding: 0.5rem 1.5rem 2rem; }
.content-inner { max-width: 72rem; margin: 0 auto; }

@media (max-width: 900px) {
  .shell { grid-template-columns: 1fr; }
  .sidebar { display: none; }
  .menu-btn, .search-btn { display: inline-flex; }
  .topbar { padding: 0.5rem 1rem; }
  .project-path { display: none; }
  .content { padding: 0.5rem 1rem 2rem; }
}
</style>

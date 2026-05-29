<template>
  <div class="app-shell">
    <aside class="sidebar">
      <div class="brand">
        <span class="brand-mark">aidev</span>
        <span class="brand-sub">dashboard</span>
      </div>
      <nav>
        <NuxtLink
          v-for="item in nav"
          :key="item.to"
          :to="item.to"
          class="nav-link"
          active-class="nav-link--active"
        >
          <span class="nav-icon" aria-hidden="true">{{ item.icon }}</span>
          <span>{{ item.label }}</span>
        </NuxtLink>
      </nav>
    </aside>

    <div class="main">
      <header class="topbar">
        <div class="cwd" :title="cwd">
          <span class="cwd-label">cwd</span>
          <code class="cwd-value">{{ cwd || '—' }}</code>
        </div>
        <UButton size="sm" color="gray" variant="ghost" @click="logout">
          Logout
        </UButton>
      </header>

      <main class="content">
        <slot />
      </main>
    </div>
  </div>
</template>

<script setup lang="ts">
import { clearApiToken } from '~/composables/useApi';

const router = useRouter();
const config = useRuntimeConfig();
const cwd = computed(() => config.public.aidevCwd as string);

const nav = [
  { to: '/', label: 'Dashboard', icon: '◇' },
  { to: '/config', label: 'Config', icon: '⚙' },
  { to: '/logs', label: 'Logs', icon: '≡' },
  { to: '/tasks', label: 'Tasks', icon: '☰' },
  { to: '/run', label: 'Run', icon: '▶' },
];

function logout() {
  clearApiToken();
  router.replace('/login');
}
</script>

<style scoped>
.app-shell {
  display: grid;
  grid-template-columns: 220px 1fr;
  height: 100vh;
  overflow: hidden;
  background: var(--ui-bg, #f8f9fb);
}

.sidebar {
  background: #0f172a;
  color: #e2e8f0;
  padding: 1.25rem 0.75rem;
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
  overflow-y: auto;
}

.brand {
  display: flex;
  flex-direction: column;
  padding: 0 0.5rem;
}
.brand-mark { font-size: 1.25rem; font-weight: 700; letter-spacing: 0.02em; }
.brand-sub { font-size: 0.75rem; color: #94a3b8; }

nav { display: flex; flex-direction: column; gap: 0.125rem; }

.nav-link {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  padding: 0.55rem 0.75rem;
  border-radius: 0.375rem;
  color: #cbd5e1;
  text-decoration: none;
  font-size: 0.92rem;
}
.nav-link:hover { background: rgba(255, 255, 255, 0.05); color: #fff; }
.nav-link--active { background: rgba(59, 130, 246, 0.18); color: #fff; }

.nav-icon {
  width: 1.1rem;
  text-align: center;
  font-size: 0.9rem;
  opacity: 0.85;
}

.main {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}

.topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-shrink: 0;
  padding: 0.75rem 1.25rem;
  border-bottom: 1px solid #e5e7eb;
  background: #fff;
}

.cwd { display: flex; align-items: baseline; gap: 0.5rem; min-width: 0; }
.cwd-label { font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.08em; color: #6b7280; }
.cwd-value {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.85rem;
  color: #111827;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 60vw;
}

.content {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 1.5rem;
}
</style>

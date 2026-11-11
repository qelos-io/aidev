<template>
  <div class="home">
    <header class="page-head">
      <h1>{{ greeting }}</h1>
      <p>Here is where your tasks stand and what aidev can do next.</p>
    </header>

    <UAlert
      v-if="error"
      color="error"
      variant="soft"
      icon="i-lucide-triangle-alert"
      title="Couldn't load your task counts"
      :description="error"
      class="mb-6"
    />

    <div class="grid">
      <section class="panel" aria-labelledby="stand-h">
        <h2 id="stand-h">Where your tasks stand</h2>
        <ul class="ledger">
          <li v-for="row in rows" :key="row.label">
            <NuxtLink :to="row.to" class="ledger-row">
              <span class="dot" :class="`dot--${row.tone}`" aria-hidden="true" />
              <span class="ledger-text">
                <span class="ledger-label">{{ row.label }}</span>
                <span class="ledger-hint">{{ row.hint }}</span>
              </span>
              <USkeleton v-if="loading" class="h-7 w-10" />
              <span v-else class="ledger-value tabular">{{ row.value ?? '–' }}</span>
              <UIcon name="i-lucide-chevron-right" class="chev" aria-hidden="true" />
            </NuxtLink>
          </li>
        </ul>
      </section>

      <section class="panel" aria-labelledby="run-h">
        <h2 id="run-h">Start aidev</h2>
        <p class="panel-sub">Pick what you want aidev to work on. It runs on this project.</p>
        <div class="actions">
          <button v-for="a in actions" :key="a.value" type="button" class="action" @click="onRun(a.value)">
            <UIcon :name="a.icon" class="action-icon" aria-hidden="true" />
            <span class="action-text">
              <span class="action-label">{{ a.label }}</span>
              <span class="action-hint">{{ a.hint }}</span>
            </span>
          </button>
        </div>
      </section>

      <section class="panel panel--wide" aria-labelledby="done-h">
        <div class="panel-head">
          <h2 id="done-h">Tasks aidev handled</h2>
          <div class="seg" role="group" aria-label="Time period">
            <button
              v-for="p in periods"
              :key="p.value"
              type="button"
              class="seg-btn"
              :class="{ 'seg-btn--on': period === p.value }"
              :aria-pressed="period === p.value"
              @click="setPeriod(p.value)"
            >
              {{ p.label }}
            </button>
          </div>
        </div>
        <div class="done">
          <USkeleton v-if="loading" class="h-12 w-20" />
          <span v-else class="done-value tabular">{{ stats?.executed.current ?? '–' }}</span>
          <span v-if="!loading && deltaText" class="delta" :class="`delta--${deltaTone}`">{{ deltaText }}</span>
        </div>
        <p class="panel-sub">tasks updated {{ periodPhrase }}</p>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useDashboard, type DashboardPeriod } from '~/composables/useDashboard';

const { period, stats, loading, error, setPeriod } = useDashboard();

const greeting = computed(() => {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
});

const rows = computed(() => [
  { label: 'Ready for aidev', hint: 'New tasks it will pick up', value: stats.value?.open, tone: 'ready', to: '/tasks' },
  { label: 'Waiting on you', hint: 'aidev asked a question or needs a reply', value: stats.value?.pending, tone: 'wait', to: '/tasks' },
  { label: 'Ready to review', hint: 'Finished work for you to check', value: stats.value?.inReview, tone: 'review', to: '/tasks' },
  { label: 'Finished, all time', hint: 'Everything aidev has completed', value: stats.value?.allTimeDone, tone: 'ok', to: '/tasks' },
]);

const actions = [
  { value: 'open', label: 'Work on new tasks', hint: 'Pick up everything marked open', icon: 'i-lucide-play' },
  { value: 'pending', label: 'Continue waiting tasks', hint: 'After you have answered aidev', icon: 'i-lucide-message-circle-reply' },
  { value: 'review', label: 'Handle review feedback', hint: 'Apply comments on finished work', icon: 'i-lucide-git-pull-request' },
  { value: 'all', label: 'Do all of it', hint: 'New, waiting, and review in one go', icon: 'i-lucide-layers' },
];

const periods: { value: DashboardPeriod; label: string }[] = [
  { value: 'week', label: '7 days' },
  { value: 'month', label: '30 days' },
  { value: '3months', label: '90 days' },
];
const periodPhrase = computed(() => ({ week: 'in the last 7 days', month: 'in the last 30 days', '3months': 'in the last 90 days' })[period.value]);

const deltaText = computed(() => {
  const d = stats.value?.executed;
  if (!d || (d.previous === 0 && d.changePercent === null)) return '';
  const sign = d.changeAmount >= 0 ? '+' : '';
  return `${sign}${d.changeAmount} vs the period before`;
});
const deltaTone = computed(() => ((stats.value?.executed.changeAmount ?? 0) >= 0 ? 'up' : 'down'));

function onRun(status: string) {
  navigateTo({ path: '/run', query: { autorun: status } });
}
</script>

<style scoped>
.page-head { padding: 0.75rem 0 1.5rem; }
.page-head h1 { margin: 0; font-size: 1.875rem; font-weight: 700; letter-spacing: -0.02em; color: var(--ui-text-highlighted); }
.page-head p { margin: 0.25rem 0 0; color: var(--wb-ink-soft); }

.grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 1.25rem; align-items: start; }
.panel {
  padding: 1.25rem;
  border-radius: 1rem;
  background: var(--ui-bg);
  border: 1px solid var(--ui-border);
}
.panel--wide { grid-column: 1 / -1; }
.panel h2 { margin: 0 0 0.75rem; font-size: 1rem; font-weight: 700; color: var(--ui-text-highlighted); }
.panel-sub { margin: -0.25rem 0 0.75rem; font-size: 0.875rem; color: var(--wb-ink-soft); }
.panel-head { display: flex; align-items: center; justify-content: space-between; gap: 0.75rem; flex-wrap: wrap; }
.panel-head h2 { margin: 0; }

.ledger { list-style: none; margin: 0; padding: 0; }
.ledger li + li { border-top: 1px solid var(--ui-border); }
.ledger-row {
  display: flex; align-items: center; gap: 0.875rem;
  min-height: 3.5rem; padding: 0.5rem 0.25rem;
  text-decoration: none; color: inherit; border-radius: 0.5rem;
}
.ledger-row:hover { background: var(--ui-bg-elevated); }
.ledger-row:focus-visible { outline: 2px solid var(--ui-primary); outline-offset: 2px; }
.dot { width: 0.625rem; height: 0.625rem; border-radius: 50%; flex-shrink: 0; }
.dot--ready { background: var(--ui-primary); }
.dot--wait { background: var(--wb-wait); }
.dot--review { background: oklch(64% 0.14 290); }
.dot--ok { background: var(--wb-ok); }
.ledger-text { display: flex; flex-direction: column; flex: 1; min-width: 0; }
.ledger-label { font-weight: 600; color: var(--ui-text-highlighted); }
.ledger-hint { font-size: 0.8125rem; color: var(--wb-ink-soft); }
.ledger-value { font-size: 1.5rem; font-weight: 700; color: var(--ui-text-highlighted); min-width: 2ch; text-align: right; }
.chev { width: 1rem; height: 1rem; color: var(--wb-ink-soft); }

.actions { display: flex; flex-direction: column; gap: 0.5rem; }
.action {
  display: flex; align-items: center; gap: 0.875rem; width: 100%;
  min-height: 3.5rem; padding: 0.625rem 0.875rem;
  border-radius: 0.75rem; border: 1px solid var(--ui-border);
  background: var(--ui-bg); text-align: left; cursor: pointer;
  transition: border-color 0.15s, background-color 0.15s;
}
.action:hover { border-color: var(--ui-primary); background: color-mix(in oklch, var(--ui-primary) 6%, transparent); }
.action:focus-visible { outline: 2px solid var(--ui-primary); outline-offset: 2px; }
.action-icon { width: 1.25rem; height: 1.25rem; color: var(--ui-primary); flex-shrink: 0; }
.action-text { display: flex; flex-direction: column; }
.action-label { font-weight: 600; color: var(--ui-text-highlighted); }
.action-hint { font-size: 0.8125rem; color: var(--wb-ink-soft); }

.seg { display: inline-flex; gap: 0.25rem; padding: 0.25rem; border-radius: 0.75rem; background: var(--ui-bg-elevated); }
.seg-btn {
  min-height: 2.25rem; padding: 0 0.875rem; border: 0; border-radius: 0.5rem;
  background: transparent; color: var(--wb-ink-soft); font-size: 0.875rem; font-weight: 600; cursor: pointer;
  transition: background-color 0.15s, color 0.15s;
}
.seg-btn:hover { color: var(--ui-text-highlighted); }
.seg-btn:focus-visible { outline: 2px solid var(--ui-primary); outline-offset: 2px; }
.seg-btn--on { background: var(--ui-bg); color: var(--ui-text-highlighted); box-shadow: 0 1px 2px rgb(0 0 0 / 0.1); }

.done { display: flex; align-items: baseline; gap: 0.875rem; margin-top: 0.75rem; }
.done-value { font-size: 3rem; line-height: 1; font-weight: 700; color: var(--ui-text-highlighted); letter-spacing: -0.02em; }
.delta { font-size: 0.875rem; font-weight: 600; }
.delta--up { color: var(--wb-ok); }
.delta--down { color: var(--wb-bad); }

@media (max-width: 900px) { .grid { grid-template-columns: 1fr; } }
</style>

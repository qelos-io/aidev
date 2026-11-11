<template>
  <div class="logs">
    <header class="page-head">
      <div>
        <h1>Activity log</h1>
        <p>A record of everything aidev did and why. Open this when something didn't go as expected.</p>
        <p v-if="data" class="file-line">
          <UIcon name="i-lucide-file-text" class="size-3.5" aria-hidden="true" />
          <code :title="data.path">{{ logName }}</code>
          <span v-if="!data.exists" class="state state--warn">Not created yet</span>
          <span v-else class="muted">· {{ data.total.toLocaleString() }} lines<template v-if="data.truncated">, showing the latest {{ data.limit.toLocaleString() }}</template></span>
          <span class="muted">· {{ ttlDays > 0 ? `lines older than ${ttlDays} day${ttlDays === 1 ? '' : 's'} are removed automatically` : 'old lines are never removed automatically' }}</span>
        </p>
      </div>
      <div class="head-actions">
        <UButton color="neutral" variant="ghost" icon="i-lucide-refresh-cw" :loading="refreshing" :disabled="refreshing" @click="reload({ explicit: true })">Refresh</UButton>
        <UButton color="error" variant="soft" icon="i-lucide-trash-2" :disabled="!data?.exists || data?.total === 0 || clearing" @click="confirmClear = true">Clear log</UButton>
      </div>
    </header>

    <UAlert v-if="loadError" color="error" variant="soft" icon="i-lucide-triangle-alert" title="Couldn't read the log" :description="loadError" class="mb-5" />

    <section class="panel">
      <div class="controls">
        <div class="chips" role="group" aria-label="Quick filters">
          <button v-for="f in quickFilters" :key="f.label" type="button" class="chip" :class="{ 'chip--on': query === f.q }" :aria-pressed="query === f.q" @click="applyFilter(f.q)">{{ f.label }}</button>
        </div>
        <UInput v-model="searchInput" placeholder="Search the log…" aria-label="Search the log" icon="i-lucide-search" :loading="searchInput !== query" class="search" />
        <USelect v-model.number="limit" :items="limitOptions" aria-label="How many recent lines to load" class="w-32" />
        <USwitch v-model="autoPoll" label="Live" description="" aria-label="Refresh automatically every 5 seconds" />
      </div>

      <p v-if="data && data.exists && data.lines.length" class="meta" aria-live="polite">
        <template v-if="query">{{ data.shown.toLocaleString() }} matching “{{ query }}” in the latest {{ Math.min(data.total, data.limit).toLocaleString() }} lines</template>
        <template v-else>Showing the latest {{ data.shown.toLocaleString() }} lines</template>
      </p>

      <div v-if="data && !data.exists" class="empty">
        <strong>No log yet</strong>
        <span>aidev creates it the first time it runs. After that, what it does shows up here.</span>
      </div>
      <div v-else-if="data && data.lines.length === 0" class="empty">
        <strong>{{ query ? 'Nothing matches' : 'The log is empty' }}</strong>
        <span v-if="query">Nothing in the latest {{ data.limit.toLocaleString() }} lines mentions “{{ query }}”.</span>
        <span v-else>Once aidev does something, it will be recorded here.</span>
      </div>
      <div v-else-if="data" ref="viewer" class="viewer" role="log" tabindex="0" aria-label="Activity log lines">
        <div v-for="l in rendered" :key="l.i" class="ln" :class="`ln--${l.level}`">{{ l.text }}</div>
      </div>
    </section>

    <UModal v-model:open="confirmClear" title="Clear the activity log?" description="This empties the log file. It can't be undone.">
      <template #body>
        <p class="text-sm">All recorded history in <code>{{ logName }}</code> will be erased. The file itself stays and aidev keeps writing to it.</p>
      </template>
      <template #footer>
        <div class="flex justify-end gap-2 w-full">
          <UButton variant="ghost" color="neutral" :disabled="clearing" @click="confirmClear = false">Keep it</UButton>
          <UButton color="error" :loading="clearing" @click="clearLog">Clear log</UButton>
        </div>
      </template>
    </UModal>
  </div>
</template>

<script setup lang="ts">
import { useApi } from '~/composables/useApi';
import { useInitialLoading } from '~/composables/useInitialLoading';

interface LogsResponse {
  path: string;
  exists: boolean;
  total: number;
  shown: number;
  truncated: boolean;
  limit: number;
  query: string;
  lines: string[];
  ttlDays: number;
}

const api = useApi();

const data = ref<LogsResponse | null>(null);
const ttlDays = computed(() => data.value?.ttlDays ?? 14);
const loadError = ref('');
const { loading, beginFetch, endFetch } = useInitialLoading(data);
const refreshing = ref(false);

const searchInput = ref('');
// `query` lags `searchInput` by the debounce window. We send `query` to the
// server and key the auto-poll off it so typing doesn't fire a request per
// keystroke.
const query = ref('');
const limit = ref(1000);
const limitOptions = [
  { label: '200', value: 200 },
  { label: '500', value: 500 },
  { label: '1,000', value: 1000 },
  { label: '5,000', value: 5000 },
  { label: '10,000', value: 10000 },
];

const autoPoll = ref(true);
const confirmClear = ref(false);
const clearing = ref(false);

const viewer = ref<HTMLElement | null>(null);

const quickFilters = [
  { label: 'Everything', q: '' },
  { label: 'Problems', q: 'error' },
  { label: 'Warnings', q: 'warn' },
];
function applyFilter(q: string) {
  searchInput.value = q;
  query.value = q;
  if (debounceHandle) clearTimeout(debounceHandle);
}
function levelOf(line: string): 'error' | 'warn' | 'plain' {
  if (/\[error\]|\berror\b|\bfailed\b|\bexception\b/i.test(line)) return 'error';
  if (/\[warn(ing)?\]|\bwarn(ing)?\b/i.test(line)) return 'warn';
  return 'plain';
}
const rendered = computed(() => (data.value?.lines ?? []).map((text, i) => ({ i, text, level: levelOf(text) })));
const logName = computed(() => (data.value?.path ?? '').split(/[\\/]/).pop() || 'aidev.log');
let pollHandle: ReturnType<typeof setInterval> | null = null;
let debounceHandle: ReturnType<typeof setTimeout> | null = null;

async function reload(opts: { keepScroll?: boolean; explicit?: boolean } = {}) {
  const isInitial = beginFetch(loadError);
  if (opts.explicit) refreshing.value = true;
  try {
    const params = new URLSearchParams();
    params.set('limit', String(limit.value));
    if (query.value) params.set('q', query.value);
    const url = `/api/logs?${params.toString()}`;
    data.value = await api<LogsResponse>(url);
    if (!isInitial) loadError.value = '';
    if (!opts.keepScroll) {
      await nextTick();
      scrollToBottom();
    }
  } catch (err) {
    loadError.value = err instanceof Error ? err.message : String(err);
  } finally {
    endFetch(isInitial);
    if (opts.explicit) refreshing.value = false;
  }
}

function scrollToBottom() {
  const el = viewer.value;
  if (el) el.scrollTop = el.scrollHeight;
}

async function clearLog() {
  clearing.value = true;
  try {
    await api('/api/logs', { method: 'DELETE' });
    confirmClear.value = false;
    await reload();
  } catch (err) {
    loadError.value = err instanceof Error ? err.message : String(err);
  } finally {
    clearing.value = false;
  }
}

// Debounce search input → query (300ms).
watch(searchInput, (val) => {
  if (debounceHandle) clearTimeout(debounceHandle);
  debounceHandle = setTimeout(() => {
    query.value = val;
  }, 300);
});

// Re-fetch whenever the effective query or tail size changes.
watch([query, limit], () => {
  reload();
});

function startPolling() {
  stopPolling();
  if (!autoPoll.value) return;
  pollHandle = setInterval(() => {
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
    // Keep the user's scroll position during background polls so they don't
    // get yanked to the bottom mid-read.
    reload({ keepScroll: true });
  }, 5000);
}

function stopPolling() {
  if (pollHandle) {
    clearInterval(pollHandle);
    pollHandle = null;
  }
}

watch(autoPoll, startPolling);

onMounted(() => {
  reload();
  startPolling();
});

onBeforeUnmount(() => {
  stopPolling();
  if (debounceHandle) clearTimeout(debounceHandle);
});
</script>

<style scoped>
.logs { padding-bottom: 2rem; }
.page-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 1rem; flex-wrap: wrap; padding: 0.75rem 0 1.25rem; }
.page-head h1 { margin: 0; font-size: 1.875rem; font-weight: 700; letter-spacing: -0.02em; color: var(--ui-text-highlighted); }
.page-head p { margin: 0.25rem 0 0; color: var(--wb-ink-soft); max-width: 46rem; }
.file-line { display: flex; align-items: center; flex-wrap: wrap; gap: 0.375rem; font-size: 0.8125rem; }
.file-line code { font-family: var(--font-mono); }
.state--warn { color: var(--wb-wait); font-weight: 600; }
.muted { color: var(--wb-ink-soft); }
.head-actions { display: flex; gap: 0.5rem; }

.panel { padding: 1.25rem; border-radius: 1rem; background: var(--ui-bg); border: 1px solid var(--ui-border); }
.controls { display: flex; align-items: center; gap: 0.75rem; flex-wrap: wrap; }
.search { flex: 1; min-width: 12rem; }
.chips { display: inline-flex; gap: 0.25rem; padding: 0.25rem; border-radius: 0.75rem; background: var(--ui-bg-elevated); }
.chip { min-height: 2.25rem; padding: 0 0.875rem; border: 0; border-radius: 0.5rem; background: transparent; color: var(--wb-ink-soft); font-size: 0.875rem; font-weight: 600; cursor: pointer; transition: background-color 0.15s, color 0.15s; }
.chip:hover { color: var(--ui-text-highlighted); }
.chip:focus-visible { outline: 2px solid var(--ui-primary); outline-offset: 2px; }
.chip--on { background: var(--ui-bg); color: var(--ui-text-highlighted); box-shadow: 0 1px 2px rgb(0 0 0 / 0.1); }
.meta { margin: 0.875rem 0 0.5rem; font-size: 0.8125rem; color: var(--wb-ink-soft); }

.viewer { margin-top: 0.75rem; padding: 0.75rem 0; max-height: 65vh; overflow: auto; border-radius: 0.75rem; background: oklch(21% 0.02 250); color: oklch(92% 0.01 250); font-family: var(--font-mono); font-size: 0.8125rem; line-height: 1.5; }
.viewer:focus-visible { outline: 2px solid var(--ui-primary); outline-offset: 2px; }
.ln { padding: 0 1rem; white-space: pre; width: max-content; min-width: 100%; }
.ln--error { background: oklch(40% 0.12 25 / 0.35); color: oklch(88% 0.08 25); }
.ln--warn { background: oklch(45% 0.1 80 / 0.25); color: oklch(90% 0.08 85); }

.empty { display: flex; flex-direction: column; gap: 0.25rem; align-items: center; padding: 2.5rem 1rem; margin-top: 0.75rem; text-align: center; border: 1px dashed var(--ui-border-accented); border-radius: 0.75rem; color: var(--wb-ink-soft); }
.empty strong { color: var(--ui-text-highlighted); }
</style>

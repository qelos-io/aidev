<template>
  <div class="logs-page">
    <UCard>
      <template #header>
        <div class="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h1 class="text-lg font-semibold">Logs</h1>
            <p class="text-xs text-gray-500 mt-1">
              <code>{{ data?.path || '—' }}</code>
              <span v-if="data && !data.exists" class="ml-2 text-amber-600">not found</span>
              <span v-else-if="data" class="ml-2 text-gray-500">
                {{ data.total.toLocaleString() }} line(s) total<span v-if="data.truncated">, tailing last {{ data.limit.toLocaleString() }}</span>
              </span>
            </p>
            <p class="text-xs text-gray-400 mt-0.5">
              <span v-if="ttlDays > 0">Auto-pruned: lines older than {{ ttlDays }} day{{ ttlDays === 1 ? '' : 's' }} are removed on each run.</span>
              <span v-else>Auto-pruning disabled (<code>AIDEV_LOG_TTL_DAYS=0</code>).</span>
            </p>
          </div>
          <div class="flex items-center gap-2">
            <UButton
              color="neutral"
              variant="ghost"
              size="sm"
              :loading="refreshing"
              :disabled="refreshing"
              @click="reload({ explicit: true })"
            >
              Refresh
            </UButton>
            <UButton
              color="red"
              variant="soft"
              size="sm"
              :disabled="!data?.exists || data?.total === 0 || clearing"
              @click="confirmClear = true"
            >
              Clear log
            </UButton>
          </div>
        </div>
      </template>

      <UAlert
        v-if="loadError"
        color="red"
        variant="soft"
        :title="loadError"
        class="mb-3"
      />

      <div class="controls">
        <UFormField label="Search" class="search-group">
          <UInput
            v-model="searchInput"
            placeholder="Case-insensitive substring filter…"
            icon="i-heroicons-magnifying-glass"
            :loading="searchInput !== query"
          />
        </UFormField>
        <UFormField label="Tail lines" class="tail-group">
          <USelect v-model.number="limit" :items="limitOptions" />
        </UFormField>
        <div class="autopoll">
          <UCheckbox v-model="autoPoll" label="Auto-refresh (5s)" />
        </div>
      </div>

      <div v-if="data" class="meta">
        <span v-if="query">
          Showing {{ data.shown.toLocaleString() }} match(es) in last
          {{ Math.min(data.total, data.limit).toLocaleString() }} line(s)
        </span>
        <span v-else>
          Showing last {{ data.shown.toLocaleString() }} line(s)
        </span>
      </div>

      <div v-if="data && !data.exists" class="empty">
        <p class="empty-title">Log file does not exist yet</p>
        <p class="empty-sub">
          aidev creates it on first run. Once <code>{{ data.path }}</code>
          exists, lines will appear here.
        </p>
      </div>
      <div v-else-if="data && data.lines.length === 0" class="empty">
        <p class="empty-title">No matching lines</p>
        <p class="empty-sub" v-if="query">
          Nothing in the last {{ data.limit.toLocaleString() }} lines matches “{{ query }}”.
        </p>
        <p class="empty-sub" v-else>
          The log file is empty.
        </p>
      </div>
      <pre v-else-if="data" ref="viewer" class="viewer"><code>{{ data.lines.join('\n') }}</code></pre>
    </UCard>

    <UModal v-model:open="confirmClear">
      <template #header>
        <h3 class="text-base font-semibold">Clear log file?</h3>
      </template>
      <template #body>
        <p class="text-sm text-gray-600">
          This truncates <code>{{ data?.path }}</code> to zero bytes. The file
          itself stays in place. This cannot be undone.
        </p>
      </template>
      <template #footer>
        <div class="flex justify-end gap-2">
          <UButton variant="ghost" color="neutral" :disabled="clearing" @click="confirmClear = false">
            Cancel
          </UButton>
          <UButton color="red" :loading="clearing" @click="clearLog">
            Clear log
          </UButton>
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

const viewer = ref<HTMLPreElement | null>(null);
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
.logs-page {
  display: flex;
  flex-direction: column;
}

.controls {
  display: grid;
  grid-template-columns: 1fr 12rem auto;
  gap: 0.75rem;
  align-items: end;
  margin-bottom: 0.75rem;
}

.search-group { min-width: 0; }
.tail-group { min-width: 0; }
.autopoll {
  padding-bottom: 0.45rem;
  white-space: nowrap;
}

.meta {
  font-size: 0.75rem;
  color: #6b7280;
  margin-bottom: 0.5rem;
}

.viewer {
  background: #0f172a;
  color: #e2e8f0;
  border-radius: 0.375rem;
  padding: 0.75rem 1rem;
  max-height: 65vh;
  overflow: auto;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 0.78rem;
  line-height: 1.45;
  white-space: pre;
  margin: 0;
}

.empty {
  border: 1px dashed #cbd5e1;
  border-radius: 0.375rem;
  padding: 1.5rem;
  text-align: center;
  color: #475569;
}
.empty-title { font-weight: 600; margin-bottom: 0.25rem; }
.empty-sub { font-size: 0.85rem; color: #64748b; }
</style>

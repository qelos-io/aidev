<template>
  <div class="run-page">
    <UCard>
      <template #header>
        <div class="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h1 class="text-lg font-semibold">Run</h1>
            <p class="text-xs text-gray-500 mt-1">
              Spawns <code>aidev run &lt;status&gt;</code> in
              <code>{{ cwd || '—' }}</code> and streams output live below.
            </p>
          </div>
          <UButton
            v-if="lines.length > 0 && !running"
            size="xs"
            color="gray"
            variant="ghost"
            @click="lines = []"
          >
            Clear output
          </UButton>
        </div>
      </template>

      <UAlert
        v-if="error"
        color="red"
        variant="soft"
        :title="error"
        class="mb-3"
      />

      <div class="actions">
        <UButton
          v-for="s in statuses"
          :key="s.value"
          size="md"
          :color="s.color"
          :loading="running && activeStatus === s.value"
          :disabled="running"
          class="action-btn"
          @click="startRun(s.value)"
        >
          {{ s.label }}
        </UButton>

        <UButton
          size="md"
          color="red"
          variant="soft"
          :disabled="!running || cancelling"
          :loading="cancelling"
          class="cancel-btn"
          @click="cancelRun"
        >
          Cancel
        </UButton>
      </div>

      <div class="status-bar">
        <span class="status-dot" :class="`status-dot--${stateKey}`" />
        <span class="status-text">{{ statusText }}</span>
      </div>

      <pre v-if="lines.length > 0" ref="viewer" class="viewer"><code>{{ text }}</code></pre>
      <p v-else class="empty">No output yet. Click a status above to start a run.</p>
    </UCard>
  </div>
</template>

<script setup lang="ts">
import { useApi } from '~/composables/useApi';

type RunStatus = 'open' | 'pending' | 'review' | 'all';

interface ExitInfo {
  code: number | null;
  signal: string | null;
  durationMs: number;
}

const TOKEN_KEY = 'aidev-ui-token';

const api = useApi();
const route = useRoute();
const runtime = useRuntimeConfig();
const cwd = computed(() => runtime.public.aidevCwd as string);

const statuses: { value: RunStatus; label: string; color: 'primary' | 'sky' | 'amber' | 'gray' }[] = [
  { value: 'open', label: 'Open', color: 'primary' },
  { value: 'pending', label: 'Pending', color: 'sky' },
  { value: 'review', label: 'Review', color: 'amber' },
  { value: 'all', label: 'All', color: 'gray' },
];

const lines = ref<string[]>([]);
const running = ref(false);
const cancelling = ref(false);
const activeStatus = ref<RunStatus | null>(null);
const lastExit = ref<ExitInfo | null>(null);
const error = ref('');
const viewer = ref<HTMLPreElement | null>(null);

let abort: AbortController | null = null;

const text = computed(() => lines.value.join('\n'));

const stateKey = computed(() => {
  if (running.value) return 'running';
  if (error.value) return 'error';
  if (lastExit.value) {
    return lastExit.value.code === 0 ? 'done' : 'failed';
  }
  return 'idle';
});

const statusText = computed(() => {
  if (running.value && activeStatus.value) {
    return `Running aidev run ${activeStatus.value}…`;
  }
  if (lastExit.value) {
    const { code, signal, durationMs } = lastExit.value;
    const dur = formatDuration(durationMs);
    if (signal) return `Terminated by signal ${signal} after ${dur}`;
    return `Exited with code ${code ?? 'null'} after ${dur}`;
  }
  return 'Idle';
});

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  const rem = Math.round(s - m * 60);
  return `${m}m ${rem}s`;
}

function appendLine(prefix: string, line: string) {
  lines.value.push(prefix ? `${prefix} ${line}` : line);
  nextTick(() => {
    const el = viewer.value;
    if (el) el.scrollTop = el.scrollHeight;
  });
}

function handleSseEvent(name: string, data: string) {
  if (name === 'stdout') {
    appendLine('', data);
  } else if (name === 'stderr') {
    appendLine('[stderr]', data);
  } else if (name === 'exit') {
    try {
      const info = JSON.parse(data) as ExitInfo;
      lastExit.value = info;
      const dur = formatDuration(info.durationMs);
      appendLine(
        '',
        `--- exit code ${info.code ?? 'null'}${info.signal ? `, signal ${info.signal}` : ''} (${dur}) ---`,
      );
    } catch {
      appendLine('', `--- exit ${data} ---`);
    }
    running.value = false;
    activeStatus.value = null;
    cancelling.value = false;
  } else if (name === 'error') {
    appendLine('[error]', data || 'unknown error');
    running.value = false;
    activeStatus.value = null;
    cancelling.value = false;
  }
}

async function startRun(status: RunStatus) {
  if (running.value) return;
  // EventSource only supports GET — and this endpoint is POST (it spawns a
  // process). So we use fetch + a manual SSE parser, the same pattern used on
  // the Tasks page for single-task execute.
  const token = import.meta.client ? localStorage.getItem(TOKEN_KEY) : null;
  if (!token) {
    error.value = 'Not authenticated — refresh and log in again.';
    return;
  }

  error.value = '';
  lines.value = [];
  lastExit.value = null;
  running.value = true;
  activeStatus.value = status;

  const ctrl = new AbortController();
  abort = ctrl;

  try {
    const res = await fetch('/api/run', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'text/event-stream',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ status }),
      signal: ctrl.signal,
    });

    if (!res.ok || !res.body) {
      // h3 serializes createError() as JSON `{ statusCode, statusMessage, ... }`.
      // Prefer statusMessage for the inline banner; fall back to raw body so a
      // non-JSON error (proxy 502, etc.) is still surfaced.
      const raw = await res.text().catch(() => '');
      let detail = raw;
      try {
        const parsed = JSON.parse(raw) as { statusMessage?: string; message?: string };
        detail = parsed.statusMessage || parsed.message || raw;
      } catch {
        // raw stays as-is.
      }
      error.value = `HTTP ${res.status}: ${detail || res.statusText}`;
      running.value = false;
      activeStatus.value = null;
      if (abort === ctrl) abort = null;
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buf = '';
    let eventName = 'message';
    let dataLines: string[] = [];

    const flushEvent = () => {
      if (dataLines.length === 0 && eventName === 'message') return;
      handleSseEvent(eventName, dataLines.join('\n'));
      eventName = 'message';
      dataLines = [];
    };

    // Standard SSE framing: events are separated by a blank line. Each line is
    // `event: <name>`, `data: <payload>`, or a `:` comment. id/retry ignored.
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let nl = buf.indexOf('\n');
      while (nl !== -1) {
        const rawLine = buf.slice(0, nl).replace(/\r$/, '');
        buf = buf.slice(nl + 1);
        if (rawLine === '') {
          flushEvent();
        } else if (rawLine.startsWith(':')) {
          // SSE comment — ignore.
        } else if (rawLine.startsWith('event:')) {
          eventName = rawLine.slice('event:'.length).trim() || 'message';
        } else if (rawLine.startsWith('data:')) {
          dataLines.push(rawLine.slice('data:'.length).replace(/^ /, ''));
        }
        nl = buf.indexOf('\n');
      }
    }
    flushEvent();
  } catch (err) {
    if ((err as { name?: string })?.name !== 'AbortError') {
      error.value = err instanceof Error ? err.message : String(err);
    }
  } finally {
    running.value = false;
    activeStatus.value = null;
    cancelling.value = false;
    if (abort === ctrl) abort = null;
  }
}

async function cancelRun() {
  if (!running.value || cancelling.value) return;
  cancelling.value = true;
  try {
    await api('/api/run/cancel', { method: 'POST' });
    appendLine('', '--- cancel requested (SIGTERM) ---');
  } catch (err) {
    cancelling.value = false;
    error.value = err instanceof Error ? err.message : String(err);
  }
  // running/cancelling are cleared by the upcoming `exit` SSE event.
}

onMounted(() => {
  const autorun = route.query.autorun;
  if (typeof autorun === 'string' && autorun) {
    startRun(autorun as RunStatus);
  }
});

onBeforeUnmount(() => {
  // Don't kill the child on nav-away — let the user come back to a still-
  // streaming run. The server tears it down when the SSE stream closes (i.e.
  // when the browser disconnects entirely), which doesn't happen on a Vue
  // route change since we abort the fetch but the server keeps no per-route
  // session. Aborting here cleans up the client side only.
  if (abort) {
    abort.abort();
    abort = null;
  }
});
</script>

<style scoped>
.run-page {
  display: flex;
  flex-direction: column;
}

.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin-bottom: 0.75rem;
}
.action-btn {
  min-width: 7rem;
  justify-content: center;
}
.cancel-btn {
  margin-left: auto;
  min-width: 6rem;
  justify-content: center;
}

.status-bar {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.8rem;
  color: #475569;
  margin-bottom: 0.5rem;
}
.status-dot {
  width: 0.55rem;
  height: 0.55rem;
  border-radius: 50%;
  background: #94a3b8;
  flex-shrink: 0;
}
.status-dot--running {
  background: #38bdf8;
  box-shadow: 0 0 0 3px rgba(56, 189, 248, 0.18);
  animation: pulse 1.4s ease-in-out infinite;
}
.status-dot--done { background: #10b981; }
.status-dot--failed { background: #ef4444; }
.status-dot--error { background: #ef4444; }

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.45; }
}

.viewer {
  background: #0f172a;
  color: #e2e8f0;
  border-radius: 0.375rem;
  padding: 0.6rem 0.85rem;
  max-height: 28rem;
  overflow: auto;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 0.75rem;
  line-height: 1.45;
  white-space: pre;
  margin: 0;
}

.empty {
  border: 1px dashed #cbd5e1;
  border-radius: 0.375rem;
  padding: 1.25rem;
  text-align: center;
  color: #64748b;
  font-size: 0.85rem;
  margin: 0;
}
</style>

<template>
  <div class="run">
    <header class="page-head">
      <div>
        <h1>Run aidev</h1>
        <p>Start aidev on <strong>{{ projectName }}</strong> and watch it work.</p>
      </div>
    </header>

    <UAlert v-if="error" color="error" variant="soft" icon="i-lucide-triangle-alert" title="Couldn't start the run" :description="error" class="mb-5" />

    <section class="panel banner" :class="`banner--${banner.tone}`" aria-live="polite">
      <span class="banner-icon" aria-hidden="true">
        <UIcon v-if="banner.tone === 'running'" name="i-lucide-loader-circle" class="size-6 animate-spin" />
        <UIcon v-else-if="banner.tone === 'done'" name="i-lucide-circle-check" class="size-6" />
        <UIcon v-else-if="banner.tone === 'failed'" name="i-lucide-circle-alert" class="size-6" />
        <UIcon v-else name="i-lucide-circle-play" class="size-6" />
      </span>
      <div class="banner-text">
        <h2>{{ banner.title }}</h2>
        <p>{{ banner.detail }}</p>
      </div>
      <UButton v-if="running" color="error" variant="soft" icon="i-lucide-square" :loading="cancelling" :disabled="cancelling" @click="cancelRun">
        Stop
      </UButton>
    </section>

    <section class="panel" aria-labelledby="what-h">
      <h2 id="what-h">What should aidev do?</h2>
      <div class="actions">
        <button v-for="s in statuses" :key="s.value" type="button" class="action" :disabled="running" @click="startRun(s.value)">
          <UIcon :name="running && activeStatus === s.value ? 'i-lucide-loader-circle' : s.icon" class="action-icon" :class="{ 'animate-spin': running && activeStatus === s.value }" aria-hidden="true" />
          <span class="action-text">
            <span class="action-label">{{ s.label }}</span>
            <span class="action-hint">{{ s.hint }}</span>
          </span>
        </button>
      </div>
    </section>

    <section class="panel" aria-labelledby="out-h">
      <div class="out-head">
        <h2 id="out-h">Live output</h2>
        <div v-if="lines.length > 0" class="out-actions">
          <UButton color="neutral" variant="ghost" size="sm" :icon="copied ? 'i-lucide-check' : 'i-lucide-copy'" @click="copyOutput">{{ copied ? 'Copied' : 'Copy' }}</UButton>
          <UButton v-if="!running" color="neutral" variant="ghost" size="sm" icon="i-lucide-eraser" @click="lines = []">Clear</UButton>
        </div>
      </div>
      <pre v-if="lines.length > 0" ref="viewer" class="viewer" tabindex="0" aria-label="Run output"><code>{{ text }}</code></pre>
      <p v-else class="empty">Nothing yet. What aidev says while it works will show up here.</p>
    </section>
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
const projectName = computed(() => cwd.value.split(/[\\/]/).filter(Boolean).pop() || 'this project');

const statuses: { value: RunStatus; label: string; hint: string; icon: string }[] = [
  { value: 'open', label: 'Work on new tasks', hint: 'Pick up everything marked open', icon: 'i-lucide-play' },
  { value: 'pending', label: 'Continue waiting tasks', hint: 'After you have answered aidev', icon: 'i-lucide-message-circle-reply' },
  { value: 'review', label: 'Handle review feedback', hint: 'Apply comments on finished work', icon: 'i-lucide-git-pull-request' },
  { value: 'all', label: 'Do all of it', hint: 'New, waiting, and review in one go', icon: 'i-lucide-layers' },
];
const activeLabel = computed(() => statuses.find((s) => s.value === activeStatus.value)?.label ?? 'aidev');

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

const banner = computed(() => {
  if (running.value) {
    return { tone: 'running', title: cancelling.value ? 'Stopping…' : `Running: ${activeLabel.value}`, detail: 'aidev is working. You can leave this page open, output appears below as it happens.' };
  }
  if (lastExit.value) {
    const { code, signal, durationMs } = lastExit.value;
    const dur = formatDuration(durationMs);
    if (signal) return { tone: 'failed', title: 'Stopped before finishing', detail: `The run was stopped (${signal}) after ${dur}.` };
    if (code === 0) return { tone: 'done', title: 'Finished successfully', detail: `Took ${dur}. Check Tasks to see what changed.` };
    return { tone: 'failed', title: 'The run hit a problem', detail: `It ended with an error (code ${code ?? 'unknown'}) after ${dur}. The output below usually says why.` };
  }
  return { tone: 'idle', title: 'Ready when you are', detail: 'Pick what you want aidev to work on.' };
});
const copied = ref(false);
async function copyOutput() {
  try {
    await navigator.clipboard.writeText(text.value);
    copied.value = true;
    setTimeout(() => (copied.value = false), 1500);
  } catch { /* clipboard unavailable */ }
}

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

function parseAutorunQuery(value: unknown): RunStatus | null {
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== 'string' || !raw) return null;
  return statuses.some((s) => s.value === raw) ? (raw as RunStatus) : null;
}

onMounted(() => {
  const autorun = parseAutorunQuery(route.query.autorun);
  if (autorun) startRun(autorun);
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
.run { padding-bottom: 2rem; display: flex; flex-direction: column; gap: 1.25rem; }
.page-head { padding: 0.75rem 0 0.25rem; }
.page-head h1 { margin: 0; font-size: 1.875rem; font-weight: 700; letter-spacing: -0.02em; color: var(--ui-text-highlighted); }
.page-head p { margin: 0.25rem 0 0; color: var(--wb-ink-soft); }
.panel { padding: 1.5rem; border-radius: 1rem; background: var(--ui-bg); border: 1px solid var(--ui-border); }
.panel h2 { margin: 0 0 1rem; font-size: 1.0625rem; font-weight: 700; color: var(--ui-text-highlighted); }

.banner { display: flex; align-items: center; gap: 1rem; flex-wrap: wrap; }
.banner h2 { margin: 0; font-size: 1.125rem; }
.banner p { margin: 0.125rem 0 0; font-size: 0.9375rem; color: var(--wb-ink-soft); }
.banner-text { flex: 1; min-width: 12rem; }
.banner-icon { display: grid; place-items: center; width: 3rem; height: 3rem; border-radius: 0.875rem; background: var(--ui-bg-elevated); color: var(--wb-ink-soft); }
.banner--running .banner-icon { background: color-mix(in oklch, var(--ui-primary) 16%, transparent); color: var(--ui-primary); }
.banner--done .banner-icon { background: color-mix(in oklch, var(--wb-ok) 18%, transparent); color: var(--wb-ok); }
.banner--failed .banner-icon { background: color-mix(in oklch, var(--wb-bad) 16%, transparent); color: var(--wb-bad); }

.actions { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0.75rem; }
.action { display: flex; align-items: center; gap: 0.875rem; min-height: 4rem; padding: 0.75rem 1rem; border-radius: 0.75rem; border: 1px solid var(--ui-border); background: var(--ui-bg); text-align: left; cursor: pointer; transition: border-color 0.15s, background-color 0.15s; }
.action:hover:not(:disabled) { border-color: var(--ui-primary); background: color-mix(in oklch, var(--ui-primary) 6%, transparent); }
.action:focus-visible { outline: 2px solid var(--ui-primary); outline-offset: 2px; }
.action:disabled { opacity: 0.55; cursor: not-allowed; }
.action-icon { width: 1.375rem; height: 1.375rem; color: var(--ui-primary); flex-shrink: 0; }
.action-text { display: flex; flex-direction: column; }
.action-label { font-weight: 600; color: var(--ui-text-highlighted); }
.action-hint { font-size: 0.8125rem; color: var(--wb-ink-soft); }

.out-head { display: flex; align-items: center; justify-content: space-between; gap: 1rem; margin-bottom: 1rem; }
.out-head h2 { margin: 0; }
.out-actions { display: flex; gap: 0.25rem; }
.viewer { margin: 0; padding: 1rem; max-height: 30rem; overflow: auto; border-radius: 0.75rem; background: oklch(21% 0.02 250); color: oklch(92% 0.01 250); font-family: var(--font-mono); font-size: 0.8125rem; line-height: 1.5; white-space: pre; }
.viewer:focus-visible { outline: 2px solid var(--ui-primary); outline-offset: 2px; }
.empty { margin: 0; padding: 2rem 1rem; text-align: center; border: 1px dashed var(--ui-border-accented); border-radius: 0.75rem; color: var(--wb-ink-soft); font-size: 0.9375rem; }

@media (max-width: 700px) {
  .actions { grid-template-columns: 1fr; }
  .panel { padding: 1.125rem; }
}
</style>

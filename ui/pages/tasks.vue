<template>
  <div class="tasks-page">
    <UCard>
      <template #header>
        <div class="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h1 class="text-lg font-semibold">Tasks</h1>
            <p class="text-xs text-gray-500 mt-1">
              <span v-if="data">
                Provider: <code>{{ data.provider }}</code> · {{ data.tasks.length }} task(s)
              </span>
              <span v-else>—</span>
            </p>
          </div>
          <div class="flex items-center gap-2">
            <UButton
              color="gray"
              variant="ghost"
              size="sm"
              :loading="loading"
              :disabled="loading"
              @click="reload"
            >
              Refresh
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

      <div v-if="!data && !loadError" class="empty">
        <p class="empty-title">Loading tasks…</p>
      </div>

      <div v-else-if="data && data.tasks.length === 0" class="empty">
        <p class="empty-title">No tasks</p>
        <p class="empty-sub">
          The provider returned zero tasks for the configured tag scope. Check
          <NuxtLink to="/config" class="link">Config</NuxtLink> to confirm your
          provider keys, list ids, and tag filter.
        </p>
      </div>

      <div v-else-if="data" class="board">
        <div
          v-for="col in columns"
          :key="col.key"
          class="column"
        >
          <header class="col-head">
            <span class="col-title">{{ col.title }}</span>
            <span class="col-count">{{ col.tasks.length }}</span>
          </header>
          <div class="col-body">
            <article
              v-for="task in col.tasks"
              :key="task.id"
              class="card"
              :class="{ 'card--active': activeId === task.id }"
              @click="openTask(task)"
            >
              <div class="card-id">{{ task.id }}</div>
              <div class="card-title">{{ task.name }}</div>
              <div class="card-meta">
                <span class="badge" :title="`status: ${task.status}`">{{ task.status }}</span>
                <span v-if="task.priority" class="badge badge--p">P{{ task.priority }}</span>
                <span v-for="tag in task.tags.slice(0, 3)" :key="tag" class="badge badge--tag">{{ tag }}</span>
              </div>
            </article>
            <p v-if="col.tasks.length === 0" class="col-empty">empty</p>
          </div>
        </div>
      </div>
    </UCard>

    <!-- Task detail drawer -->
    <UModal v-model="drawerOpen" :ui="{ width: 'sm:max-w-2xl' }">
      <UCard v-if="detail">
        <template #header>
          <div class="flex items-start justify-between gap-3">
            <div class="min-w-0">
              <p class="text-xs text-gray-500"><code>{{ detail.task.id }}</code></p>
              <h2 class="text-base font-semibold truncate" :title="detail.task.name">
                {{ detail.task.name }}
              </h2>
              <p class="text-xs text-gray-500 mt-0.5">
                <a v-if="detail.task.url" :href="detail.task.url" target="_blank" rel="noopener" class="link">
                  Open in {{ data?.provider || 'provider' }} ↗
                </a>
              </p>
            </div>
            <UButton size="xs" color="gray" variant="ghost" @click="closeDrawer">Close</UButton>
          </div>
        </template>

        <UAlert
          v-if="detailError"
          color="red"
          variant="soft"
          :title="detailError"
          class="mb-3"
        />

        <section class="drawer-section">
          <h3 class="section-title">Description</h3>
          <pre v-if="detail.task.description" class="desc">{{ detail.task.description }}</pre>
          <p v-else class="muted">No description.</p>
        </section>

        <section class="drawer-section">
          <h3 class="section-title">Status</h3>
          <div class="status-row">
            <USelect
              v-if="statusOptions.length > 0"
              v-model="statusDraft"
              :options="statusOptions"
              size="sm"
            />
            <UInput
              v-else
              v-model="statusDraft"
              placeholder="status name"
              size="sm"
            />
            <UButton
              size="sm"
              color="primary"
              :loading="statusSaving"
              :disabled="statusSaving || !statusDraft || statusDraft === detail.task.status"
              @click="changeStatus"
            >
              Update status
            </UButton>
          </div>
        </section>

        <section class="drawer-section">
          <h3 class="section-title">Comments ({{ detail.comments.length }})</h3>
          <div v-if="detail.comments.length > 0" class="comments">
            <article
              v-for="c in detail.comments"
              :key="c.id"
              class="comment"
            >
              <header class="comment-head">
                <span class="comment-author">{{ c.author || 'unknown' }}</span>
                <span class="comment-date">{{ formatDate(c.date) }}</span>
              </header>
              <pre class="comment-body">{{ c.text }}</pre>
            </article>
          </div>
          <p v-else class="muted">No comments yet.</p>

          <div class="comment-form">
            <UTextarea v-model="commentDraft" placeholder="Write a comment…" :rows="3" />
            <div class="comment-actions">
              <UCheckbox v-model="commentAsAidev" label="Send as [aidev] comment" />
              <UButton
                size="sm"
                color="primary"
                :loading="commentSaving"
                :disabled="commentSaving || !commentDraft.trim()"
                @click="postComment"
              >
                Add comment
              </UButton>
            </div>
          </div>
        </section>

        <section class="drawer-section">
          <h3 class="section-title">Execute</h3>
          <p class="muted">
            Runs <code>aidev run --task {{ detail.task.id }}</code> in
            <code>{{ cwd }}</code>. Streams stdout/stderr live below.
          </p>
          <div class="exec-row">
            <UButton
              size="sm"
              color="primary"
              :disabled="execRunning"
              @click="startExecute"
            >
              {{ execRunning ? 'Running…' : 'Execute task' }}
            </UButton>
            <UButton
              v-if="execRunning"
              size="sm"
              color="red"
              variant="soft"
              @click="stopExecute"
            >
              Cancel
            </UButton>
            <UButton
              v-if="execLines.length > 0 && !execRunning"
              size="xs"
              color="gray"
              variant="ghost"
              @click="execLines = []"
            >
              Clear output
            </UButton>
          </div>
          <pre v-if="execLines.length > 0" ref="execViewer" class="exec-viewer"><code>{{ execText }}</code></pre>
        </section>
      </UCard>
    </UModal>
  </div>
</template>

<script setup lang="ts">
import { useApi } from '~/composables/useApi';

interface UiTask {
  id: string;
  name: string;
  description: string;
  status: string;
  url: string;
  tags: string[];
  priority?: number;
}

interface UiComment {
  id: string;
  text: string;
  author: string;
  authorId: string;
  date: number;
}

interface TasksResponse {
  filter: string;
  provider: string;
  tasks: UiTask[];
  statuses: string[];
  filters: {
    open: string[];
    pending: string[];
    review: string[];
    done: string[];
  };
}

interface TaskDetailResponse {
  task: UiTask;
  comments: UiComment[];
}

const TOKEN_KEY = 'aidev-ui-token';

const api = useApi();
const runtime = useRuntimeConfig();
const cwd = computed(() => runtime.public.aidevCwd as string);

const data = ref<TasksResponse | null>(null);
const loading = ref(false);
const loadError = ref('');

const drawerOpen = ref(false);
const activeId = ref<string | null>(null);
const detail = ref<TaskDetailResponse | null>(null);
const detailError = ref('');

const statusDraft = ref('');
const statusSaving = ref(false);

const commentDraft = ref('');
const commentAsAidev = ref(false);
const commentSaving = ref(false);

const execLines = ref<string[]>([]);
const execRunning = ref(false);
const execViewer = ref<HTMLPreElement | null>(null);
let execAbort: AbortController | null = null;

const execText = computed(() => execLines.value.join('\n'));

// Group tasks into Kanban columns. Priorities:
//   1. Map open/pending/review/done filter statuses (from config) to dedicated
//      columns so the labels are stable across providers.
//   2. Any task whose status doesn't match those four lands in a generic
//      "Other" column at the end — so unmapped statuses still surface, just
//      not under a misleading label.
interface Column {
  key: string;
  title: string;
  match: (status: string) => boolean;
  tasks: UiTask[];
}

const columns = computed<Column[]>(() => {
  if (!data.value) return [];
  const f = data.value.filters;
  const lc = (xs: string[]) => xs.map((s) => s.toLowerCase());
  const open = new Set(lc(f.open));
  const pending = new Set(lc(f.pending));
  const review = new Set(lc(f.review));
  const done = new Set(lc(f.done));

  const cols: Column[] = [
    { key: 'open', title: 'Open', match: (s) => open.has(s.toLowerCase()), tasks: [] },
    { key: 'pending', title: 'Pending', match: (s) => pending.has(s.toLowerCase()), tasks: [] },
    { key: 'review', title: 'In Review', match: (s) => review.has(s.toLowerCase()), tasks: [] },
    { key: 'done', title: 'Done', match: (s) => done.has(s.toLowerCase()), tasks: [] },
    { key: 'other', title: 'Other', match: () => true, tasks: [] },
  ];

  for (const task of data.value.tasks) {
    const col = cols.find((c) => c.match(task.status));
    if (col) col.tasks.push(task);
  }

  // Sort within columns by priority asc (1=urgent first), then by id for stability.
  for (const c of cols) {
    c.tasks.sort((a, b) => {
      const pa = a.priority ?? Number.MAX_SAFE_INTEGER;
      const pb = b.priority ?? Number.MAX_SAFE_INTEGER;
      if (pa !== pb) return pa - pb;
      return a.id.localeCompare(b.id);
    });
  }

  // Hide the "Other" column when empty — keeps the board tidy for providers
  // whose statuses fully map to the four canonical buckets.
  return cols.filter((c) => c.tasks.length > 0 || c.key !== 'other');
});

// Dropdown options for the status editor. Prefer the provider's full board
// status list when available; fall back to the four configured buckets so the
// user can at least move tasks between them.
const statusOptions = computed(() => {
  if (!data.value) return [];
  if (data.value.statuses.length > 0) {
    return data.value.statuses.map((s) => ({ label: s, value: s }));
  }
  const f = data.value.filters;
  const all = [...f.open, ...f.pending, ...f.review, ...f.done];
  const seen = new Set<string>();
  const opts: { label: string; value: string }[] = [];
  for (const s of all) {
    if (!s || seen.has(s)) continue;
    seen.add(s);
    opts.push({ label: s, value: s });
  }
  return opts;
});

function formatDate(epochMs: number): string {
  if (!epochMs) return '';
  try {
    return new Date(epochMs).toLocaleString();
  } catch {
    return '';
  }
}

async function reload() {
  loading.value = true;
  loadError.value = '';
  try {
    data.value = await api<TasksResponse>('/api/tasks');
  } catch (err) {
    loadError.value = err instanceof Error ? err.message : String(err);
  } finally {
    loading.value = false;
  }
}

async function openTask(task: UiTask) {
  activeId.value = task.id;
  drawerOpen.value = true;
  detail.value = { task, comments: [] };
  detailError.value = '';
  statusDraft.value = task.status;
  commentDraft.value = '';
  commentAsAidev.value = false;
  resetExecute();
  try {
    detail.value = await api<TaskDetailResponse>(`/api/tasks/${encodeURIComponent(task.id)}`);
    statusDraft.value = detail.value.task.status;
  } catch (err) {
    detailError.value = err instanceof Error ? err.message : String(err);
  }
}

function closeDrawer() {
  drawerOpen.value = false;
  activeId.value = null;
  resetExecute();
}

async function changeStatus() {
  if (!detail.value || !statusDraft.value) return;
  statusSaving.value = true;
  detailError.value = '';
  try {
    await api(`/api/tasks/${encodeURIComponent(detail.value.task.id)}/status`, {
      method: 'POST',
      body: { status: statusDraft.value },
    });
    detail.value.task.status = statusDraft.value;
    // Reflect the change on the board too without a full refetch.
    const board = data.value?.tasks.find((t) => t.id === detail.value!.task.id);
    if (board) board.status = statusDraft.value;
  } catch (err) {
    detailError.value = err instanceof Error ? err.message : String(err);
  } finally {
    statusSaving.value = false;
  }
}

async function postComment() {
  if (!detail.value || !commentDraft.value.trim()) return;
  commentSaving.value = true;
  detailError.value = '';
  try {
    await api(`/api/tasks/${encodeURIComponent(detail.value.task.id)}/comment`, {
      method: 'POST',
      body: { text: commentDraft.value, asAidev: commentAsAidev.value },
    });
    // Refetch comments so we get the canonical id/date from the provider
    // rather than synthesizing a fake comment row.
    const refreshed = await api<TaskDetailResponse>(
      `/api/tasks/${encodeURIComponent(detail.value.task.id)}`,
    );
    detail.value = refreshed;
    commentDraft.value = '';
  } catch (err) {
    detailError.value = err instanceof Error ? err.message : String(err);
  } finally {
    commentSaving.value = false;
  }
}

function resetExecute() {
  if (execAbort) {
    execAbort.abort();
    execAbort = null;
  }
  execLines.value = [];
  execRunning.value = false;
}

function appendExecLine(prefix: string, line: string) {
  execLines.value.push(prefix ? `${prefix} ${line}` : line);
  nextTick(() => {
    const el = execViewer.value;
    if (el) el.scrollTop = el.scrollHeight;
  });
}

function handleSseEvent(name: string, data: string) {
  if (name === 'stdout') {
    appendExecLine('', data);
  } else if (name === 'stderr') {
    appendExecLine('[stderr]', data);
  } else if (name === 'exit') {
    try {
      const info = JSON.parse(data) as { code: number | null; signal: string | null };
      appendExecLine(
        '',
        `--- exit code ${info.code ?? 'null'}${info.signal ? `, signal ${info.signal}` : ''} ---`,
      );
    } catch {
      appendExecLine('', `--- exit ${data} ---`);
    }
    execRunning.value = false;
  } else if (name === 'error') {
    appendExecLine('[error]', data || 'unknown error');
    execRunning.value = false;
  }
}

async function startExecute() {
  if (!detail.value || execRunning.value) return;
  // EventSource only supports GET. The execute route is POST (it's a side-
  // effecting "spawn this process" action), so we use fetch + a manual SSE
  // parser. Auth header travels in the request like every other API call.
  const token = import.meta.client ? localStorage.getItem(TOKEN_KEY) : null;
  if (!token) {
    detailError.value = 'Not authenticated — refresh and log in again.';
    return;
  }
  execLines.value = [];
  execRunning.value = true;

  const ctrl = new AbortController();
  execAbort = ctrl;
  const taskId = detail.value.task.id;

  try {
    const res = await fetch(`/api/tasks/${encodeURIComponent(taskId)}/execute`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'text/event-stream',
      },
      signal: ctrl.signal,
    });

    if (!res.ok || !res.body) {
      const text = await res.text().catch(() => res.statusText);
      appendExecLine('[error]', `HTTP ${res.status}: ${text || res.statusText}`);
      execRunning.value = false;
      if (execAbort === ctrl) execAbort = null;
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

    // Standard SSE framing: events are separated by a blank line. Each line in
    // an event is either `event: <name>`, `data: <payload>`, or a comment
    // starting with `:`. We ignore `id:` / `retry:` since we don't reconnect.
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
    // Flush a trailing event the server forgot to terminate with a blank line.
    flushEvent();
  } catch (err) {
    if ((err as { name?: string })?.name !== 'AbortError') {
      appendExecLine('[error]', err instanceof Error ? err.message : String(err));
    }
  } finally {
    execRunning.value = false;
    if (execAbort === ctrl) execAbort = null;
  }
}

function stopExecute() {
  if (execAbort) {
    execAbort.abort();
    execAbort = null;
  }
  if (execRunning.value) {
    appendExecLine('', '--- cancelled by user ---');
    execRunning.value = false;
  }
}

watch(drawerOpen, (open) => {
  if (!open) {
    activeId.value = null;
    resetExecute();
  }
});

onMounted(reload);
onBeforeUnmount(() => {
  if (execAbort) {
    execAbort.abort();
    execAbort = null;
  }
});
</script>

<style scoped>
.tasks-page {
  display: flex;
  flex-direction: column;
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

.board {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 0.75rem;
}

.column {
  background: #f1f5f9;
  border-radius: 0.5rem;
  padding: 0.5rem;
  display: flex;
  flex-direction: column;
  min-height: 14rem;
}

.col-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  padding: 0.25rem 0.5rem 0.5rem;
}
.col-title { font-weight: 600; font-size: 0.85rem; color: #334155; }
.col-count {
  font-size: 0.7rem;
  background: #e2e8f0;
  color: #475569;
  border-radius: 9999px;
  padding: 0.1rem 0.5rem;
}

.col-body { display: flex; flex-direction: column; gap: 0.4rem; }
.col-empty {
  font-size: 0.75rem;
  color: #94a3b8;
  text-align: center;
  padding: 1rem 0;
}

.card {
  background: #fff;
  border: 1px solid #e2e8f0;
  border-radius: 0.375rem;
  padding: 0.55rem 0.65rem;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  transition: box-shadow 0.12s ease, border-color 0.12s ease;
}
.card:hover { border-color: #94a3b8; box-shadow: 0 1px 3px rgba(15, 23, 42, 0.08); }
.card--active { border-color: #2563eb; box-shadow: 0 0 0 2px rgba(37, 99, 235, 0.15); }

.card-id {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 0.7rem;
  color: #64748b;
}
.card-title {
  font-size: 0.85rem;
  font-weight: 500;
  color: #0f172a;
  line-height: 1.3;
  word-break: break-word;
}
.card-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem;
  margin-top: 0.1rem;
}
.badge {
  font-size: 0.65rem;
  background: #e2e8f0;
  color: #1e293b;
  border-radius: 0.25rem;
  padding: 0.05rem 0.35rem;
  font-weight: 500;
}
.badge--p { background: #fde68a; color: #78350f; }
.badge--tag { background: #dbeafe; color: #1e3a8a; }

.drawer-section { margin-top: 1rem; }
.drawer-section:first-child { margin-top: 0; }
.section-title {
  font-size: 0.8rem;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: #475569;
  margin-bottom: 0.4rem;
}

.desc {
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 0.375rem;
  padding: 0.6rem 0.75rem;
  font-size: 0.8rem;
  line-height: 1.45;
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 16rem;
  overflow: auto;
  margin: 0;
}

.muted { font-size: 0.85rem; color: #64748b; }

.status-row {
  display: flex;
  gap: 0.5rem;
  align-items: center;
}

.comments {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  max-height: 16rem;
  overflow: auto;
  padding-right: 0.25rem;
}
.comment {
  border: 1px solid #e2e8f0;
  border-radius: 0.375rem;
  padding: 0.5rem 0.65rem;
  background: #fff;
}
.comment-head {
  display: flex;
  justify-content: space-between;
  font-size: 0.7rem;
  color: #64748b;
  margin-bottom: 0.25rem;
}
.comment-author { font-weight: 600; color: #334155; }
.comment-body {
  margin: 0;
  font-size: 0.8rem;
  line-height: 1.4;
  white-space: pre-wrap;
  word-break: break-word;
}

.comment-form {
  margin-top: 0.75rem;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}
.comment-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
}

.exec-row {
  display: flex;
  gap: 0.5rem;
  align-items: center;
  margin: 0.5rem 0;
}

.exec-viewer {
  background: #0f172a;
  color: #e2e8f0;
  border-radius: 0.375rem;
  padding: 0.6rem 0.85rem;
  max-height: 18rem;
  overflow: auto;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 0.75rem;
  line-height: 1.45;
  white-space: pre;
  margin: 0;
}

.link { color: #2563eb; text-decoration: underline; }
.link:hover { color: #1d4ed8; }
</style>

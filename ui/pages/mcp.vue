<template>
  <div class="mcp">
    <header class="page-head">
      <div>
        <h1>Connected tools</h1>
        <p>
          Give your AI extra abilities, like reading files, using GitHub or driving a browser.
          These are called MCP servers. aidev passes them to every AI assistant you use.
          <a href="https://qelos-io.github.io/aidev/guide/mcp" target="_blank" rel="noopener">Learn more</a>
        </p>
        <p class="file-line">
          <UIcon name="i-lucide-file-json" class="size-3.5" aria-hidden="true" />
          <code>{{ fileName }}</code>
          <span v-if="fileExists === false" class="state state--warn">Not created yet. It will be when you save.</span>
          <span v-else-if="fileExists" class="state">Loaded</span>
          <span class="muted">· Change where it lives under <NuxtLink to="/config#files">Settings → Files</NuxtLink>.</span>
        </p>
      </div>
      <div class="head-actions">
        <UButton color="neutral" variant="ghost" icon="i-lucide-refresh-cw" :loading="loading" :disabled="loading || dirty" @click="reload">Reload</UButton>
      </div>
    </header>

    <UAlert v-if="loadError" color="error" variant="soft" icon="i-lucide-triangle-alert" title="Something went wrong" :description="loadError" class="mb-5" />

    <div class="tabs" role="tablist" aria-label="Edit mode">
      <button type="button" role="tab" class="tab" :class="{ 'tab--on': !rawMode }" :aria-selected="!rawMode" @click="leaveRaw">
        <UIcon name="i-lucide-layout-list" class="size-4" aria-hidden="true" /> Guided
      </button>
      <button type="button" role="tab" class="tab" :class="{ 'tab--on': rawMode }" :aria-selected="rawMode" @click="rawMode = true">
        <UIcon name="i-lucide-braces" class="size-4" aria-hidden="true" /> JSON
      </button>
    </div>

    <!-- JSON -->
    <section v-if="rawMode" class="panel" aria-labelledby="raw-h">
      <h2 id="raw-h">Edit as JSON</h2>
      <p class="sub">For people who already have a config to paste in. “Apply to guided view” checks it and switches back.</p>
      <label for="raw-json" class="sr-only">mcpServers JSON</label>
      <textarea id="raw-json" v-model="rawText" class="code-area raw" spellcheck="false" @input="rawError = ''" />
      <p v-if="rawError" class="err" role="alert">That JSON isn't valid: {{ rawError }}</p>
      <UButton color="neutral" variant="soft" icon="i-lucide-arrow-left-right" class="mt-3" @click="applyRawText">Apply to guided view</UButton>
    </section>

    <!-- Guided -->
    <section v-else class="panel" aria-labelledby="srv-h">
      <div class="panel-head">
        <h2 id="srv-h">Your tools <span class="count">{{ servers.length }}</span></h2>
        <div class="add-row">
          <UDropdownMenu :items="quickAddItems" :content="{ align: 'end' }">
            <UButton color="neutral" variant="soft" icon="i-lucide-sparkles" trailing-icon="i-lucide-chevron-down">Quick add</UButton>
          </UDropdownMenu>
          <UButton icon="i-lucide-plus" @click="addServer()">Add a tool</UButton>
        </div>
      </div>

      <div v-if="servers.length === 0" class="empty">
        <UIcon name="i-lucide-plug" class="size-8" aria-hidden="true" />
        <p><strong>No tools connected yet.</strong></p>
        <p>Try “Quick add” to connect a popular one in a click.</p>
      </div>

      <ul v-else class="servers">
        <li v-for="server in servers" :key="server.uid">
          <McpServerCard :server="server" @remove="removeServer(server.uid)" />
        </li>
      </ul>
    </section>

    <SaveBar :dirty="dirty" :saving="saving" :saved="saved" saved-text="Saved. Your tools will be used on the next run." @save="save" @discard="discard" />
  </div>
</template>

<script setup lang="ts">
import { useApi } from '~/composables/useApi';

interface McpServerDef { command?: string; args?: string[]; env?: Record<string, string>; url?: string; enabled?: boolean }
interface McpFileResult { path: string; exists: boolean; servers: Record<string, McpServerDef>; betterMcp: boolean; betterMcpConfigPath: string }
interface ServerRow { uid: number; name: string; command: string; argsText: string; envText: string; url: string; remote?: boolean }

const api = useApi();

const filePath = ref('');
const fileName = computed(() => filePath.value.split(/[\\/]/).pop() || 'mcp.json');
const fileExists = ref<boolean | null>(null);
const loading = ref(false);
const loadError = ref('');
const saving = ref(false);
const saved = ref(false);

const rawMode = ref(false);
const rawText = ref('');
const rawError = ref('');

let nextUid = 0;
const servers = ref<ServerRow[]>([]);
// Snapshots as last loaded/saved — used to detect dirty state in each view.
const original = ref('');
const originalRaw = ref('');
let savedTimer: ReturnType<typeof setTimeout> | null = null;

const QUICK_ADD: { label: string; hint: string; icon: string; row: Omit<ServerRow, 'uid'> }[] = [
  { label: 'Files', hint: 'Read and edit files in this folder', icon: 'i-lucide-folder', row: { name: 'files', command: 'npx', argsText: '-y @modelcontextprotocol/server-filesystem .', envText: '', url: '' } },
  { label: 'GitHub', hint: 'Work with repos, issues and pull requests', icon: 'i-simple-icons-github', row: { name: 'github', command: 'npx', argsText: '-y @modelcontextprotocol/server-github', envText: 'GITHUB_PERSONAL_ACCESS_TOKEN=', url: '' } },
  { label: 'Browser', hint: 'Let the AI open and test web pages', icon: 'i-simple-icons-playwright', row: { name: 'browser', command: 'npx', argsText: '@playwright/mcp@latest', envText: '', url: '' } },
];
const quickAddItems = computed(() => [
  QUICK_ADD.map((q) => ({ label: q.label, description: q.hint, icon: q.icon, onSelect: () => addServer(q.row) })),
]);

function isRemote(s: ServerRow): boolean {
  return s.remote ?? !!s.url.trim();
}
function rowsToServers(rows: ServerRow[]): Record<string, McpServerDef> {
  const out: Record<string, McpServerDef> = {};
  for (const row of rows) {
    if (!row.name.trim()) continue;
    const def: McpServerDef = {};
    if (isRemote(row) && row.url.trim()) {
      def.url = row.url.trim();
    } else if (!isRemote(row)) {
      if (row.command.trim()) def.command = row.command.trim();
      const args = row.argsText.trim().split(/\s+/).filter(Boolean);
      if (args.length) def.args = args;
    }
    const env: Record<string, string> = {};
    for (const line of row.envText.split('\n')) {
      const eq = line.indexOf('=');
      if (eq === -1) continue;
      const key = line.slice(0, eq).trim();
      if (key) env[key] = line.slice(eq + 1).trim();
    }
    if (Object.keys(env).length) def.env = env;
    out[row.name.trim()] = def;
  }
  return out;
}

function serversToRows(data: Record<string, McpServerDef>): ServerRow[] {
  return Object.entries(data).map(([name, def]) => ({
    uid: nextUid++,
    name,
    command: def.command ?? '',
    argsText: (def.args ?? []).join(' '),
    envText: Object.entries(def.env ?? {}).map(([k, v]) => `${k}=${v}`).join('\n'),
    url: def.url ?? '',
  }));
}

function serialize(data: Record<string, McpServerDef>): string {
  return JSON.stringify(data, Object.keys(data).sort());
}

const dirty = computed(() =>
  rawMode.value ? rawText.value !== originalRaw.value : serialize(rowsToServers(servers.value)) !== original.value,
);

function applyData(data: McpFileResult) {
  filePath.value = data.path;
  fileExists.value = data.exists;
  servers.value = serversToRows(data.servers);
  original.value = serialize(data.servers);
  rawText.value = JSON.stringify({ mcpServers: data.servers }, null, 2);
  originalRaw.value = rawText.value;
  rawError.value = '';
}

function addServer(preset?: Omit<ServerRow, 'uid'>) {
  const base = preset ?? { name: '', command: 'npx', argsText: '', envText: '', url: '' };
  let name = base.name;
  if (name && servers.value.some((s) => s.name === name)) name = `${name}-${servers.value.length + 1}`;
  servers.value.push({ ...base, name, uid: nextUid++ });
}
function removeServer(uid: number) {
  servers.value = servers.value.filter((s) => s.uid !== uid);
}

function applyRawText() {
  try {
    const parsed = JSON.parse(rawText.value);
    const mcpServers = parsed?.mcpServers && typeof parsed.mcpServers === 'object' ? parsed.mcpServers : parsed;
    if (!mcpServers || typeof mcpServers !== 'object') throw new Error('Expected an object');
    servers.value = serversToRows(mcpServers);
    rawError.value = '';
    rawMode.value = false;
  } catch (err) {
    rawError.value = err instanceof Error ? err.message : String(err);
  }
}
function leaveRaw() {
  if (!rawMode.value) return;
  if (rawText.value === originalRaw.value) rawMode.value = false;
  else applyRawText();
}

function discard() {
  servers.value = serversToRows(JSON.parse(originalRaw.value).mcpServers ?? {});
  rawText.value = originalRaw.value;
  rawError.value = '';
}

async function reload() {
  loading.value = true;
  loadError.value = '';
  try {
    applyData(await api<McpFileResult>('/api/mcp'));
  } catch (err) {
    loadError.value = err instanceof Error ? err.message : String(err);
  } finally {
    loading.value = false;
  }
}

async function save() {
  if (rawMode.value) {
    applyRawText();
    if (rawError.value) return;
  }
  saving.value = true;
  saved.value = false;
  loadError.value = '';
  try {
    applyData(await api<McpFileResult>('/api/mcp', { method: 'PUT', body: { servers: rowsToServers(servers.value) } }));
    saved.value = true;
    if (savedTimer) clearTimeout(savedTimer);
    savedTimer = setTimeout(() => (saved.value = false), 3000);
  } catch (err) {
    loadError.value = err instanceof Error ? err.message : String(err);
  } finally {
    saving.value = false;
  }
}

onBeforeRouteLeave(() => (dirty.value ? window.confirm('You have unsaved changes. Leave without saving?') : true));
onMounted(reload);
onBeforeUnmount(() => { if (savedTimer) clearTimeout(savedTimer); });
</script>

<style scoped>
.mcp { padding-bottom: 2rem; }
.page-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 1rem; padding: 0.75rem 0 1.25rem; }
.page-head h1 { margin: 0; font-size: 1.875rem; font-weight: 700; letter-spacing: -0.02em; color: var(--ui-text-highlighted); }
.page-head p { margin: 0.25rem 0 0; color: var(--wb-ink-soft); max-width: 46rem; }
.page-head a { color: var(--ui-primary); font-weight: 600; text-underline-offset: 2px; }
.file-line { display: flex; align-items: center; flex-wrap: wrap; gap: 0.375rem; font-size: 0.8125rem; }
.file-line code { font-family: var(--font-mono); }
.state { color: var(--wb-ok); font-weight: 600; }
.state--warn { color: var(--wb-wait); }
.muted { color: var(--wb-ink-soft); }

.tabs { display: flex; gap: 0.25rem; padding: 0.25rem; margin-bottom: 1rem; width: fit-content; border-radius: 0.875rem; background: var(--ui-bg-elevated); }
.tab { display: inline-flex; align-items: center; gap: 0.5rem; min-height: 2.5rem; padding: 0 1rem; border: 0; border-radius: 0.625rem; background: transparent; color: var(--wb-ink-soft); font-size: 0.9375rem; font-weight: 600; cursor: pointer; transition: background-color 0.15s, color 0.15s; }
.tab:hover { color: var(--ui-text-highlighted); }
.tab:focus-visible { outline: 2px solid var(--ui-primary); outline-offset: 2px; }
.tab--on { background: var(--ui-bg); color: var(--ui-text-highlighted); box-shadow: 0 1px 2px rgb(0 0 0 / 0.1); }

.panel { padding: 1.5rem; border-radius: 1rem; background: var(--ui-bg); border: 1px solid var(--ui-border); }
.panel h2 { margin: 0; font-size: 1.0625rem; font-weight: 700; color: var(--ui-text-highlighted); }
.panel-head { display: flex; align-items: center; justify-content: space-between; gap: 1rem; flex-wrap: wrap; margin-bottom: 1.25rem; }
.add-row { display: flex; gap: 0.5rem; }
.count { margin-left: 0.375rem; font-size: 0.75rem; padding: 0.125rem 0.5rem; border-radius: 999px; background: var(--ui-bg-elevated); color: var(--wb-ink-soft); vertical-align: middle; }
.sub { margin: 0.25rem 0 1rem; font-size: 0.9375rem; color: var(--wb-ink-soft); }

.empty { display: flex; flex-direction: column; align-items: center; gap: 0.25rem; padding: 2.5rem 1rem; text-align: center; color: var(--wb-ink-soft); }
.empty p { margin: 0; }
.empty strong { color: var(--ui-text-highlighted); }

.servers { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 1rem; }
.code-area { width: 100%; padding: 0.75rem; font-family: var(--font-mono); font-size: 0.8125rem; line-height: 1.5; resize: vertical; border: 1px solid var(--ui-border-accented); border-radius: 0.625rem; background: var(--ui-bg); color: var(--ui-text); }
.code-area:focus { outline: 2px solid var(--ui-primary); outline-offset: 1px; }
.code-area.raw { min-height: 22rem; }
.err { margin: 0.5rem 0 0; font-size: 0.875rem; color: var(--ui-error); }
.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }

@media (max-width: 700px) {
  .panel { padding: 1rem; }
}
</style>

<template>
  <div class="mcp-page">
    <UCard>
      <template #header>
        <div class="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h1 class="text-lg font-semibold">MCP servers</h1>
            <p class="text-xs text-gray-500 mt-1">
              <code>{{ filePath || '—' }}</code>
              <span v-if="fileExists === false" class="ml-2 text-amber-600">not found</span>
              <span v-else-if="fileExists" class="ml-2 text-emerald-600">loaded</span>
            </p>
          </div>
          <div class="flex items-center gap-2 flex-wrap">
            <UButton size="sm" color="neutral" variant="soft" @click="rawMode = !rawMode">
              {{ rawMode ? 'Form view' : 'Raw JSON' }}
            </UButton>
            <UButton color="neutral" variant="ghost" size="sm" :loading="loading" :disabled="loading" @click="reload">
              Reload
            </UButton>
            <UButton color="primary" size="sm" :loading="saving" :disabled="saving || !dirty" @click="save">
              Save changes
            </UButton>
          </div>
        </div>
      </template>

      <UAlert v-if="loadError" color="red" variant="soft" :title="loadError" class="mb-4" />
      <UAlert v-if="saved" color="green" variant="soft" title="Saved" class="mb-4" />

      <p class="text-sm text-gray-500">
        Translated into every configured agent's own MCP convention before each run — see
        <a href="https://qelos-io.github.io/aidev/guide/mcp" target="_blank" rel="noopener" class="underline">the MCP guide</a>.
        Set <code>MCP_JSON_PATH</code> on the <NuxtLink to="/config" class="underline">Config</NuxtLink> page to change where this file lives.
      </p>
    </UCard>

    <!-- Raw JSON escape hatch -->
    <UCard v-if="rawMode" class="mt-4">
      <template #header>
        <h2 class="text-base font-semibold">Raw mcpServers JSON</h2>
      </template>
      <textarea
        v-model="rawText"
        class="raw-json-editor"
        spellcheck="false"
        @input="rawError = ''"
      />
      <p v-if="rawError" class="text-sm text-red-500 mt-2">{{ rawError }}</p>
      <div class="mt-3">
        <UButton size="sm" color="neutral" variant="soft" @click="applyRawText">
          Apply to form
        </UButton>
      </div>
    </UCard>

    <!-- Form view -->
    <UCard v-else class="mt-4">
      <template #header>
        <div class="flex items-center justify-between gap-3">
          <h2 class="text-base font-semibold">Servers</h2>
          <UButton size="sm" color="neutral" variant="soft" icon="i-heroicons-plus" @click="addServer">
            Add server
          </UButton>
        </div>
      </template>

      <p v-if="servers.length === 0" class="text-sm text-gray-500">
        No servers configured. Use "Add server" to introduce one.
      </p>

      <div class="space-y-3">
        <div
          v-for="server in servers"
          :key="server.uid"
          class="server-block rounded-lg border border-gray-200 dark:border-gray-700 p-4"
        >
          <div class="flex items-center justify-between gap-3 mb-3">
            <UFormField label="Name" class="flex-1 max-w-xs">
              <UInput v-model="server.name" placeholder="fs" />
            </UFormField>
            <UButton
              size="xs"
              color="red"
              variant="ghost"
              icon="i-heroicons-trash"
              aria-label="Remove server"
              @click="removeServer(server.uid)"
            />
          </div>

          <div class="grid gap-4 md:grid-cols-2">
            <UFormField label="URL" help="Set for a remote server instead of command/args.">
              <UInput v-model="server.url" placeholder="https://mcp.example.com" />
            </UFormField>
            <UFormField label="Command" help="Local server executable, e.g. npx.">
              <UInput v-model="server.command" placeholder="npx" :disabled="!!server.url" />
            </UFormField>
            <UFormField label="Args" help="Space-separated." class="md:col-span-2">
              <UInput v-model="server.argsText" placeholder="-y @modelcontextprotocol/server-filesystem ." :disabled="!!server.url" />
            </UFormField>
            <UFormField label="Env" help="One KEY=VALUE per line." class="md:col-span-2">
              <textarea v-model="server.envText" class="env-editor" spellcheck="false" placeholder="TOKEN=..." />
            </UFormField>
          </div>
        </div>
      </div>
    </UCard>
  </div>
</template>

<script setup lang="ts">
import { useApi } from '~/composables/useApi';

interface McpServerDef {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  enabled?: boolean;
}

interface McpFileResult {
  path: string;
  exists: boolean;
  servers: Record<string, McpServerDef>;
  betterMcp: boolean;
  betterMcpConfigPath: string;
}

interface ServerRow {
  uid: number;
  name: string;
  command: string;
  argsText: string;
  envText: string;
  url: string;
}

const api = useApi();

const filePath = ref('');
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

function rowsToServers(rows: ServerRow[]): Record<string, McpServerDef> {
  const out: Record<string, McpServerDef> = {};
  for (const row of rows) {
    if (!row.name.trim()) continue;
    const def: McpServerDef = {};
    if (row.url.trim()) {
      def.url = row.url.trim();
    } else {
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
  rawMode.value
    ? rawText.value !== originalRaw.value
    : serialize(rowsToServers(servers.value)) !== original.value,
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

function addServer() {
  servers.value.push({ uid: nextUid++, name: '', command: 'npx', argsText: '', envText: '', url: '' });
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

async function reload() {
  loading.value = true;
  loadError.value = '';
  try {
    const data = await api<McpFileResult>('/api/mcp');
    applyData(data);
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
    const data = await api<McpFileResult>('/api/mcp', {
      method: 'PUT',
      body: { servers: rowsToServers(servers.value) },
    });
    applyData(data);
    saved.value = true;
    setTimeout(() => (saved.value = false), 3000);
  } catch (err) {
    loadError.value = err instanceof Error ? err.message : String(err);
  } finally {
    saving.value = false;
  }
}

onMounted(reload);
</script>

<style scoped>
.mcp-page {
  display: flex;
  flex-direction: column;
}

.server-block {
  background: rgb(var(--color-gray-50) / 0.5);
}

:root.dark .server-block {
  background: rgb(var(--color-gray-900) / 0.35);
}

.raw-json-editor,
.env-editor {
  width: 100%;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.8rem;
  border: 1px solid rgb(var(--color-gray-200));
  border-radius: 0.375rem;
  padding: 0.5rem;
  background: transparent;
  resize: vertical;
}

.raw-json-editor {
  min-height: 320px;
}

.env-editor {
  min-height: 60px;
}

:root.dark .raw-json-editor,
:root.dark .env-editor {
  border-color: rgb(var(--color-gray-700));
}
</style>

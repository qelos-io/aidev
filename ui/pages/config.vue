<template>
  <div class="config-page">
    <UCard>
      <template #header>
        <div class="flex items-center justify-between gap-3">
          <div>
            <h1 class="text-lg font-semibold">Config</h1>
            <p class="text-xs text-gray-500 mt-1">
              <code>{{ filePath || '—' }}</code>
              <span v-if="fileExists === false" class="ml-2 text-amber-600">not found</span>
              <span v-else-if="fileExists" class="ml-2 text-emerald-600">loaded</span>
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
              Reload
            </UButton>
            <UButton
              color="primary"
              size="sm"
              :loading="saving"
              :disabled="saving || !dirty"
              @click="save"
            >
              Save changes
            </UButton>
          </div>
        </div>
      </template>

      <UAlert
        v-if="loadError"
        color="red"
        variant="soft"
        :title="loadError"
        class="mb-4"
      />

      <UAlert
        v-if="fileExists === false"
        color="amber"
        variant="soft"
        title=".env.aidev does not exist"
        description="Press “Create with defaults” to seed the file with the minimum keys needed to start configuring."
        class="mb-4"
      >
        <template #actions>
          <UButton size="sm" color="amber" :loading="saving" @click="createDefaults">
            Create with defaults
          </UButton>
        </template>
      </UAlert>

      <div v-if="saved" class="mb-4">
        <UAlert color="green" variant="soft" title="Saved" :description="`Wrote ${savedCount} key(s).`" />
      </div>
    </UCard>

    <!-- Task provider -->
    <UCard class="mt-4">
      <template #header>
        <div class="flex items-center justify-between gap-3">
          <h2 class="text-base font-semibold">Task provider</h2>
          <UButton
            size="sm"
            color="gray"
            variant="soft"
            :loading="testing.provider"
            :disabled="testing.provider"
            @click="testProvider"
          >
            Test connection
          </UButton>
        </div>
      </template>

      <div class="grid gap-4 md:grid-cols-2">
        <UFormGroup label="PROVIDER" help="Which task backend aidev should talk to.">
          <USelect v-model="kv.PROVIDER" :options="providerOptions" />
        </UFormGroup>
        <template v-for="field in providerFields" :key="field.key">
          <UFormGroup :label="field.key" :help="field.help">
            <UInput
              v-model="kv[field.key]"
              :type="field.secret ? 'password' : 'text'"
              :placeholder="field.placeholder ?? ''"
              autocomplete="off"
            />
          </UFormGroup>
        </template>
      </div>

      <UAlert
        v-if="testResults.provider"
        :color="testResults.provider.ok ? 'green' : 'red'"
        variant="soft"
        :title="testResults.provider.ok ? 'Provider OK' : 'Provider failed'"
        :description="testResults.provider.message"
        class="mt-3"
      />
    </UCard>

    <!-- AI runners -->
    <UCard class="mt-4">
      <template #header>
        <div class="flex items-center justify-between gap-3">
          <h2 class="text-base font-semibold">AI runners</h2>
          <div class="flex items-center gap-2">
            <USelect
              v-model="testAgent"
              :options="agentTestOptions"
              size="sm"
              class="w-44"
            />
            <UButton
              size="sm"
              color="gray"
              variant="soft"
              :loading="testing.ai"
              :disabled="testing.ai || !testAgent"
              @click="testAi"
            >
              Test {{ testAgent || 'agent' }}
            </UButton>
          </div>
        </div>
      </template>

      <div class="grid gap-4 md:grid-cols-2">
        <UFormGroup
          label="AGENTS"
          help="Comma-separated agents in fallback order (first is primary)."
        >
          <UInput v-model="kv.AGENTS" placeholder="claude,cursor" />
        </UFormGroup>
        <UFormGroup label="CLAUDE_MODEL" help="Model passed to `claude --model`.">
          <UInput v-model="kv.CLAUDE_MODEL" placeholder="opusplan" />
        </UFormGroup>
        <UFormGroup
          label="ANTHROPIC_API_KEY"
          help="Used by the anthropic-sdk runner. Accepts a comma-separated pool."
        >
          <UInput v-model="kv.ANTHROPIC_API_KEY" type="password" autocomplete="off" />
        </UFormGroup>
        <UFormGroup label="ANTHROPIC_MODEL">
          <UInput v-model="kv.ANTHROPIC_MODEL" placeholder="claude-opus-4-6" />
        </UFormGroup>
        <UFormGroup label="ANTHROPIC_BASE_URL" help="Optional — leave blank for default.">
          <UInput v-model="kv.ANTHROPIC_BASE_URL" placeholder="https://api.anthropic.com" />
        </UFormGroup>
      </div>

      <UAlert
        v-if="testResults.ai"
        :color="testResults.ai.ok ? 'green' : 'red'"
        variant="soft"
        :title="testResults.ai.ok ? 'AI runner OK' : 'AI runner failed'"
        :description="testResults.ai.message"
        class="mt-3"
      />
    </UCard>

    <!-- Logging -->
    <UCard class="mt-4">
      <template #header>
        <h2 class="text-base font-semibold">Logging</h2>
      </template>
      <div class="grid gap-4 md:grid-cols-2">
        <UFormGroup
          label="AIDEV_LOG_PATH"
          help="Path to the aidev log file. Defaults to ./aidev.log when blank."
        >
          <UInput v-model="kv.AIDEV_LOG_PATH" placeholder="aidev.log" />
        </UFormGroup>
      </div>
    </UCard>

    <!-- Workflow & Git -->
    <UCard class="mt-4">
      <template #header>
        <h2 class="text-base font-semibold">Workflow & Git</h2>
      </template>
      <div class="grid gap-4 md:grid-cols-2">
        <UFormGroup label="DEV_NOTES_MODE" help="smart — ask only when unclear; always — ask before every task.">
          <USelect v-model="kv.DEV_NOTES_MODE" :options="devNotesModeOptions" />
        </UFormGroup>
        <UFormGroup label="ASSIGNEE_TAG" help="Optional tag to scope tasks to a specific assignee.">
          <UInput v-model="kv.ASSIGNEE_TAG" />
        </UFormGroup>
        <UFormGroup label="AIDEV_TRIGGER_WORD" help="Word that resumes a paused agent run.">
          <UInput v-model="kv.AIDEV_TRIGGER_WORD" placeholder="aidev-continue" />
        </UFormGroup>
        <UFormGroup label="THINKING_TAG" help="Tasks with this tag are broken into sub-tasks first.">
          <UInput v-model="kv.THINKING_TAG" placeholder="thinking" />
        </UFormGroup>
        <UFormGroup label="PLANNING_TAG" help="Tasks with this tag are split into sub-tickets.">
          <UInput v-model="kv.PLANNING_TAG" placeholder="planning" />
        </UFormGroup>
        <UFormGroup label="ACCEPTED_TAG" help="Tag marking a task as accepted for implementation.">
          <UInput v-model="kv.ACCEPTED_TAG" placeholder="accepted" />
        </UFormGroup>
        <UFormGroup label="DONE_STATUS" help="Provider status treated as done/closed.">
          <UInput v-model="kv.DONE_STATUS" />
        </UFormGroup>
        <UFormGroup label="AIDEV_COMMENT_PREFIX" help="Prefix for aidev comments on tasks.">
          <UInput v-model="kv.AIDEV_COMMENT_PREFIX" placeholder="[aidev]" />
        </UFormGroup>
        <UFormGroup label="AIDEV_HOOKS_PATH" help="Optional hooks module (.ts or .js).">
          <UInput v-model="kv.AIDEV_HOOKS_PATH" placeholder=".aidev/aidev.hooks.ts" />
        </UFormGroup>
        <UFormGroup label="AIDEV_AUTO_COMPRESS" help="Set false/0/no to disable prompt compression.">
          <UInput v-model="kv.AIDEV_AUTO_COMPRESS" placeholder="true" />
        </UFormGroup>
        <UFormGroup label="AIDEV_COMPRESS_THRESHOLD" help="Char count that triggers compression.">
          <UInput v-model="kv.AIDEV_COMPRESS_THRESHOLD" placeholder="12000" />
        </UFormGroup>
        <UFormGroup label="GIT_REMOTE">
          <UInput v-model="kv.GIT_REMOTE" placeholder="origin" />
        </UFormGroup>
        <UFormGroup label="GITHUB_BASE_BRANCH">
          <UInput v-model="kv.GITHUB_BASE_BRANCH" placeholder="main" />
        </UFormGroup>
        <UFormGroup label="GITHUB_REPO" help="owner/repo — auto-detected when blank.">
          <UInput v-model="kv.GITHUB_REPO" placeholder="owner/repo" />
        </UFormGroup>
      </div>
    </UCard>

    <!-- Other keys -->
    <UCard class="mt-4">
      <template #header>
        <div class="flex items-center justify-between gap-3">
          <h2 class="text-base font-semibold">Other keys</h2>
          <UButton size="xs" color="gray" variant="ghost" @click="addKeyDialog = true">
            + Add key
          </UButton>
        </div>
      </template>
      <p v-if="otherKeys.length === 0" class="text-sm text-gray-500">
        No additional keys. Use “Add key” to introduce one.
      </p>
      <div v-else class="grid gap-4 md:grid-cols-2">
        <UFormGroup
          v-for="key in otherKeys"
          :key="key"
          :label="key"
        >
          <div class="flex items-center gap-2">
            <UInput
              v-model="kv[key]"
              :type="isSecretKey(key) ? 'password' : 'text'"
              autocomplete="off"
              class="flex-1"
            />
            <UButton
              size="xs"
              color="red"
              variant="ghost"
              icon="i-heroicons-trash"
              @click="removeKey(key)"
            />
          </div>
        </UFormGroup>
      </div>
    </UCard>

    <!-- Add-key dialog -->
    <UModal v-model="addKeyDialog">
      <UCard>
        <template #header>
          <h3 class="text-base font-semibold">Add config key</h3>
        </template>
        <div class="space-y-3">
          <UFormGroup label="Key" help="Letters, numbers, and underscores. Must start with a letter or underscore.">
            <UInput v-model="newKey" placeholder="MY_NEW_KEY" autofocus />
          </UFormGroup>
          <UFormGroup label="Value">
            <UInput v-model="newValue" autocomplete="off" />
          </UFormGroup>
          <p v-if="newKeyError" class="text-sm text-red-500">{{ newKeyError }}</p>
        </div>
        <template #footer>
          <div class="flex justify-end gap-2">
            <UButton variant="ghost" color="gray" @click="closeAddKey">Cancel</UButton>
            <UButton color="primary" @click="commitAddKey">Add</UButton>
          </div>
        </template>
      </UCard>
    </UModal>
  </div>
</template>

<script setup lang="ts">
import { useApi } from '~/composables/useApi';

interface EnvFileResult {
  path: string;
  exists: boolean;
  values: Record<string, string>;
  keys: string[];
}

interface TestResult {
  ok: boolean;
  message: string;
}

interface KnownField {
  key: string;
  help?: string;
  placeholder?: string;
  secret?: boolean;
}

const api = useApi();

const filePath = ref('');
const fileExists = ref<boolean | null>(null);
const loading = ref(false);
const loadError = ref('');

const saving = ref(false);
const saved = ref(false);
const savedCount = ref(0);

const kv = reactive<Record<string, string>>({});
// Snapshot of values as last read from disk — used to detect dirty state.
const original = reactive<Record<string, string>>({});

const testing = reactive({ provider: false, ai: false });
const testResults = reactive<{ provider: TestResult | null; ai: TestResult | null }>({
  provider: null,
  ai: null,
});
const testAgent = ref('');

const addKeyDialog = ref(false);
const newKey = ref('');
const newValue = ref('');
const newKeyError = ref('');

const providerOptions = [
  { label: 'ClickUp', value: 'clickup' },
  { label: 'Jira', value: 'jira' },
  { label: 'Linear', value: 'linear' },
  { label: 'Monday', value: 'monday' },
  { label: 'Notion', value: 'notion' },
  { label: 'Trello', value: 'trello' },
  { label: 'Local', value: 'local' },
];

const agentTestOptions = [
  { label: 'claude', value: 'claude' },
  { label: 'cursor', value: 'cursor' },
  { label: 'codex', value: 'codex' },
  { label: 'antigravity', value: 'antigravity' },
  { label: 'windsurf', value: 'windsurf' },
  { label: 'anthropic-sdk', value: 'anthropic-sdk' },
];

// Provider-specific field sets. The form always renders the active provider's
// keys so the user can switch backends without leaving the page.
const PROVIDER_FIELDS: Record<string, KnownField[]> = {
  clickup: [
    { key: 'CLICKUP_API_KEY', secret: true },
    { key: 'CLICKUP_TEAM_ID' },
    { key: 'CLICKUP_TAG', help: 'Tag used to scope tasks to this project.' },
    { key: 'CLICKUP_LIST_ID', help: 'Optional — required to create tasks.' },
    { key: 'CLICKUP_PENDING_STATUS', placeholder: 'pending' },
    { key: 'CLICKUP_OPEN_STATUS', placeholder: 'open' },
    { key: 'CLICKUP_IN_REVIEW_STATUS', placeholder: 'review' },
  ],
  jira: [
    { key: 'JIRA_BASE_URL', placeholder: 'https://mycompany.atlassian.net' },
    { key: 'JIRA_EMAIL' },
    { key: 'JIRA_API_TOKEN', secret: true },
    { key: 'JIRA_PROJECT' },
    { key: 'JIRA_LABEL' },
    { key: 'JIRA_PENDING_STATUS', placeholder: 'To Do' },
    { key: 'JIRA_IN_REVIEW_STATUS', placeholder: 'In Review' },
  ],
  linear: [
    { key: 'LINEAR_API_KEY', secret: true },
    { key: 'LINEAR_TEAM_ID' },
    { key: 'LINEAR_LABEL' },
    { key: 'LINEAR_PENDING_STATUS', placeholder: 'Pending' },
    { key: 'LINEAR_IN_REVIEW_STATUS', placeholder: 'In Review' },
  ],
  monday: [
    { key: 'MONDAY_API_TOKEN', secret: true },
    { key: 'MONDAY_BOARD_ID' },
    { key: 'MONDAY_STATUS_COLUMN_ID', placeholder: 'status' },
    { key: 'MONDAY_GROUP_ID' },
  ],
  notion: [
    { key: 'NOTION_API_KEY', secret: true },
    { key: 'NOTION_DATABASE_ID' },
    { key: 'NOTION_STATUS_PROPERTY', placeholder: 'Status' },
    { key: 'NOTION_PENDING_STATUS', placeholder: 'pending' },
    { key: 'NOTION_IN_REVIEW_STATUS', placeholder: 'review' },
  ],
  trello: [
    { key: 'TRELLO_API_KEY', secret: true },
    { key: 'TRELLO_TOKEN', secret: true },
    { key: 'TRELLO_BOARD_ID' },
    { key: 'TRELLO_LABEL' },
    { key: 'TRELLO_OPEN_LIST', placeholder: 'To Do' },
    { key: 'TRELLO_PENDING_LIST', placeholder: 'Blocked' },
    { key: 'TRELLO_IN_PROGRESS_LIST', placeholder: 'Doing' },
    { key: 'TRELLO_IN_REVIEW_LIST', placeholder: 'In Review' },
  ],
  local: [],
};

const KNOWN_AI_KEYS = [
  'AGENTS',
  'CLAUDE_MODEL',
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_MODEL',
  'ANTHROPIC_BASE_URL',
];
const devNotesModeOptions = [
  { label: 'smart', value: 'smart' },
  { label: 'always', value: 'always' },
];

const KNOWN_WORKFLOW_KEYS = [
  'DEV_NOTES_MODE',
  'ASSIGNEE_TAG',
  'AIDEV_TRIGGER_WORD',
  'THINKING_TAG',
  'PLANNING_TAG',
  'ACCEPTED_TAG',
  'DONE_STATUS',
  'AIDEV_COMMENT_PREFIX',
  'AIDEV_HOOKS_PATH',
  'AIDEV_AUTO_COMPRESS',
  'AIDEV_COMPRESS_THRESHOLD',
  'GIT_REMOTE',
  'GITHUB_BASE_BRANCH',
  'GITHUB_REPO',
];
const KNOWN_LOG_KEYS = ['AIDEV_LOG_PATH'];
const KNOWN_PROVIDER_SELECT_KEY = 'PROVIDER';

const providerFields = computed<KnownField[]>(() => {
  const provider = (kv.PROVIDER || 'clickup').toLowerCase();
  return PROVIDER_FIELDS[provider] ?? [];
});

const managedKeys = computed(() => {
  const all = new Set<string>([
    KNOWN_PROVIDER_SELECT_KEY,
    ...KNOWN_AI_KEYS,
    ...KNOWN_WORKFLOW_KEYS,
    ...KNOWN_LOG_KEYS,
  ]);
  for (const fields of Object.values(PROVIDER_FIELDS)) {
    for (const f of fields) all.add(f.key);
  }
  return all;
});

const otherKeys = computed(() =>
  Object.keys(kv)
    .filter((k) => !managedKeys.value.has(k))
    .sort(),
);

const dirty = computed(() => {
  const a = Object.keys(kv);
  const b = Object.keys(original);
  if (a.length !== b.length) return true;
  for (const k of a) {
    if ((kv[k] ?? '') !== (original[k] ?? '')) return true;
  }
  return false;
});

function isSecretKey(key: string): boolean {
  return /(KEY|TOKEN|SECRET|PASSWORD)$/i.test(key);
}

function applyData(data: EnvFileResult) {
  filePath.value = data.path;
  fileExists.value = data.exists;
  for (const k of Object.keys(kv)) delete kv[k];
  for (const k of Object.keys(original)) delete original[k];
  // Make sure every key referenced by the known sections has a slot so v-model
  // bindings stay reactive even when the file does not define them yet.
  const seed: Record<string, string> = {};
  seed[KNOWN_PROVIDER_SELECT_KEY] = data.values[KNOWN_PROVIDER_SELECT_KEY] || 'clickup';
  for (const k of KNOWN_AI_KEYS) seed[k] = data.values[k] ?? '';
  for (const k of KNOWN_WORKFLOW_KEYS) seed[k] = data.values[k] ?? '';
  for (const k of KNOWN_LOG_KEYS) seed[k] = data.values[k] ?? '';
  for (const [k, v] of Object.entries(data.values)) seed[k] = v;
  for (const [k, v] of Object.entries(seed)) {
    kv[k] = v;
    original[k] = v;
  }
  if (!testAgent.value) {
    const first = (kv.AGENTS || '').split(',').map((s) => s.trim()).filter(Boolean)[0];
    if (first) testAgent.value = first;
  }
}

async function reload() {
  loading.value = true;
  loadError.value = '';
  try {
    const data = await api<EnvFileResult>('/api/config');
    applyData(data);
  } catch (err) {
    loadError.value = err instanceof Error ? err.message : String(err);
  } finally {
    loading.value = false;
  }
}

async function save() {
  saving.value = true;
  saved.value = false;
  loadError.value = '';
  try {
    const data = await api<EnvFileResult>('/api/config', {
      method: 'PUT',
      body: { values: { ...kv } },
    });
    savedCount.value = Object.keys(data.values).length;
    applyData(data);
    saved.value = true;
    setTimeout(() => (saved.value = false), 3000);
  } catch (err) {
    loadError.value = err instanceof Error ? err.message : String(err);
  } finally {
    saving.value = false;
  }
}

async function createDefaults() {
  const defaults: Record<string, string> = {
    PROVIDER: 'clickup',
    AGENTS: 'claude,cursor',
    DEV_NOTES_MODE: 'smart',
    AIDEV_TRIGGER_WORD: 'aidev-continue',
    THINKING_TAG: 'thinking',
    PLANNING_TAG: 'planning',
  };
  saving.value = true;
  try {
    const data = await api<EnvFileResult>('/api/config', {
      method: 'PUT',
      body: { values: defaults },
    });
    applyData(data);
  } catch (err) {
    loadError.value = err instanceof Error ? err.message : String(err);
  } finally {
    saving.value = false;
  }
}

async function testProvider() {
  testing.provider = true;
  testResults.provider = null;
  try {
    testResults.provider = await api<TestResult>('/api/config/test', {
      method: 'POST',
      body: { provider: true },
    });
  } catch (err) {
    testResults.provider = {
      ok: false,
      message: err instanceof Error ? err.message : String(err),
    };
  } finally {
    testing.provider = false;
  }
}

async function testAi() {
  if (!testAgent.value) return;
  testing.ai = true;
  testResults.ai = null;
  try {
    testResults.ai = await api<TestResult>('/api/config/test', {
      method: 'POST',
      body: { ai: testAgent.value },
    });
  } catch (err) {
    testResults.ai = {
      ok: false,
      message: err instanceof Error ? err.message : String(err),
    };
  } finally {
    testing.ai = false;
  }
}

function removeKey(key: string) {
  delete kv[key];
}

function closeAddKey() {
  addKeyDialog.value = false;
  newKey.value = '';
  newValue.value = '';
  newKeyError.value = '';
}

function commitAddKey() {
  const k = newKey.value.trim();
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(k)) {
    newKeyError.value = 'Key must match [A-Za-z_][A-Za-z0-9_]*';
    return;
  }
  if (k in kv) {
    newKeyError.value = `Key ${k} already exists`;
    return;
  }
  kv[k] = newValue.value;
  closeAddKey();
}

onMounted(reload);
</script>

<style scoped>
.config-page {
  display: flex;
  flex-direction: column;
}
</style>

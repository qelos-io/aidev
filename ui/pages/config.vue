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

      <p class="text-sm text-gray-500 mb-3">
        Agents in fallback order — first is primary, rest are tried when the previous fails.
      </p>

      <div class="space-y-3">
        <div
          v-for="(block, index) in agentBlocks"
          :key="block.uid"
          class="agent-block rounded-lg border border-gray-200 dark:border-gray-700 p-4"
        >
          <div class="flex items-center justify-between gap-3 mb-3">
            <div class="flex items-center gap-2 min-w-0">
              <div class="flex flex-col gap-0.5">
                <UButton
                  size="xs"
                  color="gray"
                  variant="ghost"
                  icon="i-heroicons-chevron-up"
                  :disabled="index === 0"
                  aria-label="Move up"
                  @click="moveAgent(index, -1)"
                />
                <UButton
                  size="xs"
                  color="gray"
                  variant="ghost"
                  icon="i-heroicons-chevron-down"
                  :disabled="index === agentBlocks.length - 1"
                  aria-label="Move down"
                  @click="moveAgent(index, 1)"
                />
              </div>
              <USelect
                v-model="block.type"
                :options="agentTypeOptions"
                class="w-52"
                @update:model-value="syncAgentsToKv"
              />
              <UBadge v-if="index === 0" color="primary" variant="subtle" size="xs">
                primary
              </UBadge>
              <span v-else class="text-xs text-gray-400">fallback {{ index }}</span>
            </div>
            <UButton
              size="xs"
              color="red"
              variant="ghost"
              icon="i-heroicons-trash"
              :disabled="agentBlocks.length <= 1"
              aria-label="Remove agent"
              @click="removeAgent(index)"
            />
          </div>

          <div
            v-if="fieldsForAgent(block.type).length > 0"
            class="grid gap-4 md:grid-cols-2"
          >
            <UFormGroup
              v-for="field in fieldsForAgent(block.type)"
              :key="field.key"
              :label="field.key"
              :help="field.help"
            >
              <UInput
                v-model="kv[field.key]"
                :type="field.secret ? 'password' : 'text'"
                :placeholder="field.placeholder ?? ''"
                autocomplete="off"
              />
            </UFormGroup>
          </div>
          <p v-else-if="agentCliHelp[block.type]" class="text-sm text-gray-500">
            {{ agentCliHelp[block.type] }}
          </p>
        </div>

        <UButton
          size="sm"
          color="gray"
          variant="soft"
          icon="i-heroicons-plus"
          @click="addAgent"
        >
          Add agent
        </UButton>
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
        <UFormGroup label="AUTO_APPROVE" help="When true, apply ACCEPTED_TAG as soon as an open task is picked up.">
          <UInput v-model="kv.AUTO_APPROVE" placeholder="false" />
        </UFormGroup>
        <UFormGroup label="AGENT_REVIEW_TAG" help="Tag marking a task for automated PR review.">
          <UInput v-model="kv.AGENT_REVIEW_TAG" placeholder="agent review" />
        </UFormGroup>
        <UFormGroup label="AUTO_REVIEW" help="When true, apply tag on open pickup.">
          <UInput v-model="kv.AUTO_REVIEW" placeholder="false" />
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
        <UFormGroup label="AIDEV_SAFE_MODE" help="Redact secret env values from AI prompts (default: true). Set false/0/no to disable.">
          <UInput v-model="kv.AIDEV_SAFE_MODE" placeholder="true" />
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

interface AgentBlock {
  uid: number;
  type: string;
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

const VALID_AGENTS = [
  'antigravity',
  'anthropic-sdk',
  'claude',
  'codex',
  'cursor',
  'devin',
  'opencode',
] as const;

const agentTypeOptions = VALID_AGENTS.map((id) => ({ label: id, value: id }));

const AGENT_FIELDS: Record<string, KnownField[]> = {
  claude: [
    {
      key: 'CLAUDE_MODEL',
      help: 'Model passed to `claude --model`. Default routes plan→opus and code→sonnet.',
      placeholder: 'opusplan',
    },
  ],
  'anthropic-sdk': [
    {
      key: 'ANTHROPIC_API_KEY',
      help: 'Accepts a single key or comma-separated pool; the runner rotates round-robin.',
      secret: true,
    },
    { key: 'ANTHROPIC_MODEL', placeholder: 'claude-opus-4-6' },
    {
      key: 'ANTHROPIC_BASE_URL',
      help: 'Optional — leave blank for default.',
      placeholder: 'https://api.anthropic.com',
    },
    {
      key: 'ANTHROPIC_SDK_MAX_RETRIES',
      help: 'Retries after transient SDK errors. Set 0 to disable. Default: 3.',
      placeholder: '3',
    },
  ],
  devin: [],
  cursor: [],
  codex: [],
  antigravity: [],
  opencode: [
    {
      key: 'OPENCODE_CONFIG_DIR',
      help: 'Directory for OpenCode agents, commands, modes, and plugins.',
      placeholder: '/path/to/config-directory',
    },
    {
      key: 'OPENCODE_MODEL',
      help: 'Model in provider/model format passed to `opencode run --model`.',
      placeholder: 'anthropic/claude-sonnet-4-6',
    },
  ],
};

const agentCliHelp: Record<string, string> = {
  cursor: 'Uses the `agent` CLI — no extra env keys.',
  codex: 'Uses the `codex` CLI. Set OPENAI_API_KEY or run `codex login`.',
  opencode: 'Uses the `opencode` CLI. Set OPENCODE_CONFIG_DIR for a custom config directory.',
  antigravity: 'Uses the `agy` or `antigravity` CLI — no extra env keys.',
};

let nextAgentUid = 0;
const agentBlocks = ref<AgentBlock[]>([]);

const agentTestOptions = computed(() =>
  agentBlocks.value.map((b) => ({ label: b.type, value: b.type })),
);

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
  'ANTHROPIC_SDK_MAX_RETRIES',
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
  'AUTO_APPROVE',
  'AGENT_REVIEW_TAG',
  'AUTO_REVIEW',
  'DONE_STATUS',
  'AIDEV_COMMENT_PREFIX',
  'AIDEV_HOOKS_PATH',
  'AIDEV_SAFE_MODE',
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

function fieldsForAgent(type: string): KnownField[] {
  return AGENT_FIELDS[type] ?? [];
}

function parseAgentBlocks(agentsRaw: string): AgentBlock[] {
  const types = agentsRaw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((t) => (VALID_AGENTS as readonly string[]).includes(t));
  if (types.length === 0) {
    return [{ uid: nextAgentUid++, type: 'claude' }, { uid: nextAgentUid++, type: 'cursor' }];
  }
  return types.map((type) => ({ uid: nextAgentUid++, type }));
}

function syncAgentsToKv(): void {
  kv.AGENTS = agentBlocks.value.map((b) => b.type).join(',');
}

function addAgent(): void {
  const used = new Set(agentBlocks.value.map((b) => b.type));
  const next = VALID_AGENTS.find((a) => !used.has(a)) ?? 'claude';
  agentBlocks.value.push({ uid: nextAgentUid++, type: next });
  syncAgentsToKv();
}

function removeAgent(index: number): void {
  if (agentBlocks.value.length <= 1) return;
  agentBlocks.value.splice(index, 1);
  syncAgentsToKv();
}

function moveAgent(index: number, delta: -1 | 1): void {
  const target = index + delta;
  const item = agentBlocks.value[index];
  if (!item || target < 0 || target >= agentBlocks.value.length) return;
  const blocks = [...agentBlocks.value];
  blocks.splice(index, 1);
  blocks.splice(target, 0, item);
  agentBlocks.value = blocks;
  syncAgentsToKv();
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
  agentBlocks.value = parseAgentBlocks(kv.AGENTS || '');
  syncAgentsToKv();
  const configured = agentBlocks.value.map((b) => b.type);
  if (!testAgent.value || !configured.includes(testAgent.value)) {
    testAgent.value = configured[0] ?? '';
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

.agent-block {
  background: rgb(var(--color-gray-50) / 0.5);
}

:root.dark .agent-block {
  background: rgb(var(--color-gray-900) / 0.35);
}
</style>

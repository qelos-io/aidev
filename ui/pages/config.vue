<template>
  <div class="cfg">
    <header class="page-head">
      <div>
        <h1>Settings</h1>
        <p>
          Everything aidev needs to know: where your tasks live, which AI does the work, and how it behaves.
          <span v-if="fileExists === false" class="file-state file-state--warn">Settings file not created yet</span>
          <span v-else-if="fileExists" class="file-state">
            <UIcon name="i-lucide-check" class="size-3.5" aria-hidden="true" /> Loaded from <code>{{ fileName }}</code>
          </span>
        </p>
      </div>
      <UButton color="neutral" variant="ghost" icon="i-lucide-refresh-cw" :loading="loading" :disabled="loading || dirty" @click="reload">
        Reload
      </UButton>
    </header>

    <UAlert v-if="loadError" color="error" variant="soft" icon="i-lucide-triangle-alert" title="Something went wrong" :description="loadError" class="mb-5" />

    <UAlert
      v-if="fileExists === false"
      color="warning"
      variant="soft"
      icon="i-lucide-file-plus"
      title="You don't have a settings file yet"
      description="Create one with sensible defaults, then fill in your task tool and AI assistant below."
      class="mb-5"
    >
      <template #actions>
        <UButton color="warning" :loading="saving" @click="createDefaults">Create with defaults</UButton>
      </template>
    </UAlert>

    <div class="layout">
      <aside class="index" aria-label="Sections">
        <UInput v-model="query" icon="i-lucide-search" placeholder="Find a setting…" aria-label="Find a setting" class="w-full" :ui="{ trailing: 'pe-1' }">
          <template v-if="query" #trailing>
            <UButton color="neutral" variant="link" size="sm" icon="i-lucide-x" aria-label="Clear search" @click="query = ''" />
          </template>
        </UInput>
        <nav class="index-list">
          <a
            v-for="s in visibleSections"
            :key="s.id"
            :href="`#${s.id}`"
            class="index-link"
            :class="{ 'index-link--on': activeId === s.id }"
            @click.prevent="jump(s.id)"
          >
            <UIcon :name="s.icon" class="size-4" aria-hidden="true" />
            {{ s.title }}
          </a>
        </nav>
      </aside>

      <div class="sections">
        <p v-if="query && visibleSections.length === 0" class="empty">
          No settings match “{{ query }}”. Try a simpler word, or clear the search.
        </p>

        <!-- Task tool -->
        <section v-if="show('connection')" id="connection" class="sec" aria-labelledby="connection-h">
          <div class="sec-head">
            <div>
              <h2 id="connection-h" class="with-tile">
                <IconTile :image="providerMeta(kv.PROVIDER || 'clickup').image" :icon="providerMeta(kv.PROVIDER || 'clickup').icon" :color="providerMeta(kv.PROVIDER || 'clickup').color" size="sm" />
                Task tool
              </h2>
              <p>Where your tasks live. aidev reads tasks from here and writes comments back.</p>
            </div>
            <UButton color="neutral" variant="soft" icon="i-lucide-plug-zap" :loading="testing.provider" :disabled="testing.provider" @click="testProvider">
              Test connection
            </UButton>
          </div>
          <div class="fields">
            <ConfigField :def="providerDef" v-model="kv.PROVIDER" :changed="isChanged('PROVIDER')" />
            <ConfigField
              v-for="f in providerFieldsVisible"
              :key="f.key"
              v-model="kv[f.key]"
              :def="f"
              :changed="isChanged(f.key)"
            />
          </div>
          <UAlert
            v-if="testResults.provider"
            :color="testResults.provider.ok ? 'success' : 'error'"
            variant="soft"
            :icon="testResults.provider.ok ? 'i-lucide-circle-check' : 'i-lucide-circle-x'"
            :title="testResults.provider.ok ? 'Connected' : 'Could not connect'"
            :description="testResults.provider.message"
            class="mt-4"
          />
        </section>

        <!-- AI assistants -->
        <section v-if="show('ai')" id="ai" class="sec" aria-labelledby="ai-h">
          <div class="sec-head">
            <div>
              <h2 id="ai-h">AI assistants</h2>
              <p>aidev tries the first assistant. If it fails, it moves on to the next one down the list.</p>
            </div>
            <div class="test-row">
              <USelect v-model="testAgent" :items="agentTestOptions" aria-label="Assistant to test" class="w-48" />
              <UButton color="neutral" variant="soft" icon="i-lucide-flask-conical" :loading="testing.ai" :disabled="testing.ai || !testAgent" @click="testAi">
                Test
              </UButton>
            </div>
          </div>

          <p v-if="agentsLoaded" class="found-line" aria-live="polite">
            <template v-if="installedNames.length">
              <UIcon name="i-lucide-circle-check" class="size-4 text-success" aria-hidden="true" />
              Installed on this computer: <strong>{{ installedNames.join(', ') }}</strong>
            </template>
            <template v-else>
              <UIcon name="i-lucide-circle-alert" class="size-4 text-warning" aria-hidden="true" />
              No assistant program was found on this computer yet. Install one below so aidev has something to work with.
            </template>
          </p>

          <ol class="agents">
            <li v-for="(block, index) in agentBlocks" :key="block.uid" class="agent">
              <div class="agent-top">
                <IconTile :image="agentMeta(block.type).image" :icon="agentMeta(block.type).icon" :color="agentMeta(block.type).color" size="md" />
                <span class="agent-rank" :class="{ 'agent-rank--first': index === 0 }">{{ index === 0 ? 'First choice' : `Backup ${index}` }}</span>
                <USelect v-model="block.type" :items="agentTypeOptions" aria-label="Assistant" class="w-56" @update:model-value="syncAgentsToKv" />
                <UBadge v-if="statusOf(block.type)" :color="statusOf(block.type)!.color" variant="subtle" :icon="statusOf(block.type)!.icon">
                  {{ statusOf(block.type)!.label }}
                </UBadge>
                <span class="spacer" />
                <UButton color="neutral" variant="ghost" size="sm" icon="i-lucide-arrow-up" :disabled="index === 0" aria-label="Move up" @click="moveAgent(index, -1)" />
                <UButton color="neutral" variant="ghost" size="sm" icon="i-lucide-arrow-down" :disabled="index === agentBlocks.length - 1" aria-label="Move down" @click="moveAgent(index, 1)" />
                <UButton color="error" variant="ghost" size="sm" icon="i-lucide-trash-2" :disabled="agentBlocks.length <= 1" aria-label="Remove assistant" @click="removeAgent(index)" />
              </div>

              <div v-if="isMissing(block.type)" class="install" role="note">
                <p>
                  <strong>{{ agentMeta(block.type).name }}</strong> isn't installed on this computer, so aidev skips it until you install it.
                </p>
                <div class="install-row">
                  <code v-if="agentMeta(block.type).install?.command" class="install-cmd">{{ agentMeta(block.type).install?.command }}</code>
                  <UButton v-if="agentMeta(block.type).install?.command" color="neutral" variant="soft" size="sm" :icon="copiedId === block.type ? 'i-lucide-check' : 'i-lucide-copy'" @click="copyInstall(block.type)">
                    {{ copiedId === block.type ? 'Copied' : 'Copy' }}
                  </UButton>
                  <UButton v-if="agentMeta(block.type).install?.url" color="neutral" variant="link" size="sm" icon="i-lucide-external-link" :to="agentMeta(block.type).install?.url" target="_blank" rel="noopener">
                    {{ agentMeta(block.type).install?.command ? 'Install page' : 'How to install' }}
                  </UButton>
                </div>
              </div>

              <div v-if="agentFieldsVisible(block.type).length" class="fields">
                <ConfigField v-for="f in agentFieldsVisible(block.type)" :key="f.key" v-model="kv[f.key]" :def="f" :changed="isChanged(f.key)" />
              </div>
              <p v-else-if="agentCliHelp[block.type]" class="agent-note">{{ agentCliHelp[block.type] }}</p>
            </li>
          </ol>

          <UDropdownMenu :items="addAgentItems" :content="{ align: 'start' }" :disabled="addAgentItems.flat().filter((i) => i.type !== 'label').length === 0">
            <UButton color="neutral" variant="soft" icon="i-lucide-plus" trailing-icon="i-lucide-chevron-down" class="mt-3">Add a backup assistant</UButton>
          </UDropdownMenu>

          <UAlert
            v-if="testResults.ai"
            :color="testResults.ai.ok ? 'success' : 'error'"
            variant="soft"
            :icon="testResults.ai.ok ? 'i-lucide-circle-check' : 'i-lucide-circle-x'"
            :title="testResults.ai.ok ? 'Assistant responded' : 'Assistant failed'"
            :description="testResults.ai.message"
            class="mt-4"
          />
        </section>

        <!-- Field-driven sections -->
        <section v-for="g in fieldSections" :key="g.id" :id="g.id" class="sec" :aria-labelledby="`${g.id}-h`">
          <div class="sec-head">
            <div>
              <h2 :id="`${g.id}-h`">{{ g.title }}</h2>
              <p>{{ g.blurb }}</p>
            </div>
          </div>
          <div v-for="sub in g.groups" :key="sub.title" class="sub">
            <h3 v-if="sub.title">{{ sub.title }}</h3>
            <div class="fields">
              <ConfigField v-for="f in sub.fields" :key="f.key" v-model="kv[f.key]" :def="f" :changed="isChanged(f.key)" />
            </div>
          </div>
        </section>

        <!-- Advanced -->
        <section v-if="show('advanced')" id="advanced" class="sec" aria-labelledby="advanced-h">
          <div class="sec-head">
            <div>
              <h2 id="advanced-h">Other settings</h2>
              <p>Extra keys in your settings file that aidev doesn't have a dedicated control for.</p>
            </div>
            <UButton color="neutral" variant="soft" icon="i-lucide-plus" @click="addKeyDialog = true">Add a setting</UButton>
          </div>
          <p v-if="otherKeys.length === 0" class="agent-note">Nothing here. Use “Add a setting” to introduce one.</p>
          <div v-else class="fields">
            <UFormField v-for="key in otherKeys" :key="key" :name="key">
              <template #label><span class="other-key">{{ key }}</span></template>
              <div class="other-row">
                <UInput v-model="kv[key]" :type="isSecretKey(key) ? 'password' : 'text'" autocomplete="off" class="flex-1" />
                <UButton color="error" variant="ghost" icon="i-lucide-trash-2" :aria-label="`Remove ${key}`" @click="removeKey(key)" />
              </div>
            </UFormField>
          </div>
        </section>
      </div>
    </div>

    <SaveBar
      :dirty="dirty"
      :saving="saving"
      :saved="saved"
      :dirty-text="`${changedCount} unsaved ${changedCount === 1 ? 'change' : 'changes'}`"
      :saved-text="`Saved. ${savedCount} settings written.`"
      @save="save"
      @discard="discard"
    />

    <!-- Add-key dialog -->
    <UModal v-model:open="addKeyDialog" title="Add a setting" description="Add a key that aidev should read from your settings file.">
      <template #body>
        <div class="space-y-4">
          <UFormField label="Name" help="Capital letters, numbers and underscores, for example MY_NEW_SETTING.">
            <UInput v-model="newKey" placeholder="MY_NEW_SETTING" autofocus class="w-full" />
          </UFormField>
          <UFormField label="Value">
            <UInput v-model="newValue" autocomplete="off" class="w-full" />
          </UFormField>
          <p v-if="newKeyError" class="text-sm text-error">{{ newKeyError }}</p>
        </div>
      </template>
      <template #footer>
        <div class="flex justify-end gap-2 w-full">
          <UButton variant="ghost" color="neutral" @click="closeAddKey">Cancel</UButton>
          <UButton @click="commitAddKey">Add</UButton>
        </div>
      </template>
    </UModal>
  </div>
</template>

<script setup lang="ts">
import { useApi } from '~/composables/useApi';
import type { FieldDef } from '~/components/config/ConfigField.vue';

interface EnvFileResult { path: string; exists: boolean; values: Record<string, string>; keys: string[] }
interface TestResult { ok: boolean; message: string }
interface AgentBlock { uid: number; type: string }
interface FieldGroup { title?: string; fields: FieldDef[] }
interface SectionDef { id: string; title: string; blurb: string; icon: string; keywords: string; groups?: FieldGroup[] }

const api = useApi();

const filePath = ref('');
const fileExists = ref<boolean | null>(null);
const fileName = computed(() => filePath.value.split(/[\\/]/).pop() || '.env.aidev');
const loading = ref(false);
const loadError = ref('');
const saving = ref(false);
const saved = ref(false);
const savedCount = ref(0);

const kv = reactive<Record<string, string>>({});
// Snapshot of values as last read from disk — used to detect dirty state.
const original = reactive<Record<string, string>>({});
// Keys that actually exist in the file on disk. Blank keys that were never in the
// file must not be written back: a blank local `KEY=` overrides a value inherited
// through AIDEV_ENV_EXTEND, which silently breaks the project's config.
const fileKeys = new Set<string>();

const testing = reactive({ provider: false, ai: false });
const testResults = reactive<{ provider: TestResult | null; ai: TestResult | null }>({ provider: null, ai: null });
const testAgent = ref('');

const addKeyDialog = ref(false);
const newKey = ref('');
const newValue = ref('');
const newKeyError = ref('');
const query = ref('');

/* ------------------------------ field schema ------------------------------ */

const providerDef: FieldDef = {
  key: 'PROVIDER',
  label: 'Which tool holds your tasks?',
  help: 'aidev will read tasks from here.',
  kind: 'select',
  options: (['clickup', 'jira', 'linear', 'monday', 'notion', 'trello', 'local'] as const).map((id) => providerItem(id)) as { label: string; value: string }[],
};

const PROVIDER_FIELDS: Record<string, FieldDef[]> = {
  clickup: [
    { key: 'CLICKUP_API_KEY', label: 'API key', secret: true, help: 'Create one in ClickUp under Settings → Apps.' },
    { key: 'CLICKUP_TEAM_ID', label: 'Workspace ID' },
    { key: 'CLICKUP_TAG', label: 'Project tag', help: 'Only tasks with this tag belong to this project.' },
    { key: 'CLICKUP_LIST_ID', label: 'List ID', help: 'Needed only if aidev should create new tasks.' },
    { key: 'CLICKUP_PENDING_STATUS', label: 'Status: waiting on you', placeholder: 'pending' },
    { key: 'CLICKUP_OPEN_STATUS', label: 'Status: ready for aidev', placeholder: 'open' },
    { key: 'CLICKUP_IN_REVIEW_STATUS', label: 'Status: ready to review', placeholder: 'review' },
  ],
  jira: [
    { key: 'JIRA_BASE_URL', label: 'Jira address', placeholder: 'https://mycompany.atlassian.net' },
    { key: 'JIRA_EMAIL', label: 'Your email' },
    { key: 'JIRA_API_TOKEN', label: 'API token', secret: true },
    { key: 'JIRA_PROJECT', label: 'Project key' },
    { key: 'JIRA_LABEL', label: 'Label', help: 'Only issues with this label are picked up.' },
    { key: 'JIRA_PENDING_STATUS', label: 'Status: waiting on you', placeholder: 'To Do' },
    { key: 'JIRA_IN_REVIEW_STATUS', label: 'Status: ready to review', placeholder: 'In Review' },
  ],
  linear: [
    { key: 'LINEAR_API_KEY', label: 'API key', secret: true },
    { key: 'LINEAR_TEAM_ID', label: 'Team ID' },
    { key: 'LINEAR_LABEL', label: 'Label' },
    { key: 'LINEAR_PENDING_STATUS', label: 'Status: waiting on you', placeholder: 'Pending' },
    { key: 'LINEAR_IN_REVIEW_STATUS', label: 'Status: ready to review', placeholder: 'In Review' },
  ],
  monday: [
    { key: 'MONDAY_API_TOKEN', label: 'API token', secret: true },
    { key: 'MONDAY_BOARD_ID', label: 'Board ID' },
    { key: 'MONDAY_STATUS_COLUMN_ID', label: 'Status column ID', placeholder: 'status' },
    { key: 'MONDAY_GROUP_ID', label: 'Group ID' },
  ],
  notion: [
    { key: 'NOTION_API_KEY', label: 'API key', secret: true },
    { key: 'NOTION_DATABASE_ID', label: 'Database ID' },
    { key: 'NOTION_STATUS_PROPERTY', label: 'Status property name', placeholder: 'Status' },
    { key: 'NOTION_PENDING_STATUS', label: 'Status: waiting on you', placeholder: 'pending' },
    { key: 'NOTION_IN_REVIEW_STATUS', label: 'Status: ready to review', placeholder: 'review' },
  ],
  trello: [
    { key: 'TRELLO_TOKEN', label: 'Token', secret: true },
    { key: 'TRELLO_BOARD_ID', label: 'Board ID' },
    { key: 'TRELLO_LABEL', label: 'Label' },
    { key: 'TRELLO_OPEN_LIST', label: 'List: ready for aidev', placeholder: 'To Do' },
    { key: 'TRELLO_PENDING_LIST', label: 'List: waiting on you', placeholder: 'Blocked' },
    { key: 'TRELLO_IN_PROGRESS_LIST', label: 'List: in progress', placeholder: 'Doing' },
    { key: 'TRELLO_IN_REVIEW_LIST', label: 'List: ready to review', placeholder: 'In Review' },
  ],
  local: [],
};

const VALID_AGENTS = AGENT_IDS;
const AGENT_LABELS: Record<string, string> = Object.fromEntries(AGENT_IDS.map((id) => [id, agentMeta(id).name]));
function agentItem(id: string) {
  const m = agentMeta(id);
  return m.image ? { label: m.name, value: id, avatar: { src: m.image, alt: '' } } : { label: m.name, value: id, icon: m.icon };
}
const agentTypeOptions = AGENT_IDS.map((id) => agentItem(id)) as { label: string; value: string }[];

// Which assistant programs exist on this computer (asked of the dashboard's own server).
const installed = reactive<Record<string, boolean>>({});
const agentsLoaded = ref(false);
async function loadInstalled() {
  try {
    const res = await api<{ agents: { id: string; installed: boolean }[] }>('/api/agents');
    for (const a of res.agents) installed[a.id] = a.installed;
    agentsLoaded.value = true;
  } catch {
    agentsLoaded.value = false; // detection is a nicety; the page works without it
  }
}
const installedNames = computed(() => AGENT_IDS.filter((id) => installed[id]).map((id) => agentMeta(id).name));
function isMissing(type: string): boolean {
  return agentsLoaded.value && agentMeta(type).kind === 'cli' && installed[type] === false;
}
function statusOf(type: string): { label: string; color: 'success' | 'warning' | 'neutral'; icon: string } | null {
  if (!agentsLoaded.value) return null;
  if (agentMeta(type).kind === 'api') {
    return kv.ANTHROPIC_API_KEY?.trim()
      ? { label: 'API key set', color: 'success', icon: 'i-lucide-check' }
      : { label: 'Needs an API key', color: 'warning', icon: 'i-lucide-key-round' };
  }
  return installed[type]
    ? { label: 'Installed', color: 'success', icon: 'i-lucide-check' }
    : { label: 'Not installed', color: 'warning', icon: 'i-lucide-triangle-alert' };
}
const copiedId = ref('');
async function copyInstall(type: string) {
  const cmd = agentMeta(type).install?.command;
  if (!cmd) return;
  try {
    await navigator.clipboard.writeText(cmd);
    copiedId.value = type;
    setTimeout(() => { if (copiedId.value === type) copiedId.value = ''; }, 1500);
  } catch { /* clipboard unavailable */ }
}
const addAgentItems = computed(() => {
  const unused = AGENT_IDS.filter((id) => !agentBlocks.value.some((b) => b.type === id));
  const entry = (id: string) => {
    const m = agentMeta(id);
    return { label: m.name, description: m.blurb, ...(m.image ? { avatar: { src: m.image, alt: '' } } : { icon: m.icon }), onSelect: () => addAgent(id) };
  };
  const ready = unused.filter((id) => !agentsLoaded.value || agentMeta(id).kind === 'api' || installed[id]);
  const notReady = unused.filter((id) => agentsLoaded.value && agentMeta(id).kind === 'cli' && !installed[id]);
  const groups: Array<Array<Record<string, unknown>>> = [];
  if (ready.length) groups.push([{ type: 'label', label: agentsLoaded.value ? 'Ready to use' : 'Assistants' }, ...ready.map(entry)]);
  if (notReady.length) groups.push([{ type: 'label', label: 'Not installed yet' }, ...notReady.map(entry)]);
  return groups;
});

const AGENT_FIELDS: Record<string, FieldDef[]> = {
  claude: [{ key: 'CLAUDE_MODEL', label: 'Model', help: 'Leave blank to let aidev plan with a stronger model and code with a faster one.', placeholder: 'opusplan' }],
  'anthropic-sdk': [
    { key: 'ANTHROPIC_API_KEY', label: 'API key', secret: true, help: 'Paste one key, or several separated by commas. aidev rotates through them.' },
    { key: 'ANTHROPIC_MODEL', label: 'Model', placeholder: 'claude-opus-4-6' },
    { key: 'ANTHROPIC_BASE_URL', label: 'Custom address', help: 'Optional. Leave blank to use the default.', placeholder: 'https://api.anthropic.com' },
    { key: 'ANTHROPIC_SDK_MAX_RETRIES', label: 'Retries after a hiccup', help: 'Set 0 to never retry. Default is 3.', placeholder: '3' },
  ],
  opencode: [
    { key: 'OPENCODE_CONFIG_DIR', label: 'Config folder', help: 'Folder holding OpenCode agents, commands and plugins.', placeholder: '/path/to/config-directory' },
    { key: 'OPENCODE_MODEL', label: 'Model', help: 'Written as provider/model.', placeholder: 'anthropic/claude-sonnet-4-6' },
  ],
  devin: [],
  cursor: [],
  codex: [],
  antigravity: [],
};
const agentCliHelp: Record<string, string> = {
  cursor: 'Uses the Cursor `agent` command. Nothing else to set up here.',
  codex: 'Uses the `codex` command. Sign in with `codex login`, or set OPENAI_API_KEY.',
  opencode: 'Uses the `opencode` command.',
  antigravity: 'Uses the `agy` or `antigravity` command. Nothing else to set up here.',
  devin: 'Nothing to set up here.',
  claude: '',
};

const bool = (key: string, label: string, help: string, defaultOn: boolean): FieldDef => ({ key, label, help, kind: 'bool', defaultOn });

const FIELD_SECTIONS: SectionDef[] = [
  {
    id: 'behavior',
    title: 'How aidev works',
    blurb: 'Control when aidev asks questions, what it says on tasks, and how it recognises your cues.',
    icon: 'i-lucide-bot',
    keywords: 'behavior workflow questions trigger approve review comment',
    groups: [
      {
        title: 'Conversation',
        fields: [
          {
            key: 'DEV_NOTES_MODE',
            label: 'When should aidev ask you questions?',
            kind: 'select',
            options: [
              { label: 'Only when something is unclear', value: 'smart' },
              { label: 'Before every task', value: 'always' },
            ],
          },
          { key: 'AIDEV_TRIGGER_WORD', label: 'Word that wakes aidev up', help: 'Reply with this on a paused task to make aidev continue.', placeholder: 'aidev-continue' },
          { key: 'AIDEV_COMMENT_PREFIX', label: 'Label on aidev’s comments', help: 'Shown at the start of everything aidev writes, so you can tell it apart.', placeholder: '[aidev]' },
          { key: 'ASSIGNEE_TAG', label: 'Only my tasks (tag)', help: 'Optional. Limits aidev to tasks carrying this tag.' },
          { key: 'DONE_STATUS', label: 'Status that means “finished”', help: 'Tasks in this status are left alone.' },
        ],
      },
      {
        title: 'Automatic steps',
        fields: [
          bool('AUTO_APPROVE', 'Approve tasks automatically', 'When on, aidev marks a task as accepted the moment it picks it up.', false),
          bool('AUTO_REVIEW', 'Ask for a review automatically', 'When on, finished work is tagged for an automated pull-request review.', false),
        ],
      },
    ],
  },
  {
    id: 'tags',
    title: 'Task tags',
    blurb: 'Tags you put on a task to tell aidev how to handle it.',
    icon: 'i-lucide-tags',
    keywords: 'tags thinking planning accepted review label',
    groups: [
      {
        fields: [
          { key: 'THINKING_TAG', label: 'Think it through first', help: 'aidev breaks tasks with this tag into smaller steps before starting.', placeholder: 'thinking' },
          { key: 'PLANNING_TAG', label: 'Plan only', help: 'aidev splits tasks with this tag into separate sub-tickets.', placeholder: 'planning' },
          { key: 'ACCEPTED_TAG', label: 'Approved to build', help: 'Marks a task as accepted for implementation.', placeholder: 'accepted' },
          { key: 'AGENT_REVIEW_TAG', label: 'Needs a review', help: 'Marks a task for automated pull-request review.', placeholder: 'agent review' },
        ],
      },
    ],
  },
  {
    id: 'git',
    title: 'Git & GitHub',
    blurb: 'Where aidev pushes its work. Usually the defaults are right.',
    icon: 'i-lucide-git-branch',
    keywords: 'git github repo branch remote',
    groups: [
      {
        fields: [
          { key: 'GITHUB_REPO', label: 'Repository', help: 'Written as owner/repo. Detected automatically when blank.', placeholder: 'owner/repo' },
          { key: 'GITHUB_BASE_BRANCH', label: 'Main branch', help: 'New work branches off from here.', placeholder: 'main' },
          { key: 'GIT_REMOTE', label: 'Remote name', placeholder: 'origin' },
        ],
      },
    ],
  },
  {
    id: 'safety',
    title: 'Safety & prompts',
    blurb: 'How aidev protects secrets and keeps long prompts under control.',
    icon: 'i-lucide-shield-check',
    keywords: 'safe mode secrets compress prompt threshold',
    groups: [
      {
        fields: [
          bool('AIDEV_SAFE_MODE', 'Hide secrets from the AI', 'Removes passwords and API keys from what is sent to the AI. Recommended.', true),
          bool('AIDEV_AUTO_COMPRESS', 'Shorten very long prompts', 'Condenses prompts that get too big, so runs stay fast and cheap.', true),
          { key: 'AIDEV_COMPRESS_THRESHOLD', label: 'Shorten after this many characters', placeholder: '12000' },
        ],
      },
    ],
  },
  {
    id: 'files',
    title: 'Files',
    blurb: 'Where aidev keeps its log and custom steps.',
    icon: 'i-lucide-folder-cog',
    keywords: 'log path hooks file',
    groups: [
      {
        fields: [
          { key: 'AIDEV_LOG_PATH', label: 'Activity log file', help: 'Leave blank to use aidev.log in this project.', placeholder: 'aidev.log' },
          { key: 'AIDEV_HOOKS_PATH', label: 'Custom steps file', help: 'Optional script that runs around each task (see Custom steps).', placeholder: '.aidev/aidev.hooks.ts' },
        ],
      },
    ],
  },
];

/* --------------------------------- state ---------------------------------- */

let nextAgentUid = 0;
const agentBlocks = ref<AgentBlock[]>([]);
const agentTestOptions = computed(() => agentBlocks.value.map((b) => ({ label: AGENT_LABELS[b.type] ?? b.type, value: b.type })));

const KNOWN_AI_KEYS = ['AGENTS', 'CLAUDE_MODEL', 'ANTHROPIC_API_KEY', 'ANTHROPIC_MODEL', 'ANTHROPIC_BASE_URL', 'ANTHROPIC_SDK_MAX_RETRIES'];
const allSchemaFields = computed(() => FIELD_SECTIONS.flatMap((s) => (s.groups ?? []).flatMap((g) => g.fields)));

const managedKeys = computed(() => {
  const all = new Set<string>(['PROVIDER', ...KNOWN_AI_KEYS]);
  for (const f of allSchemaFields.value) all.add(f.key);
  for (const fields of Object.values(PROVIDER_FIELDS)) for (const f of fields) all.add(f.key);
  for (const fields of Object.values(AGENT_FIELDS)) for (const f of fields) all.add(f.key);
  return all;
});
const otherKeys = computed(() => Object.keys(kv).filter((k) => !managedKeys.value.has(k)).sort());

function isChanged(key: string): boolean {
  return (kv[key] ?? '') !== (original[key] ?? '');
}
const changedCount = computed(() => {
  const keys = new Set([...Object.keys(kv), ...Object.keys(original)]);
  let n = 0;
  for (const k of keys) if (isChanged(k)) n++;
  return n;
});
const dirty = computed(() => changedCount.value > 0);

function isSecretKey(key: string): boolean {
  return /(KEY|TOKEN|SECRET|PASSWORD)$/i.test(key);
}

/* --------------------------------- search --------------------------------- */

const q = computed(() => query.value.trim().toLowerCase());
function fieldMatches(f: FieldDef): boolean {
  if (!q.value) return true;
  return `${f.label} ${f.key} ${f.help ?? ''}`.toLowerCase().includes(q.value);
}
function textMatches(text: string): boolean {
  return !q.value || text.toLowerCase().includes(q.value);
}

const providerFieldsAll = computed<FieldDef[]>(() => PROVIDER_FIELDS[(kv.PROVIDER || 'clickup').toLowerCase()] ?? []);
const providerFieldsVisible = computed(() => providerFieldsAll.value.filter((f) => fieldMatches(f) || textMatches('task tool provider connection')));
function agentFieldsVisible(type: string): FieldDef[] {
  return (AGENT_FIELDS[type] ?? []).filter((f) => fieldMatches(f) || textMatches('ai assistants agents model'));
}

const fieldSections = computed(() =>
  FIELD_SECTIONS.map((s) => {
    const sectionHit = textMatches(`${s.title} ${s.keywords}`);
    const groups = (s.groups ?? [])
      .map((g) => ({ ...g, fields: g.fields.filter((f) => sectionHit || fieldMatches(f)) }))
      .filter((g) => g.fields.length > 0);
    return { ...s, groups };
  }).filter((s) => s.groups.length > 0),
);

const SECTION_META: { id: string; title: string; icon: string; keywords: string }[] = [
  { id: 'connection', title: 'Task tool', icon: 'i-lucide-plug', keywords: 'task tool provider connection api key clickup jira linear' },
  { id: 'ai', title: 'AI assistants', icon: 'i-lucide-sparkles', keywords: 'ai assistants agents claude cursor model codex' },
];
function show(id: string): boolean {
  if (id === 'connection') return !q.value || textMatches(SECTION_META[0]!.keywords) || providerFieldsAll.value.some(fieldMatches);
  if (id === 'ai') return !q.value || textMatches(SECTION_META[1]!.keywords);
  if (id === 'advanced') return !q.value || textMatches('other settings advanced custom key') || otherKeys.value.some((k) => k.toLowerCase().includes(q.value));
  return true;
}

const visibleSections = computed(() => {
  const list: { id: string; title: string; icon: string }[] = [];
  if (show('connection')) list.push({ id: 'connection', title: 'Task tool', icon: 'i-lucide-plug' });
  if (show('ai')) list.push({ id: 'ai', title: 'AI assistants', icon: 'i-lucide-sparkles' });
  for (const s of fieldSections.value) list.push({ id: s.id, title: s.title, icon: s.icon });
  if (show('advanced')) list.push({ id: 'advanced', title: 'Other settings', icon: 'i-lucide-ellipsis' });
  return list;
});

/* ----------------------------- scroll index ------------------------------- */

const activeId = ref('connection');
function jump(id: string) {
  activeId.value = id;
  document.getElementById(id)?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
}
let observer: IntersectionObserver | null = null;
function observeSections() {
  observer?.disconnect();
  observer = new IntersectionObserver(
    (entries) => {
      const top = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
      if (top?.target.id) activeId.value = top.target.id;
    },
    { rootMargin: '0px 0px -70% 0px', threshold: 0 },
  );
  document.querySelectorAll('.cfg .sec').forEach((el) => observer?.observe(el));
}
watch(visibleSections, () => nextTick(observeSections));

/* ------------------------------ agents logic ------------------------------ */

function parseAgentBlocks(agentsRaw: string): AgentBlock[] {
  const types = agentsRaw.split(',').map((s) => s.trim()).filter(Boolean).filter((t) => (VALID_AGENTS as readonly string[]).includes(t));
  if (types.length === 0) return [{ uid: nextAgentUid++, type: 'claude' }, { uid: nextAgentUid++, type: 'cursor' }];
  return types.map((type) => ({ uid: nextAgentUid++, type }));
}
function syncAgentsToKv(): void {
  kv.AGENTS = agentBlocks.value.map((b) => b.type).join(',');
}
function addAgent(type?: string): void {
  const used = new Set(agentBlocks.value.map((b) => b.type));
  const next = type ?? VALID_AGENTS.find((a) => !used.has(a)) ?? 'claude';
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

/* ------------------------------- load / save ------------------------------ */

function applyData(data: EnvFileResult) {
  filePath.value = data.path;
  fileExists.value = data.exists;
  for (const k of Object.keys(kv)) delete kv[k];
  for (const k of Object.keys(original)) delete original[k];
  fileKeys.clear();
  for (const k of Object.keys(data.values)) fileKeys.add(k);
  // Every key the form binds to needs a slot so v-model stays reactive even
  // when the file does not define it yet.
  const seed: Record<string, string> = {};
  seed.PROVIDER = data.values.PROVIDER || 'clickup';
  for (const k of KNOWN_AI_KEYS) seed[k] = data.values[k] ?? '';
  for (const f of allSchemaFields.value) seed[f.key] = data.values[f.key] ?? '';
  for (const fields of Object.values(PROVIDER_FIELDS)) for (const f of fields) seed[f.key] = data.values[f.key] ?? '';
  for (const fields of Object.values(AGENT_FIELDS)) for (const f of fields) seed[f.key] = data.values[f.key] ?? '';
  for (const [k, v] of Object.entries(data.values)) seed[k] = v;
  for (const [k, v] of Object.entries(seed)) {
    kv[k] = v;
    original[k] = v;
  }
  agentBlocks.value = parseAgentBlocks(kv.AGENTS || '');
  syncAgentsToKv();
  original.AGENTS = kv.AGENTS ?? '';
  const configured = agentBlocks.value.map((b) => b.type);
  if (!testAgent.value || !configured.includes(testAgent.value)) testAgent.value = configured[0] ?? '';
}

async function reload() {
  loading.value = true;
  loadError.value = '';
  try {
    applyData(await api<EnvFileResult>('/api/config'));
  } catch (err) {
    loadError.value = err instanceof Error ? err.message : String(err);
  } finally {
    loading.value = false;
  }
}

function discard() {
  for (const k of Object.keys(kv)) if (!(k in original)) delete kv[k];
  for (const [k, v] of Object.entries(original)) kv[k] = v;
  agentBlocks.value = parseAgentBlocks(kv.AGENTS || '');
}

function valuesToSave(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(kv)) {
    if ((v ?? '') !== '' || fileKeys.has(k)) out[k] = v ?? '';
  }
  return out;
}

let savedTimer: ReturnType<typeof setTimeout> | null = null;
async function save() {
  saving.value = true;
  saved.value = false;
  loadError.value = '';
  try {
    const data = await api<EnvFileResult>('/api/config', { method: 'PUT', body: { values: valuesToSave() } });
    savedCount.value = Object.keys(data.values).length;
    applyData(data);
    saved.value = true;
    if (savedTimer) clearTimeout(savedTimer);
    savedTimer = setTimeout(() => (saved.value = false), 3000);
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
    applyData(await api<EnvFileResult>('/api/config', { method: 'PUT', body: { values: defaults } }));
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
    testResults.provider = await api<TestResult>('/api/config/test', { method: 'POST', body: { provider: true } });
  } catch (err) {
    testResults.provider = { ok: false, message: err instanceof Error ? err.message : String(err) };
  } finally {
    testing.provider = false;
  }
}

async function testAi() {
  if (!testAgent.value) return;
  testing.ai = true;
  testResults.ai = null;
  try {
    testResults.ai = await api<TestResult>('/api/config/test', { method: 'POST', body: { ai: testAgent.value } });
  } catch (err) {
    testResults.ai = { ok: false, message: err instanceof Error ? err.message : String(err) };
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
    newKeyError.value = 'Use letters, numbers and underscores only, and start with a letter.';
    return;
  }
  if (k in kv) {
    newKeyError.value = `${k} already exists.`;
    return;
  }
  kv[k] = newValue.value;
  closeAddKey();
}

// Warn before leaving with unsaved edits.
function beforeUnload(e: BeforeUnloadEvent) {
  if (dirty.value) {
    e.preventDefault();
    e.returnValue = '';
  }
}
onBeforeRouteLeave(() => (dirty.value ? window.confirm('You have unsaved changes. Leave without saving?') : true));

onMounted(async () => {
  window.addEventListener('beforeunload', beforeUnload);
  void loadInstalled();
  await reload();
  await nextTick();
  observeSections();
});
onBeforeUnmount(() => {
  window.removeEventListener('beforeunload', beforeUnload);
  observer?.disconnect();
  if (savedTimer) clearTimeout(savedTimer);
});
</script>

<style scoped>
.cfg { position: relative; padding-bottom: 5rem; }

.page-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 1rem; padding: 0.75rem 0 1.5rem; }
.page-head h1 { margin: 0; font-size: 1.875rem; font-weight: 700; letter-spacing: -0.02em; color: var(--ui-text-highlighted); }
.page-head p { margin: 0.25rem 0 0; color: var(--wb-ink-soft); max-width: 48rem; }
.file-state { display: inline-flex; align-items: center; gap: 0.25rem; margin-left: 0.5rem; font-size: 0.8125rem; color: var(--wb-ok); }
.file-state code { font-family: var(--font-mono); }
.file-state--warn { color: var(--wb-wait); }

.layout { display: grid; grid-template-columns: 14rem minmax(0, 1fr); gap: 2rem; align-items: start; }
.index { position: sticky; top: 0.5rem; display: flex; flex-direction: column; gap: 0.75rem; }
.index-list { display: flex; flex-direction: column; gap: 0.125rem; }
.index-link {
  display: flex; align-items: center; gap: 0.625rem; min-height: 2.5rem; padding: 0 0.75rem;
  border-radius: 0.625rem; color: var(--wb-ink-soft); font-size: 0.9375rem; font-weight: 500; text-decoration: none;
  transition: background-color 0.15s, color 0.15s;
}
.index-link:hover { background: var(--ui-bg-elevated); color: var(--ui-text-highlighted); }
.index-link:focus-visible { outline: 2px solid var(--ui-primary); outline-offset: 2px; }
.index-link--on { background: color-mix(in oklch, var(--ui-primary) 12%, transparent); color: var(--ui-text-highlighted); }

.sections { display: flex; flex-direction: column; gap: 1.5rem; min-width: 0; }
.sec { padding: 1.5rem; border-radius: 1rem; background: var(--ui-bg); border: 1px solid var(--ui-border); scroll-margin-top: 0.5rem; }
.sec-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 1rem; flex-wrap: wrap; margin-bottom: 1.25rem; }
.sec-head h2.with-tile { display: flex; align-items: center; gap: 0.625rem; }
.sec-head h2 { margin: 0; font-size: 1.125rem; font-weight: 700; color: var(--ui-text-highlighted); }
.sec-head p { margin: 0.25rem 0 0; font-size: 0.9375rem; color: var(--wb-ink-soft); max-width: 42rem; }
.sub + .sub { margin-top: 1.75rem; }
.sub h3 { margin: 0 0 0.75rem; font-size: 0.9375rem; font-weight: 700; color: var(--ui-text-highlighted); }
.fields { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 1.25rem 1.5rem; }
.empty { padding: 2rem; text-align: center; color: var(--wb-ink-soft); }

.test-row { display: flex; align-items: center; gap: 0.5rem; }
.agents { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.75rem; }
.agent { padding: 1rem; border-radius: 0.75rem; border: 1px solid var(--ui-border); background: var(--ui-bg-muted); }
.agent-top { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; }
.found-line { display: flex; align-items: center; gap: 0.5rem; margin: 0 0 1rem; font-size: 0.9375rem; color: var(--wb-ink-soft); }
.found-line strong { color: var(--ui-text-highlighted); }
.install { margin-top: 0.875rem; padding: 0.875rem 1rem; border-radius: 0.75rem; background: color-mix(in oklch, var(--wb-wait) 12%, transparent); border: 1px solid color-mix(in oklch, var(--wb-wait) 35%, transparent); }
.install p { margin: 0 0 0.625rem; font-size: 0.9375rem; color: var(--ui-text); }
.install-row { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; }
.install-cmd { font-family: var(--font-mono); font-size: 0.8125rem; padding: 0.375rem 0.625rem; border-radius: 0.5rem; background: var(--ui-bg); border: 1px solid var(--ui-border); overflow-x: auto; max-width: 100%; }
.agent-top + .fields { margin-top: 1rem; }
.agent-rank {
  font-size: 0.75rem; font-weight: 700; padding: 0.25rem 0.625rem; border-radius: 999px;
  background: var(--ui-bg-elevated); color: var(--wb-ink-soft);
}
.agent-rank--first { background: color-mix(in oklch, var(--ui-primary) 16%, transparent); color: var(--ui-text-highlighted); }
.agent-note { margin: 0.75rem 0 0; font-size: 0.875rem; color: var(--wb-ink-soft); }
.spacer { flex: 1; }
.other-key { font-family: var(--font-mono); font-size: 0.8125rem; }
.other-row { display: flex; align-items: center; gap: 0.5rem; }

@media (max-width: 1000px) {
  .layout { grid-template-columns: minmax(0, 1fr); gap: 1rem; }
  .index { position: static; min-width: 0; }
  .index-list { flex-direction: row; overflow-x: auto; padding-bottom: 0.25rem; }
  .index-link { white-space: nowrap; }
}
@media (max-width: 700px) {
  .fields { grid-template-columns: 1fr; }
  .sec { padding: 1.125rem; }
  .page-head { flex-direction: column; }
}
</style>

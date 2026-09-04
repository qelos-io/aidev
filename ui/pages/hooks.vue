<template>
  <div class="hooks-page">
    <UCard>
      <template #header>
        <div class="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h1 class="text-lg font-semibold">Hooks</h1>
            <p class="text-xs text-gray-500 mt-1">
              <span v-if="hooksPath">Editing <code>{{ hooksPath }}</code></span>
              <span v-else class="text-amber-600">AIDEV_HOOKS_PATH not configured</span>
            </p>
          </div>
          <div class="flex items-center gap-2 flex-wrap">
            <USelectMenu
              v-model="selectedSample"
              :items="sampleOptions"
              value-key="value"
              placeholder="Insert sample…"
              size="sm"
              class="sample-select-menu"
              @update:model-value="onSampleSelect"
            >
              <template #item="{ item }">
                <div class="flex flex-col">
                  <span class="text-sm">{{ item.label }}</span>
                  <span class="text-xs text-gray-400">{{ item.hookName }}</span>
                </div>
              </template>
            </USelectMenu>
            <UButton color="neutral" variant="ghost" size="sm" :loading="loading" :disabled="loading" @click="loadHooks">
              Refresh
            </UButton>
            <UButton color="neutral" variant="soft" size="sm" :loading="addingMissing" :disabled="addingMissing" @click="addMissingHooks">
              Add missing
            </UButton>
            <UButton color="amber" variant="soft" size="sm" :loading="regenerating" :disabled="regenerating" @click="regenerate">
              Regenerate
            </UButton>
            <UButton color="primary" size="sm" :loading="saving" :disabled="saving" @click="save">
              Save
            </UButton>
          </div>
        </div>
      </template>

      <UAlert v-if="loadError" color="red" variant="soft" :title="loadError" class="mb-4" />
      <UAlert
        v-if="actionMessage"
        :color="actionOk ? 'green' : 'red'"
        variant="soft"
        :title="actionOk ? 'Done' : 'Error'"
        :description="actionMessage"
        class="mb-4"
      />

      <ClientOnly>
        <div ref="editorContainer" class="editor-container" />
        <template #fallback>
          <div class="editor-placeholder">Loading editor…</div>
        </template>
      </ClientOnly>
    </UCard>

    <UCard class="mt-4">
      <template #header>
        <h2 class="text-base font-semibold">Test hooks</h2>
      </template>
      <div v-for="hookName in HOOK_NAMES" :key="hookName" class="mb-2">
        <details :id="`hook-panel-${hookName}`" class="hook-panel">
          <summary class="hook-panel-summary">
            <code>{{ hookName }}</code>
          </summary>
          <div class="hook-panel-body">
            <label class="block text-xs font-medium text-gray-500 mb-1">Mock data (JSON)</label>
            <textarea
              v-model="mockDataMap[hookName]"
              class="mock-json"
              rows="5"
              spellcheck="false"
            />
            <div class="mt-2">
              <UButton
                color="primary"
                variant="soft"
                size="sm"
                :loading="executingHook === hookName"
                :disabled="executingHook !== null"
                @click="executeHook(hookName)"
              >
                Execute now
              </UButton>
            </div>
          </div>
        </details>
      </div>
    </UCard>

    <UModal v-model:open="showModal">
      <template #header>
        <div class="flex items-center justify-between">
          <h3 class="text-sm font-semibold">{{ modalTitle }}</h3>
          <UButton color="neutral" variant="ghost" size="xs" @click="showModal = false">✕</UButton>
        </div>
      </template>
      <template #body>
        <div v-if="modalLoading" class="modal-loading">
          <div class="modal-spinner" aria-hidden="true" />
          <p class="text-sm text-gray-500">Executing hook…</p>
        </div>
        <div v-else class="space-y-3">
          <UAlert
            v-if="!modalOk"
            color="red"
            variant="soft"
            title="Hook failed"
            :description="modalError || undefined"
          />
          <UAlert v-else color="green" variant="soft" title="Hook executed successfully" />
          <div v-if="modalLogs.length" class="log-output">
            <div v-for="(line, i) in modalLogs" :key="i" class="log-line">{{ line }}</div>
          </div>
          <p v-else class="text-sm text-gray-500 italic">No log output.</p>
        </div>
      </template>
    </UModal>
  </div>
</template>

<script setup lang="ts">
// ── Ambient type declarations injected into Monaco for editor hints ─────────
const AMBIENT_TYPES = `
interface RunContext {
  config: Record<string, unknown>;
  filter: string;
  taskCount: number;
}
interface TaskContext {
  task: { id: string; name: string; description: string; status: string; url: string; tags: string[] };
  config: Record<string, unknown>;
  branchName: string;
  prompt: string;
}
interface ResolveConflictsContext {
  task: { id: string; name: string; description: string; status: string; url: string; tags: string[] };
  config: Record<string, unknown>;
  branchName: string;
  conflictFiles: string[];
  prompt: string;
}
interface NonCodeTaskContext {
  task: { id: string; name: string; description: string; status: string; url: string; tags: string[] };
  config: Record<string, unknown>;
  prompt: string;
}
interface ThinkingTaskContext {
  task: { id: string; name: string; description: string; status: string; url: string; tags: string[] };
  config: Record<string, unknown>;
  branchName: string;
  subtasks: Array<{ id: number; title: string; description: string; status: string }>;
}
interface ReviewTaskContext {
  task: { id: string; name: string; description: string; status: string; url: string; tags: string[] };
  config: Record<string, unknown>;
  branchName: string;
  threads: Array<{ id: string; body: string; resolved: boolean }>;
  prompt: string;
}
interface CommentContext {
  task: { id: string; name: string; description: string; status: string; url: string; tags: string[] };
  config: Record<string, unknown>;
  text: string;
}
interface HookVM {
  runAI(prompt: string): Promise<{ success: boolean; output: string; error: string }>;
  postComment(taskId: string, text: string): Promise<void>;
  updateStatus(taskId: string, status: string): Promise<void>;
  getComments(taskId: string): Promise<Array<{ id: string; text: string; author: string }>>;
  log: { info(msg: string): void; warn(msg: string): void; error(msg: string): void };
}

interface AidevHooks {
  beforeRun?(context: RunContext, vm: HookVM): Promise<RunContext | void>;
  afterRun?(context: RunContext & { processed: number; skipped: number }, vm: HookVM): Promise<void>;
  beforeEachTask?(context: TaskContext, vm: HookVM): Promise<TaskContext | void>;
  afterEachTask?(context: TaskContext & { success: boolean }, vm: HookVM): Promise<void>;
  beforeResolveConflicts?(context: ResolveConflictsContext, vm: HookVM): Promise<ResolveConflictsContext | void>;
  afterResolveConflicts?(context: ResolveConflictsContext & { resolved: boolean }, vm: HookVM): Promise<void>;
  beforeNonCodeTask?(context: NonCodeTaskContext, vm: HookVM): Promise<NonCodeTaskContext | void>;
  afterNonCodeTask?(context: NonCodeTaskContext & { success: boolean; output: string }, vm: HookVM): Promise<void>;
  beforeThinkingTask?(context: ThinkingTaskContext, vm: HookVM): Promise<ThinkingTaskContext | void>;
  afterThinkingTask?(context: ThinkingTaskContext & { success: boolean }, vm: HookVM): Promise<void>;
  beforeReviewTask?(context: ReviewTaskContext, vm: HookVM): Promise<ReviewTaskContext | void>;
  afterReviewTask?(context: ReviewTaskContext & { success: boolean; resolvedCount: number }, vm: HookVM): Promise<void>;
  beforeComment?(context: CommentContext, vm: HookVM): Promise<CommentContext | void>;
  afterComment?(context: CommentContext, vm: HookVM): Promise<void>;
}
`;

// ── Known hook names (mirrors src/hooksTemplate.ts HOOK_NAMES) ─────────────
const HOOK_NAMES = [
  'beforeRun',
  'afterRun',
  'beforeEachTask',
  'afterEachTask',
  'beforeResolveConflicts',
  'afterResolveConflicts',
  'beforeNonCodeTask',
  'afterNonCodeTask',
  'beforeThinkingTask',
  'afterThinkingTask',
  'beforeReviewTask',
  'afterReviewTask',
  'beforeComment',
  'afterComment',
] as const;

type HookName = (typeof HOOK_NAMES)[number];

// ── Default mock data per hook ──────────────────────────────────────────────
const _TASK = {
  id: 'T-1',
  name: 'Example task',
  description: 'Build a feature',
  status: 'in-progress',
  url: '',
  tags: [] as string[],
};

const DEFAULT_MOCK_DATA: Record<HookName, string> = {
  beforeRun: JSON.stringify({ config: {}, filter: '', taskCount: 3 }, null, 2),
  afterRun: JSON.stringify({ config: {}, filter: '', taskCount: 3, processed: 2, skipped: 1 }, null, 2),
  beforeEachTask: JSON.stringify({ task: _TASK, config: {}, branchName: 'feature/example', prompt: 'Implement the feature.' }, null, 2),
  afterEachTask: JSON.stringify({ task: _TASK, config: {}, branchName: 'feature/example', prompt: 'Implement the feature.', success: true }, null, 2),
  beforeResolveConflicts: JSON.stringify({ task: _TASK, config: {}, branchName: 'feature/example', conflictFiles: ['src/index.ts'], prompt: 'Resolve conflicts.' }, null, 2),
  afterResolveConflicts: JSON.stringify({ task: _TASK, config: {}, branchName: 'feature/example', conflictFiles: ['src/index.ts'], prompt: 'Resolve conflicts.', resolved: true }, null, 2),
  beforeNonCodeTask: JSON.stringify({ task: _TASK, config: {}, prompt: 'Answer the question.' }, null, 2),
  afterNonCodeTask: JSON.stringify({ task: _TASK, config: {}, prompt: 'Answer the question.', success: true, output: 'AI response.' }, null, 2),
  beforeThinkingTask: JSON.stringify({ task: _TASK, config: {}, branchName: 'feature/example', subtasks: [{ id: 1, title: 'Subtask 1', description: 'Do X', status: 'open' }] }, null, 2),
  afterThinkingTask: JSON.stringify({ task: _TASK, config: {}, branchName: 'feature/example', subtasks: [{ id: 1, title: 'Subtask 1', description: 'Do X', status: 'done' }], success: true }, null, 2),
  beforeReviewTask: JSON.stringify({ task: _TASK, config: {}, branchName: 'feature/example', threads: [{ id: 'r-1', body: 'Fix X', resolved: false }], prompt: 'Address review comments.' }, null, 2),
  afterReviewTask: JSON.stringify({ task: _TASK, config: {}, branchName: 'feature/example', threads: [{ id: 'r-1', body: 'Fix X', resolved: true }], prompt: 'Address review comments.', success: true, resolvedCount: 1 }, null, 2),
  beforeComment: JSON.stringify({ task: _TASK, config: {}, text: 'Work complete. Tests pass.' }, null, 2),
  afterComment: JSON.stringify({ task: _TASK, config: {}, text: 'Work complete. Tests pass.' }, null, 2),
};

// ── Code samples ────────────────────────────────────────────────────────────
interface CodeSample {
  title: string;
  hookName: HookName;
  code: string;
}

const CODE_SAMPLES: CodeSample[] = [
  {
    title: '1. Safety guard — beforeEachTask',
    hookName: 'beforeEachTask',
    code: `export async function beforeEachTask(context, vm) {
  const { output } = await vm.runAI(
    \`Is this task potentially destructive or irreversible?\\nTask: \${context.task.name}\\nReply only YES or NO.\`
  );
  if (output.trim().toUpperCase().startsWith('YES')) {
    throw new Error(\`Safety guard blocked "\${context.task.name}" — looks destructive\`);
  }
  return context;
}`,
  },
  {
    title: '2. TypeScript type-check — afterEachTask',
    hookName: 'afterEachTask',
    code: `import { spawnSync } from 'node:child_process';

export async function afterEachTask(context, vm) {
  const result = spawnSync('npx', ['tsc', '--noEmit'], { cwd: process.cwd(), encoding: 'utf8' });
  if (result.status !== 0) {
    vm.log.error('TypeScript errors:\\n' + result.stdout);
    throw new Error('TypeScript type-check failed');
  }
  vm.log.info('TypeScript check passed');
}`,
  },
  {
    title: '3. Lint & format — afterEachTask',
    hookName: 'afterEachTask',
    code: `import { spawnSync } from 'node:child_process';

export async function afterEachTask(context, vm) {
  spawnSync('npx', ['eslint', '--fix', '.'], { cwd: process.cwd() });
  spawnSync('npx', ['prettier', '--write', '.'], { cwd: process.cwd() });
  vm.log.info('Lint and format complete');
}`,
  },
  {
    title: '4. Slack notification — afterRun',
    hookName: 'afterRun',
    code: `export async function afterRun(context, vm) {
  const webhookUrl = process.env.SLACK_WEBHOOK_URL;
  if (!webhookUrl) return;
  await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text: \`aidev run complete: \${context.processed} processed, \${context.skipped} skipped\`,
    }),
  });
  vm.log.info('Slack notification sent');
}`,
  },
  {
    title: '5. Append ticket ID to prompt — beforeEachTask',
    hookName: 'beforeEachTask',
    code: `export async function beforeEachTask(context, vm) {
  context.prompt = \`[Ticket: \${context.task.id}]\\n\${context.prompt}\`;
  vm.log.info('Prefixed prompt with ticket ID: ' + context.task.id);
  return context;
}`,
  },
  {
    title: '6. Post "Starting…" comment — beforeEachTask',
    hookName: 'beforeEachTask',
    code: `export async function beforeEachTask(context, vm) {
  await vm.postComment(context.task.id, \`🤖 Starting implementation of: \${context.task.name}\`);
  return context;
}`,
  },
  {
    title: '7. npm audit security scan — beforeEachTask',
    hookName: 'beforeEachTask',
    code: `import { spawnSync } from 'node:child_process';

export async function beforeEachTask(context, vm) {
  const result = spawnSync('npm', ['audit', '--audit-level=high'], { cwd: process.cwd(), encoding: 'utf8' });
  if (result.status !== 0) {
    vm.log.error('npm audit found high-severity issues:\\n' + result.stdout);
    throw new Error('Security audit failed — fix vulnerabilities before running AI tasks');
  }
  vm.log.info('npm audit passed');
  return context;
}`,
  },
  {
    title: '8. Test suite gate — afterEachTask',
    hookName: 'afterEachTask',
    code: `import { spawnSync } from 'node:child_process';

export async function afterEachTask(context, vm) {
  if (!context.success) return;
  const result = spawnSync('npm', ['test', '--', '--passWithNoTests'], { cwd: process.cwd(), encoding: 'utf8' });
  if (result.status !== 0) {
    vm.log.error('Test suite failed:\\n' + (result.stdout || result.stderr || ''));
    throw new Error('Tests failed after task completion');
  }
  vm.log.info('All tests passed');
}`,
  },
  {
    title: '9. Reject non-code tasks — beforeNonCodeTask',
    hookName: 'beforeNonCodeTask',
    code: `export async function beforeNonCodeTask(context, vm) {
  vm.log.info('Skipping non-code task: ' + context.task.name);
  throw new Error('Non-code tasks are disabled in this project');
}`,
  },
  {
    title: '10. Append signature to comments — beforeComment',
    hookName: 'beforeComment',
    code: `export async function beforeComment(context, vm) {
  const signature = '\\n\\n---\\n*Generated by aidev*';
  context.text = context.text + signature;
  vm.log.info('Signature appended to comment');
  return context;
}`,
  },
];

// ── Composable ──────────────────────────────────────────────────────────────
const api = useApi();

// ── Reactive state ──────────────────────────────────────────────────────────
const hooksPath = ref('');
const editorContent = ref('');
const loading = ref(false);
const saving = ref(false);
const regenerating = ref(false);
const addingMissing = ref(false);
const loadError = ref('');
const actionMessage = ref('');
const actionOk = ref(false);

const mockDataMap = ref<Record<string, string>>(
  Object.fromEntries(HOOK_NAMES.map((n) => [n, DEFAULT_MOCK_DATA[n]])),
);

const executingHook = ref<string | null>(null);
const showModal = ref(false);
const modalLoading = ref(false);
const modalTitle = ref('');
const modalOk = ref(true);
const modalError = ref('');
const modalLogs = ref<string[]>([]);

// ── Monaco editor (non-reactive, per-instance) ──────────────────────────────
const editorContainer = ref<HTMLElement | null>(null);

interface EditorInstance {
  getValue(): string;
  setValue(value: string): void;
  onDidChangeModelContent(fn: () => void): void;
  getSelection(): { getStartPosition(): { lineNumber: number; column: number } } | null;
  executeEdits(source: string, edits: Array<{ range: unknown; text: string }>): void;
  focus(): void;
  dispose(): void;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _monaco: any = null;
let _editor: EditorInstance | null = null;

watch(
  editorContainer,
  async (container) => {
    if (!container || _monaco) return;
    const { default: loader } = await import('@monaco-editor/loader');
    _monaco = await loader.init();
    const ts = _monaco.languages.typescript;
    ts.typescriptDefaults.setCompilerOptions({
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.NodeJs,
      allowNonTsExtensions: true,
      strict: true,
      noEmit: true,
      esModuleInterop: true,
    });
    ts.typescriptDefaults.setDiagnosticsOptions({
      noSemanticValidation: false,
      noSyntaxValidation: false,
    });
    ts.typescriptDefaults.addExtraLib(AMBIENT_TYPES, 'file:///aidev-hooks.d.ts');
    _editor = _monaco.editor.create(container, {
      value: editorContent.value,
      language: 'typescript',
      theme: 'vs',
      minimap: { enabled: false },
      automaticLayout: true,
      fontSize: 13,
      scrollBeyondLastLine: false,
      tabSize: 2,
    }) as EditorInstance;
    _editor.onDidChangeModelContent(() => {
      editorContent.value = _editor!.getValue();
    });
  },
  { flush: 'post' },
);

onBeforeUnmount(() => {
  _editor?.dispose();
  _editor = null;
  _monaco = null;
});

// ── Helpers ─────────────────────────────────────────────────────────────────
function extractMessage(err: unknown, fallback: string): string {
  return (
    (err as { data?: { statusMessage?: string }; message?: string })?.data?.statusMessage ??
    (err as Error)?.message ??
    fallback
  );
}

function flash(ok: boolean, message: string) {
  actionOk.value = ok;
  actionMessage.value = message;
}

// ── API calls ────────────────────────────────────────────────────────────────
async function loadHooks() {
  loading.value = true;
  loadError.value = '';
  actionMessage.value = '';
  try {
    const data = await api<{ content: string; path: string }>('/api/hooks');
    hooksPath.value = data.path;
    editorContent.value = data.content;
    if (_editor) _editor.setValue(data.content);
  } catch (err: unknown) {
    loadError.value = extractMessage(err, 'Failed to load hooks file');
  } finally {
    loading.value = false;
  }
}

async function save() {
  saving.value = true;
  actionMessage.value = '';
  const content = _editor ? _editor.getValue() : editorContent.value;
  try {
    await api<{ ok: boolean }>('/api/hooks', { method: 'PUT', body: { content } });
    flash(true, 'Hooks file saved.');
  } catch (err: unknown) {
    flash(false, extractMessage(err, 'Failed to save'));
  } finally {
    saving.value = false;
  }
}

async function regenerate() {
  if (!confirm('Replace the entire hooks file with the default template? Unsaved editor changes will be lost.')) {
    return;
  }
  regenerating.value = true;
  actionMessage.value = '';
  try {
    const data = await api<{ ok: boolean; content: string }>('/api/hooks-regenerate', { method: 'POST' });
    editorContent.value = data.content;
    if (_editor) _editor.setValue(data.content);
    flash(true, 'Hooks file regenerated from template.');
  } catch (err: unknown) {
    flash(false, extractMessage(err, 'Failed to regenerate'));
  } finally {
    regenerating.value = false;
  }
}

async function addMissingHooks() {
  addingMissing.value = true;
  actionMessage.value = '';
  try {
    const data = await api<{ ok: boolean; content: string; added: string[] }>('/api/hooks-update', { method: 'POST' });
    editorContent.value = data.content;
    if (_editor) _editor.setValue(data.content);
    flash(
      true,
      data.added.length
        ? `Added missing hooks: ${data.added.join(', ')}`
        : 'All hooks are already present.',
    );
  } catch (err: unknown) {
    flash(false, extractMessage(err, 'Failed to update hooks'));
  } finally {
    addingMissing.value = false;
  }
}

async function executeHook(hookName: string) {
  executingHook.value = hookName;
  modalTitle.value = `Execute: ${hookName}`;
  modalOk.value = true;
  modalError.value = '';
  modalLogs.value = [];
  modalLoading.value = true;
  showModal.value = true;

  let mockData: unknown = {};
  try {
    mockData = JSON.parse(mockDataMap.value[hookName] ?? '{}');
  } catch {
    modalLoading.value = false;
    modalOk.value = false;
    modalError.value = 'Mock data is not valid JSON';
    executingHook.value = null;
    return;
  }

  try {
    const result = await api<{ ok: boolean; logs: string[]; error?: string }>('/api/hooks-execute', {
      method: 'POST',
      body: { hookName, mockData },
    });
    modalOk.value = result.ok;
    modalError.value = result.error ?? '';
    modalLogs.value = result.logs;
  } catch (err: unknown) {
    modalOk.value = false;
    modalError.value = extractMessage(err, 'Request failed');
    modalLogs.value = [];
  } finally {
    executingHook.value = null;
    modalLoading.value = false;
  }
}

interface SampleOption {
  label: string;
  hookName: HookName;
  idx: number;
  value: string;
}

const selectedSample = ref<string | undefined>(undefined);
const sampleOptions: SampleOption[] = CODE_SAMPLES.map((s, i) => ({
  label: s.title,
  hookName: s.hookName,
  idx: i,
  value: String(i),
}));

function onSampleSelect(value: string | number | undefined) {
  if (value === undefined) return;
  nextTick(() => { selectedSample.value = undefined; });

  const idx = typeof value === 'string' ? parseInt(value, 10) : value;
  const sample = CODE_SAMPLES[idx];
  if (!sample) return;

  if (_editor && _monaco) {
    const selection = _editor.getSelection();
    const pos = selection?.getStartPosition() ?? { lineNumber: 1, column: 1 };
    _editor.executeEdits('sample-insert', [
      {
        range: new _monaco.Range(pos.lineNumber, pos.column, pos.lineNumber, pos.column),
        text: '\n' + sample.code + '\n',
      },
    ]);
    _editor.focus();
  }

  const panelEl = document.getElementById(`hook-panel-${sample.hookName}`);
  if (panelEl) {
    (panelEl as HTMLDetailsElement).open = true;
    panelEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    panelEl.classList.add('hook-panel-highlight');
    setTimeout(() => panelEl.classList.remove('hook-panel-highlight'), 1200);
  }
}

onMounted(() => {
  void loadHooks();
});
</script>

<style scoped>
.editor-container {
  height: 520px;
  border: 1px solid #e5e7eb;
  border-radius: 0.375rem;
  overflow: hidden;
}

.editor-placeholder {
  height: 520px;
  border: 1px solid #e5e7eb;
  border-radius: 0.375rem;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #9ca3af;
  font-size: 0.875rem;
}

.sample-select-menu {
  min-width: 200px;
  max-width: 240px;
}

.hook-panel {
  border: 1px solid #e5e7eb;
  border-radius: 0.375rem;
  overflow: hidden;
}

.hook-panel-summary {
  cursor: pointer;
  padding: 0.5rem 0.75rem;
  font-size: 0.875rem;
  background: #f9fafb;
  list-style: none;
  display: flex;
  align-items: center;
  user-select: none;
}
.hook-panel-summary:hover {
  background: #f3f4f6;
}
.hook-panel-summary::marker,
.hook-panel-summary::-webkit-details-marker {
  display: none;
}
.hook-panel-summary::before {
  content: '▸';
  margin-right: 0.5rem;
  font-size: 0.75rem;
  color: #6b7280;
}
details[open] > .hook-panel-summary::before {
  content: '▾';
}

.hook-panel-body {
  padding: 0.75rem;
  border-top: 1px solid #e5e7eb;
}

.mock-json {
  width: 100%;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.8rem;
  padding: 0.5rem;
  border: 1px solid #d1d5db;
  border-radius: 0.375rem;
  background: #f9fafb;
  color: #111827;
  resize: vertical;
  line-height: 1.5;
}
.mock-json:focus {
  outline: 2px solid #3b82f6;
  outline-offset: 1px;
}

.log-output {
  background: #0f172a;
  border-radius: 0.375rem;
  padding: 0.75rem;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.8rem;
  max-height: 320px;
  overflow-y: auto;
}

.log-line {
  color: #e2e8f0;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-all;
}

.modal-loading {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.75rem;
  padding: 2rem 0;
}

.modal-spinner {
  width: 1.75rem;
  height: 1.75rem;
  border: 2px solid #e5e7eb;
  border-top-color: #3b82f6;
  border-radius: 50%;
  animation: modal-spin 0.7s linear infinite;
}

@keyframes modal-spin {
  to {
    transform: rotate(360deg);
  }
}

.hook-panel-highlight {
  animation: hook-highlight 1.2s ease-out;
}

@keyframes hook-highlight {
  0%   { box-shadow: 0 0 0 3px #3b82f6; }
  100% { box-shadow: 0 0 0 3px transparent; }
}
</style>

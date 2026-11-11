<template>
  <div class="hooks">
    <header class="page-head">
      <div>
        <h1>Custom steps</h1>
        <p>
          Small scripts that run at set moments, like before aidev starts a task or after it finishes.
          Use them to add checks, send notifications, or change what aidev does. You don't need them to use aidev.
        </p>
        <p v-if="hooksPath" class="file-line"><UIcon name="i-lucide-file-code" class="size-3.5" aria-hidden="true" /> <code>{{ hooksPath }}</code></p>
        <p v-else class="file-line file-line--warn"><UIcon name="i-lucide-triangle-alert" class="size-3.5" aria-hidden="true" /> No steps file is set up yet. Add its path under Settings → Files.</p>
      </div>
      <div class="head-actions">
        <UDropdownMenu :items="moreItems" :content="{ align: 'end' }">
          <UButton color="neutral" variant="ghost" icon="i-lucide-ellipsis" aria-label="More actions" />
        </UDropdownMenu>
        <UButton :loading="saving" :disabled="saving || !dirty" icon="i-lucide-save" @click="save">
          {{ dirty ? 'Save changes' : 'Saved' }}
        </UButton>
      </div>
    </header>

    <UAlert v-if="loadError" color="error" variant="soft" icon="i-lucide-triangle-alert" title="Couldn't open your steps file" :description="loadError" class="mb-4" />
    <UAlert
      v-if="actionMessage"
      :color="actionOk ? 'success' : 'error'"
      variant="soft"
      :icon="actionOk ? 'i-lucide-circle-check' : 'i-lucide-circle-x'"
      :title="actionOk ? 'Done' : 'That didn’t work'"
      :description="actionMessage"
      class="mb-4"
    />

    <div class="tabs" role="tablist" aria-label="Custom steps sections">
      <button
        v-for="t in tabs"
        :id="`tab-${t.id}`"
        :key="t.id"
        type="button"
        role="tab"
        class="tab"
        :class="{ 'tab--on': tab === t.id }"
        :aria-selected="tab === t.id"
        :aria-controls="`panel-${t.id}`"
        @click="tab = t.id"
      >
        <UIcon :name="t.icon" class="size-4" aria-hidden="true" />
        {{ t.label }}
        <span v-if="t.id === 'editor' && dirty" class="tab-dot" aria-label="Unsaved changes" />
      </button>
    </div>

    <!-- Editor -->
    <section v-show="tab === 'editor'" id="panel-editor" class="panel" role="tabpanel" aria-labelledby="tab-editor">
      <p class="panel-sub">
        Each function below is one moment. Write code inside it and aidev runs it at that moment.
        Not sure where to start? Try the <button type="button" class="link" @click="tab = 'ideas'">starter ideas</button>.
      </p>
      <ClientOnly>
        <div ref="editorContainer" class="editor-container" />
        <template #fallback>
          <div class="editor-placeholder">Loading editor…</div>
        </template>
      </ClientOnly>
    </section>

    <!-- Starter ideas -->
    <section v-show="tab === 'ideas'" id="panel-ideas" class="panel" role="tabpanel" aria-labelledby="tab-ideas">
      <p class="panel-sub">Pick an idea and we'll add its code to your steps file. You can edit it afterwards.</p>
      <ul class="ideas">
        <li v-for="(s, i) in CODE_SAMPLES" :key="i" class="idea">
          <div class="idea-text">
            <h3>{{ SAMPLE_INFO[i]?.title ?? s.title }}</h3>
            <p>{{ SAMPLE_INFO[i]?.blurb }}</p>
            <span class="when">{{ HOOK_INFO[s.hookName].label }}</span>
          </div>
          <UButton color="neutral" variant="soft" icon="i-lucide-plus" @click="insertSample(i)">Add</UButton>
        </li>
      </ul>
    </section>

    <!-- Try a step -->
    <section v-show="tab === 'try'" id="panel-try" class="panel" role="tabpanel" aria-labelledby="tab-try">
      <p class="panel-sub">
        Run a step now with made-up example data to see what it does. Nothing real is changed unless your step does it.
        Save first so you test your latest code.
      </p>
      <div class="try-list">
        <details v-for="hookName in HOOK_NAMES" :id="`hook-panel-${hookName}`" :key="hookName" class="try">
          <summary class="try-summary">
            <UIcon name="i-lucide-chevron-right" class="chev size-4" aria-hidden="true" />
            <span class="try-name">{{ HOOK_INFO[hookName].label }}</span>
            <code class="try-code">{{ hookName }}</code>
          </summary>
          <div class="try-body">
            <label :for="`mock-${hookName}`" class="try-label">Example data (JSON)</label>
            <textarea :id="`mock-${hookName}`" v-model="mockDataMap[hookName]" class="mock-json" rows="6" spellcheck="false" />
            <UButton
              color="primary"
              variant="soft"
              icon="i-lucide-play"
              class="mt-3"
              :loading="executingHook === hookName"
              :disabled="executingHook !== null"
              @click="executeHook(hookName)"
            >
              Run this step
            </UButton>
          </div>
        </details>
      </div>
    </section>

    <!-- Result modal -->
    <UModal v-model:open="showModal" :title="modalTitle" description="Result of running this step with the example data.">
      <template #body>
        <div v-if="modalLoading" class="modal-loading">
          <UIcon name="i-lucide-loader-circle" class="size-7 animate-spin text-primary" aria-hidden="true" />
          <p class="text-sm">Running the step…</p>
        </div>
        <div v-else class="space-y-3">
          <UAlert
            v-if="!modalOk"
            color="error"
            variant="soft"
            icon="i-lucide-circle-x"
            title="The step failed"
            :description="modalError || undefined"
          />
          <UAlert v-else color="success" variant="soft" icon="i-lucide-circle-check" title="The step ran successfully" />
          <div v-if="modalLogs.length" class="log-output" role="log" aria-label="Step output">
            <div v-for="(line, i) in modalLogs" :key="i" class="log-line">{{ line }}</div>
          </div>
          <p v-else class="text-sm text-muted">The step didn't print anything.</p>
        </div>
      </template>
    </UModal>

    <!-- Confirm: start over -->
    <UModal v-model:open="confirmRegen" title="Start over from the template?" description="This replaces everything in your steps file.">
      <template #body>
        <p class="text-sm">Any code you wrote, including unsaved edits in the editor, will be lost. This can't be undone.</p>
      </template>
      <template #footer>
        <div class="flex justify-end gap-2 w-full">
          <UButton color="neutral" variant="ghost" @click="confirmRegen = false">Keep my steps</UButton>
          <UButton color="error" :loading="regenerating" @click="regenerate">Replace with template</UButton>
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
const savedContent = ref('');
const dirty = computed(() => editorContent.value !== savedContent.value);
const confirmRegen = ref(false);
const tab = ref<'editor' | 'ideas' | 'try'>('editor');
const tabs = [
  { id: 'editor', label: 'Your steps', icon: 'i-lucide-code-xml' },
  { id: 'ideas', label: 'Starter ideas', icon: 'i-lucide-lightbulb' },
  { id: 'try', label: 'Try a step', icon: 'i-lucide-flask-conical' },
] as const;

const HOOK_INFO: Record<HookName, { label: string }> = {
  beforeRun: { label: 'Before a run starts' },
  afterRun: { label: 'After a run finishes' },
  beforeEachTask: { label: 'Before each coding task' },
  afterEachTask: { label: 'After each coding task' },
  beforeResolveConflicts: { label: 'Before fixing merge conflicts' },
  afterResolveConflicts: { label: 'After fixing merge conflicts' },
  beforeNonCodeTask: { label: 'Before each non-coding task' },
  afterNonCodeTask: { label: 'After each non-coding task' },
  beforeThinkingTask: { label: 'Before breaking a task into steps' },
  afterThinkingTask: { label: 'After breaking a task into steps' },
  beforeReviewTask: { label: 'Before handling review feedback' },
  afterReviewTask: { label: 'After handling review feedback' },
  beforeComment: { label: 'Before aidev posts a comment' },
  afterComment: { label: 'After aidev posts a comment' },
};

const SAMPLE_INFO: { title: string; blurb: string }[] = [
  { title: 'Stop risky tasks', blurb: 'Asks the AI whether a task looks destructive or irreversible, and stops it if so.' },
  { title: 'Check for TypeScript errors', blurb: 'Runs the type checker after each task and fails the task if it finds errors.' },
  { title: 'Tidy the code automatically', blurb: 'Runs the linter and formatter after each task so the code stays neat.' },
  { title: 'Ping Slack when a run ends', blurb: 'Sends a summary message to Slack. Needs a SLACK_WEBHOOK_URL setting.' },
  { title: 'Add the ticket ID to the AI’s instructions', blurb: 'Puts the task’s ID at the top of what the AI reads, for easier tracing.' },
  { title: 'Say “Starting…” on the task', blurb: 'Posts a short comment on the task the moment aidev begins working on it.' },
  { title: 'Scan for security problems first', blurb: 'Runs npm audit before each task and stops if it finds serious issues.' },
  { title: 'Only continue if tests pass', blurb: 'Runs your test suite after each task and fails the task if anything breaks.' },
  { title: 'Skip non-coding tasks', blurb: 'Rejects tasks that aren’t about code, so aidev only handles coding work.' },
  { title: 'Sign aidev’s comments', blurb: 'Adds a “Generated by aidev” line to the end of every comment it posts.' },
];

const moreItems = computed(() => [
  [
    { label: 'Reload from file', icon: 'i-lucide-refresh-cw', disabled: loading.value, onSelect: () => { void loadHooks(); } },
    { label: 'Add any missing steps', icon: 'i-lucide-list-plus', disabled: addingMissing.value, onSelect: () => { void addMissingHooks(); } },
  ],
  [
    { label: 'Start over from template…', icon: 'i-lucide-rotate-ccw', color: 'error' as const, onSelect: () => { confirmRegen.value = true; } },
  ],
]);

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
      theme: colorMode.value === 'dark' ? 'vs-dark' : 'vs',
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
    savedContent.value = data.content;
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
    savedContent.value = content;
    flash(true, 'Your steps were saved.');
  } catch (err: unknown) {
    flash(false, extractMessage(err, 'Failed to save'));
  } finally {
    saving.value = false;
  }
}

async function regenerate() {
  regenerating.value = true;
  actionMessage.value = '';
  try {
    const data = await api<{ ok: boolean; content: string }>('/api/hooks-regenerate', { method: 'POST' });
    editorContent.value = data.content;
    savedContent.value = data.content;
    if (_editor) _editor.setValue(data.content);
    confirmRegen.value = false;
    flash(true, 'Your steps file was reset to the template.');
  } catch (err: unknown) {
    flash(false, extractMessage(err, 'Failed to regenerate'));
  } finally {
    regenerating.value = false;
    confirmRegen.value = false;
  }
}

async function addMissingHooks() {
  addingMissing.value = true;
  actionMessage.value = '';
  try {
    const data = await api<{ ok: boolean; content: string; added: string[] }>('/api/hooks-update', { method: 'POST' });
    editorContent.value = data.content;
    savedContent.value = data.content;
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

function insertSample(idx: number) {
  const sample = CODE_SAMPLES[idx];
  if (!sample) return;
  tab.value = 'editor';
  nextTick(() => {
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
      flash(true, `Added “${SAMPLE_INFO[idx]?.title ?? sample.title}”. Review the code, then save.`);
    }
  });
}

// Save with Cmd/Ctrl+S while the editor tab is open.
defineShortcuts({
  meta_s: { usingInput: true, handler: () => { if (tab.value === 'editor' && dirty.value && !saving.value) void save(); } },
});

// Keep Monaco's theme in step with light/dark mode.
const colorMode = useColorMode();
watch(() => colorMode.value, (v) => { _monaco?.editor.setTheme(v === 'dark' ? 'vs-dark' : 'vs'); });

onBeforeRouteLeave(() => (dirty.value ? window.confirm('You have unsaved changes. Leave without saving?') : true));

onMounted(() => {
  void loadHooks();
});
</script>

<style scoped>
.hooks { padding-bottom: 2rem; }
.page-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 1rem; flex-wrap: wrap; padding: 0.75rem 0 1.25rem; }
.page-head h1 { margin: 0; font-size: 1.875rem; font-weight: 700; letter-spacing: -0.02em; color: var(--ui-text-highlighted); }
.page-head p { margin: 0.25rem 0 0; color: var(--wb-ink-soft); max-width: 46rem; }
.file-line { display: flex; align-items: center; gap: 0.375rem; font-size: 0.8125rem; }
.file-line code { font-family: var(--font-mono); }
.file-line--warn { color: var(--wb-wait); }
.head-actions { display: flex; align-items: center; gap: 0.5rem; }

.tabs { display: flex; gap: 0.25rem; padding: 0.25rem; margin-bottom: 1rem; width: fit-content; max-width: 100%; overflow-x: auto; border-radius: 0.875rem; background: var(--ui-bg-elevated); }
.tab {
  display: inline-flex; align-items: center; gap: 0.5rem; min-height: 2.5rem; padding: 0 1rem; border: 0; border-radius: 0.625rem;
  background: transparent; color: var(--wb-ink-soft); font-size: 0.9375rem; font-weight: 600; white-space: nowrap; cursor: pointer;
  transition: background-color 0.15s, color 0.15s;
}
.tab:hover { color: var(--ui-text-highlighted); }
.tab:focus-visible { outline: 2px solid var(--ui-primary); outline-offset: 2px; }
.tab--on { background: var(--ui-bg); color: var(--ui-text-highlighted); box-shadow: 0 1px 2px rgb(0 0 0 / 0.1); }
.tab-dot { width: 0.5rem; height: 0.5rem; border-radius: 50%; background: var(--wb-wait); }

.panel { padding: 1.25rem; border-radius: 1rem; background: var(--ui-bg); border: 1px solid var(--ui-border); }
.panel-sub { margin: 0 0 1rem; font-size: 0.9375rem; color: var(--wb-ink-soft); max-width: 46rem; }
.link { background: none; border: 0; padding: 0; color: var(--ui-primary); font: inherit; font-weight: 600; text-decoration: underline; text-underline-offset: 2px; cursor: pointer; }
.link:focus-visible { outline: 2px solid var(--ui-primary); outline-offset: 2px; border-radius: 2px; }

.editor-container, .editor-placeholder { height: 32rem; border: 1px solid var(--ui-border); border-radius: 0.75rem; overflow: hidden; }
.editor-placeholder { display: flex; align-items: center; justify-content: center; color: var(--wb-ink-soft); font-size: 0.875rem; }

.ideas { list-style: none; margin: 0; padding: 0; }
.idea { display: flex; align-items: center; justify-content: space-between; gap: 1rem; padding: 0.875rem 0; }
.idea + .idea { border-top: 1px solid var(--ui-border); }
.idea h3 { margin: 0; font-size: 1rem; font-weight: 700; color: var(--ui-text-highlighted); }
.idea p { margin: 0.125rem 0 0.375rem; font-size: 0.9375rem; color: var(--wb-ink-soft); max-width: 40rem; }
.when { font-size: 0.75rem; font-weight: 600; padding: 0.125rem 0.5rem; border-radius: 999px; background: var(--ui-bg-elevated); color: var(--wb-ink-soft); }

.try-list { display: flex; flex-direction: column; gap: 0.5rem; }
.try { border: 1px solid var(--ui-border); border-radius: 0.75rem; overflow: hidden; }
.try-summary { display: flex; align-items: center; gap: 0.625rem; min-height: 3rem; padding: 0 1rem; cursor: pointer; list-style: none; user-select: none; }
.try-summary::-webkit-details-marker { display: none; }
.try-summary:hover { background: var(--ui-bg-elevated); }
.try-summary:focus-visible { outline: 2px solid var(--ui-primary); outline-offset: -2px; }
.chev { color: var(--wb-ink-soft); transition: transform 0.15s; }
details[open] > .try-summary .chev { transform: rotate(90deg); }
.try-name { font-weight: 600; color: var(--ui-text-highlighted); }
.try-code { margin-left: auto; font-family: var(--font-mono); font-size: 0.75rem; color: var(--wb-ink-soft); }
.try-body { padding: 1rem; border-top: 1px solid var(--ui-border); }
.try-label { display: block; margin-bottom: 0.375rem; font-size: 0.8125rem; font-weight: 600; color: var(--wb-ink-soft); }
.mock-json {
  width: 100%; padding: 0.75rem; font-family: var(--font-mono); font-size: 0.8125rem; line-height: 1.5; resize: vertical;
  border: 1px solid var(--ui-border-accented); border-radius: 0.625rem; background: var(--ui-bg-muted); color: var(--ui-text);
}
.mock-json:focus { outline: 2px solid var(--ui-primary); outline-offset: 1px; }

.log-output { background: oklch(21% 0.02 250); border-radius: 0.625rem; padding: 0.875rem; font-family: var(--font-mono); font-size: 0.8125rem; max-height: 20rem; overflow-y: auto; }
.log-line { color: oklch(92% 0.01 250); line-height: 1.6; white-space: pre-wrap; word-break: break-all; }
.modal-loading { display: flex; flex-direction: column; align-items: center; gap: 0.75rem; padding: 2rem 0; }

@media (max-width: 700px) {
  .idea { flex-direction: column; align-items: flex-start; }
  .try-code { display: none; }
  .panel { padding: 1rem; }
}
</style>

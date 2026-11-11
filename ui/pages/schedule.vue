<template>
  <div class="sched">
    <header class="page-head">
      <div>
        <h1>Schedule</h1>
        <p>Let aidev check for tasks and work on them by itself, so you don't have to press Run.</p>
      </div>
      <UButton color="neutral" variant="ghost" icon="i-lucide-refresh-cw" :loading="loading" :disabled="loading" @click="reload">Refresh</UButton>
    </header>

    <UAlert v-if="loadError" color="error" variant="soft" icon="i-lucide-triangle-alert" title="Couldn't load schedules" :description="loadError" class="mb-5" />
    <UAlert
      v-if="actionMessage"
      :color="actionOk ? 'success' : 'error'"
      variant="soft"
      :icon="actionOk ? 'i-lucide-circle-check' : 'i-lucide-circle-x'"
      :title="actionOk ? 'Done' : 'That didn’t work'"
      :description="actionMessage"
      class="mb-5"
    />

    <section class="panel status" :class="currentEntry ? 'status--on' : 'status--off'" aria-live="polite">
      <span class="status-icon" aria-hidden="true"><UIcon :name="currentEntry ? 'i-lucide-calendar-check' : 'i-lucide-calendar-off'" class="size-6" /></span>
      <div class="status-text">
        <h2>{{ currentEntry ? `On: runs ${currentLabel.toLowerCase()}` : 'Off: aidev only runs when you start it' }}</h2>
        <p>For <strong>{{ projectName }}</strong><template v-if="data"> · managed by {{ backendLabel }}</template></p>
      </div>
      <UButton
        v-if="currentEntry"
        color="error"
        variant="soft"
        icon="i-lucide-power"
        @click="confirmRemove = currentEntry"
      >
        Turn off
      </UButton>
    </section>

    <section class="panel" aria-labelledby="freq-h">
      <h2 id="freq-h">How often should aidev run?</h2>
      <URadioGroup
        v-model="selectedCron"
        :items="presetItems"
        variant="card"
        legend="How often should aidev run?"
        :ui="{ fieldset: 'grid gap-3 sm:grid-cols-2', legend: 'sr-only' }"
      />
      <p v-if="selectedPreset" class="hint">Technical name for this timing: <code>{{ selectedPreset.cron }}</code></p>

      <div class="adv">
        <button type="button" class="adv-toggle" :aria-expanded="showAdvanced" @click="showAdvanced = !showAdvanced">
          <UIcon name="i-lucide-chevron-right" class="chev size-4" :class="{ 'chev--open': showAdvanced }" aria-hidden="true" />
          Advanced
        </button>
        <div v-if="showAdvanced" class="adv-body">
          <UFormField label="Use a different settings file" description="Optional. Scheduled runs will read settings from this file instead of the project's own.">
            <UInput v-model="envFile" placeholder="/path/to/.env.aidev" autocomplete="off" class="w-full" />
          </UFormField>
        </div>
      </div>

      <div class="actions">
        <UButton :loading="saving" :disabled="saving || !selectedCron || !changed" icon="i-lucide-check" @click="saveSchedule">
          {{ currentEntry ? 'Update schedule' : 'Turn on schedule' }}
        </UButton>
        <span v-if="currentEntry && !changed" class="hint">Nothing to update. This is what's running now.</span>
      </div>
    </section>

    <section class="panel" aria-labelledby="others-h">
      <h2 id="others-h">Other projects on this computer</h2>
      <p v-if="data && otherEntries.length === 0" class="hint hint--flush">No other aidev schedules are set up here.</p>
      <ul v-else class="others">
        <li v-for="row in otherEntries" :key="row.id" class="other">
          <UIcon name="i-lucide-folder" class="size-5 shrink-0 text-muted" aria-hidden="true" />
          <div class="other-text">
            <strong>{{ folderName(row.cwd) }}</strong>
            <span class="other-meta">{{ row.label }}<template v-if="row.cron"> · <code>{{ row.cron }}</code></template></span>
            <code class="other-path">{{ row.cwd }}</code>
          </div>
          <UButton color="error" variant="ghost" icon="i-lucide-trash-2" :aria-label="`Remove schedule for ${folderName(row.cwd)}`" :loading="removingId === row.id" :disabled="removingId !== null" @click="confirmRemove = row">
            Remove
          </UButton>
        </li>
      </ul>
    </section>

    <section v-if="data?.fixSupported" class="panel" aria-labelledby="fix-h">
      <div class="fix">
        <div>
          <h2 id="fix-h">Schedules stopped working?</h2>
          <p class="hint hint--flush">If you moved aidev or updated Node, schedules can point at old paths. Repair updates them all.</p>
        </div>
        <UButton color="neutral" variant="soft" icon="i-lucide-wrench" :loading="fixing" :disabled="fixing || !data?.entries.length" @click="runFix">Repair paths</UButton>
      </div>
    </section>

    <UAlert v-if="data && !data.fixSupported" color="warning" variant="soft" icon="i-lucide-info" title="Repair isn't available on Windows" description="If paths change, turn the schedule off and on again for each project." class="mt-5" />
    <UAlert v-if="data?.backend === 'launchd'" color="info" variant="soft" icon="i-lucide-info" title="On macOS, schedules run in your login session" description="That lets AI tools use your saved logins in the Keychain. Cron isn't used." class="mt-5" />

    <UModal v-model:open="confirmOpen" title="Turn off this schedule?" description="aidev will stop running automatically for this project.">
      <template #body>
        <p v-if="confirmRemove" class="text-sm">
          <strong>{{ folderName(confirmRemove.cwd) }}</strong> will only run when you start it yourself. Your tasks and settings stay as they are.
        </p>
      </template>
      <template #footer>
        <div class="flex justify-end gap-2 w-full">
          <UButton color="neutral" variant="ghost" @click="confirmRemove = null">Keep it on</UButton>
          <UButton color="error" :loading="removingCurrent" @click="confirmAndRemove">Turn off</UButton>
        </div>
      </template>
    </UModal>
  </div>
</template>

<script setup lang="ts">
import type {
  ScheduleEntry,
  SchedulesResponse,
} from '~/types/schedule';

const api = useApi();

const data = ref<SchedulesResponse | null>(null);
const loading = ref(false);
const saving = ref(false);
const fixing = ref(false);
const removingId = ref<number | null>(null);
const removingCurrent = ref(false);
const confirmRemove = ref<ScheduleEntry | null>(null);
const confirmOpen = computed({ get: () => confirmRemove.value !== null, set: (v) => { if (!v) confirmRemove.value = null; } });
const showAdvanced = ref(false);
const loadError = ref('');
const actionMessage = ref('');
const actionOk = ref(false);

const selectedCron = ref('');
const envFile = ref('');

const presetItems = computed(() => (data.value?.presets ?? []).map((p) => ({ label: p.label, value: p.cron })));

const selectedPreset = computed(() => data.value?.presets.find((p) => p.cron === selectedCron.value) ?? null);
const currentLabel = computed(() => currentEntry.value?.label || currentEntry.value?.cron || '');
const changed = computed(() => {
  const e = currentEntry.value;
  if (!e) return true;
  const ei = e.extraArgs.indexOf('-e');
  const curEnv = ei >= 0 ? e.extraArgs[ei + 1] ?? '' : '';
  return e.cron !== selectedCron.value || curEnv !== envFile.value.trim();
});
const projectName = computed(() => (data.value?.currentCwd ?? '').split(/[\\/]/).filter(Boolean).pop() || 'this project');
const otherEntries = computed(() => (data.value?.entries ?? []).filter((e) => !e.current));
function folderName(p: string) { return p.split(/[\\/]/).filter(Boolean).pop() || p; }

const currentEntry = computed(() => data.value?.entries.find((e) => e.current) ?? null);

const backendLabel = computed(() => {
  const b = data.value?.backend;
  if (b === 'launchd') return 'LaunchAgent';
  if (b === 'schtasks') return 'Task Scheduler';
  return 'cron';
});

function syncFormFromCurrent(entry: ScheduleEntry | null) {
  if (entry?.cron) {
    selectedCron.value = entry.cron;
    const ei = entry.extraArgs.indexOf('-e');
    envFile.value = ei >= 0 && entry.extraArgs[ei + 1] ? entry.extraArgs[ei + 1]! : '';
  } else if (data.value?.presets[0]) {
    selectedCron.value = data.value.presets[0].cron;
    envFile.value = '';
  }
}

async function reload() {
  loading.value = true;
  loadError.value = '';
  try {
    data.value = await api<SchedulesResponse>('/api/schedule');
    syncFormFromCurrent(currentEntry.value);
  } catch (err: unknown) {
    const msg =
      (err as { data?: { statusMessage?: string }; message?: string })?.data?.statusMessage ??
      (err as Error)?.message ??
      'Failed to load schedules';
    loadError.value = msg;
  } finally {
    loading.value = false;
  }
}

function flash(ok: boolean, message: string) {
  actionOk.value = ok;
  actionMessage.value = message;
}

async function saveSchedule() {
  saving.value = true;
  actionMessage.value = '';
  try {
    const res = await api<{ ok: boolean; message: string }>('/api/schedule', {
      method: 'POST',
      body: { cron: selectedCron.value, envFile: envFile.value || undefined },
    });
    flash(true, res.message);
    await reload();
  } catch (err: unknown) {
    const msg =
      (err as { data?: { statusMessage?: string }; message?: string })?.data?.statusMessage ??
      (err as Error)?.message ??
      'Failed to set schedule';
    flash(false, msg);
  } finally {
    saving.value = false;
  }
}

async function removeRow(id: number) {
  removingId.value = id;
  actionMessage.value = '';
  try {
    const res = await api<{ ok: boolean; message: string }>(`/api/schedule/${id}`, {
      method: 'DELETE',
    });
    flash(true, res.message);
    await reload();
  } catch (err: unknown) {
    const msg =
      (err as { data?: { statusMessage?: string }; message?: string })?.data?.statusMessage ??
      (err as Error)?.message ??
      'Failed to remove schedule';
    flash(false, msg);
  } finally {
    removingId.value = null;
  }
}

async function confirmAndRemove() {
  const entry = confirmRemove.value;
  if (!entry) return;
  removingCurrent.value = true;
  try {
    await removeRow(entry.id);
  } finally {
    removingCurrent.value = false;
    confirmRemove.value = null;
  }
}

async function runFix() {
  fixing.value = true;
  actionMessage.value = '';
  try {
    const res = await api<{ ok: boolean; message: string; fixed: number; unchanged: number }>(
      '/api/schedule/fix',
      { method: 'POST' },
    );
    flash(true, res.message);
    await reload();
  } catch (err: unknown) {
    const msg =
      (err as { data?: { statusMessage?: string }; message?: string })?.data?.statusMessage ??
      (err as Error)?.message ??
      'Failed to fix schedules';
    flash(false, msg);
  } finally {
    fixing.value = false;
  }
}

onMounted(() => {
  void reload();
});

onBeforeRouteLeave(() => (changed.value && !!currentEntry.value && data.value ? window.confirm('You changed the schedule but did not save it. Leave anyway?') : true));
</script>

<style scoped>
.sched { padding-bottom: 2rem; display: flex; flex-direction: column; gap: 1.25rem; }
.page-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 1rem; padding: 0.75rem 0 0.25rem; }
.page-head h1 { margin: 0; font-size: 1.875rem; font-weight: 700; letter-spacing: -0.02em; color: var(--ui-text-highlighted); }
.page-head p { margin: 0.25rem 0 0; color: var(--wb-ink-soft); max-width: 42rem; }
.panel { padding: 1.5rem; border-radius: 1rem; background: var(--ui-bg); border: 1px solid var(--ui-border); }
.panel h2 { margin: 0 0 1rem; font-size: 1.0625rem; font-weight: 700; color: var(--ui-text-highlighted); }
.hint { margin: 0.75rem 0 0; font-size: 0.8125rem; color: var(--wb-ink-soft); }
.hint--flush { margin: 0; }
.hint code, .other-meta code { font-family: var(--font-mono); font-size: 0.75rem; }

.status { display: flex; align-items: center; gap: 1rem; flex-wrap: wrap; }
.status h2 { margin: 0; font-size: 1.125rem; }
.status p { margin: 0.125rem 0 0; font-size: 0.875rem; color: var(--wb-ink-soft); }
.status-text { flex: 1; min-width: 12rem; }
.status-icon { display: grid; place-items: center; width: 3rem; height: 3rem; border-radius: 0.875rem; background: var(--ui-bg-elevated); color: var(--wb-ink-soft); }
.status--on .status-icon { background: color-mix(in oklch, var(--wb-ok) 18%, transparent); color: var(--wb-ok); }

.adv { margin-top: 1.25rem; }
.adv-toggle { display: inline-flex; align-items: center; gap: 0.375rem; min-height: 2.25rem; padding: 0; border: 0; background: none; color: var(--wb-ink-soft); font: inherit; font-weight: 600; cursor: pointer; }
.adv-toggle:hover { color: var(--ui-text-highlighted); }
.adv-toggle:focus-visible { outline: 2px solid var(--ui-primary); outline-offset: 2px; border-radius: 4px; }
.chev { transition: transform 0.15s; }
.chev--open { transform: rotate(90deg); }
.adv-body { margin-top: 0.75rem; max-width: 32rem; }
.actions { display: flex; align-items: center; gap: 0.875rem; flex-wrap: wrap; margin-top: 1.5rem; }
.actions .hint { margin: 0; }

.others { list-style: none; margin: 0; padding: 0; }
.other { display: flex; align-items: center; gap: 0.875rem; padding: 0.75rem 0; }
.other + .other { border-top: 1px solid var(--ui-border); }
.other-text { display: flex; flex-direction: column; flex: 1; min-width: 0; }
.other-text strong { color: var(--ui-text-highlighted); }
.other-meta { font-size: 0.8125rem; color: var(--wb-ink-soft); }
.other-path { font-family: var(--font-mono); font-size: 0.75rem; color: var(--wb-ink-soft); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.fix { display: flex; align-items: center; justify-content: space-between; gap: 1rem; flex-wrap: wrap; }
.fix h2 { margin-bottom: 0.25rem; }
</style>

<template>
  <div class="schedule-page">
    <UCard>
      <template #header>
        <div class="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h1 class="text-lg font-semibold">Schedule</h1>
            <p class="text-xs text-gray-500 mt-1">
              Automatic <code>aidev run</code> for
              <code>{{ data?.currentCwd || '—' }}</code>
              <span v-if="data" class="ml-2 text-gray-400">
                via {{ backendLabel }}
              </span>
            </p>
          </div>
          <div class="flex items-center gap-2">
            <UButton
              color="neutral"
              variant="ghost"
              size="sm"
              :loading="loading"
              :disabled="loading"
              @click="reload"
            >
              Refresh
            </UButton>
            <UButton
              v-if="data?.fixSupported"
              color="neutral"
              variant="soft"
              size="sm"
              :loading="fixing"
              :disabled="fixing || !data?.entries.length"
              @click="runFix"
            >
              Fix paths
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
        v-if="actionMessage"
        :color="actionOk ? 'green' : 'red'"
        variant="soft"
        :title="actionOk ? 'Done' : 'Failed'"
        :description="actionMessage"
        class="mb-4"
      />

      <UCard class="mb-4" :ui="{ body: 'p-4' }">
        <template #header>
          <h2 class="text-base font-semibold">Schedule this project</h2>
        </template>

        <p class="text-sm text-gray-600 mb-4">
          Sets or replaces the schedule for the connected working directory. Only preset
          intervals are supported (same as <code>aidev schedule set</code>).
        </p>

        <div class="grid gap-4 md:grid-cols-2">
          <UFormField label="Interval">
            <USelect v-model="selectedCron" :items="presetOptions" />
          </UFormField>
          <UFormField
            label="Custom env file"
            help="Optional — passed as -e to the scheduled run (same as CLI)."
          >
            <UInput v-model="envFile" placeholder="/path/to/.env.aidev" autocomplete="off" />
          </UFormField>
        </div>

        <div class="mt-4 flex items-center gap-2">
          <UButton
            color="primary"
            size="sm"
            :loading="saving"
            :disabled="saving || !selectedCron"
            @click="saveSchedule"
          >
            {{ currentEntry ? 'Update schedule' : 'Enable schedule' }}
          </UButton>
          <UButton
            v-if="currentEntry"
            color="red"
            variant="soft"
            size="sm"
            :loading="removingCurrent"
            :disabled="removingCurrent"
            @click="removeCurrent"
          >
            Remove for this project
          </UButton>
        </div>
      </UCard>

      <UCard>
        <template #header>
          <h2 class="text-base font-semibold">All schedules</h2>
        </template>

        <p v-if="data && !data.entries.length" class="text-sm text-gray-600">
          No aidev schedules are configured on this machine.
        </p>

        <div v-else-if="data" class="overflow-x-auto">
          <table class="schedule-table w-full text-sm text-gray-900 dark:text-gray-100">
            <thead>
              <tr>
                <th>ID</th>
                <th>Directory</th>
                <th>Schedule</th>
                <th>Cron</th>
                <th>Args</th>
                <th />
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="row in data.entries"
                :key="row.id"
                :class="
                  row.current
                    ? 'bg-green-50 dark:bg-green-950/50'
                    : undefined
                "
              >
                <td>{{ row.id }}</td>
                <td>
                  <code class="cwd-cell text-gray-800 dark:text-gray-200">{{ row.cwd }}</code>
                  <UBadge v-if="row.current" color="green" variant="soft" size="xs" class="ml-2">
                    this project
                  </UBadge>
                </td>
                <td>{{ row.label }}</td>
                <td>
                  <code class="text-gray-800 dark:text-gray-200">{{ row.cron || '—' }}</code>
                </td>
                <td>
                  <code
                    v-if="row.extraArgs.length"
                    class="text-gray-800 dark:text-gray-200"
                  >{{ row.extraArgs.join(' ') }}</code>
                  <span v-else class="text-gray-500 dark:text-gray-400">—</span>
                </td>
                <td class="text-right">
                  <UButton
                    color="red"
                    variant="ghost"
                    size="xs"
                    :loading="removingId === row.id"
                    :disabled="removingId !== null"
                    @click="removeRow(row.id)"
                  >
                    Remove
                  </UButton>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </UCard>

      <UAlert
        v-if="data && !data.fixSupported"
        color="amber"
        variant="soft"
        title="Fix paths unavailable on Windows"
        description="Re-run schedule set for each project if binaries or paths changed."
        class="mt-4"
      />

      <UAlert
        v-if="data?.backend === 'launchd'"
        color="blue"
        variant="soft"
        title="macOS uses LaunchAgents"
        class="mt-4"
      >
        <template #description>
          Schedules run in your GUI session so AI tools can access the login Keychain.
          Cron is not used on macOS.
        </template>
      </UAlert>
    </UCard>
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
const loadError = ref('');
const actionMessage = ref('');
const actionOk = ref(false);

const selectedCron = ref('');
const envFile = ref('');

const presetOptions = computed(() =>
  (data.value?.presets ?? []).map((p) => ({
    label: `${p.label} (${p.cron})`,
    value: p.cron,
  })),
);

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

async function removeCurrent() {
  const entry = currentEntry.value;
  if (!entry) return;
  removingCurrent.value = true;
  try {
    await removeRow(entry.id);
  } finally {
    removingCurrent.value = false;
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
</script>

<style scoped>
.schedule-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.875rem;
}
.schedule-table th,
.schedule-table td {
  padding: 0.5rem 0.75rem;
  text-align: left;
  border-bottom: 1px solid #e5e7eb;
  vertical-align: top;
}
.schedule-table th {
  font-size: 0.7rem;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: #6b7280;
}
:global(.dark) .schedule-table th {
  color: #9ca3af;
}
.cwd-cell {
  font-size: 0.8rem;
  word-break: break-all;
}
</style>

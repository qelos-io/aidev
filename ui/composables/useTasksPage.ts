import { useApi } from '~/composables/useApi';
import { useTaskExecute } from '~/composables/useTaskExecute';
import type { TaskDetailResponse, TasksResponse, UiTask } from '~/types/tasks';
import {
  buildBoardColumns,
  buildStatusOptions,
  DEFAULT_TASK_FILTERS,
} from '~/utils/taskBoardColumns';

export function useTasksPage() {
  const api = useApi();
  const runtime = useRuntimeConfig();
  const cwd = computed(() => runtime.public.aidevCwd as string);

  const data = ref<TasksResponse | null>(null);
  const providerStatuses = ref<string[]>([]);
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

  const {
    execLines,
    execRunning,
    execText,
    resetExecute,
    startExecute,
    stopExecute,
    clearExecLines,
  } = useTaskExecute((msg) => {
    detailError.value = msg;
  });

  let pollTimer: ReturnType<typeof setInterval> | null = null;

  const columns = computed(() =>
    buildBoardColumns(
      data.value?.tasks ?? [],
      data.value?.filters ?? DEFAULT_TASK_FILTERS,
      Boolean(data.value),
    ),
  );

  const statusOptions = computed(() => {
    if (!data.value) return [];
    return buildStatusOptions(data.value.filters, providerStatuses.value);
  });

  const runningTaskId = computed(() => {
    if (execRunning.value && detail.value) return detail.value.task.id;
    return data.value?.activeTaskId ?? null;
  });

  function syncPollTimer() {
    const shouldPoll = execRunning.value || Boolean(data.value?.activeTaskId);
    if (shouldPoll && !pollTimer) {
      pollTimer = setInterval(() => {
        void reload();
      }, 5000);
    } else if (!shouldPoll && pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
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
      syncPollTimer();
    }
  }

  async function loadProviderStatuses() {
    if (providerStatuses.value.length > 0) return;
    try {
      const res = await api<{ statuses: string[] }>('/api/tasks/statuses');
      providerStatuses.value = res.statuses;
    } catch {
      // Fall back to configured bucket statuses.
    }
  }

  async function openTask(task: UiTask) {
    activeId.value = task.id;
    drawerOpen.value = true;
    detail.value = { task: { ...task, description: '' }, comments: [] };
    detailError.value = '';
    statusDraft.value = task.status;
    commentDraft.value = '';
    commentAsAidev.value = false;
    resetExecute();
    void loadProviderStatuses();
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
      detail.value = await api<TaskDetailResponse>(
        `/api/tasks/${encodeURIComponent(detail.value.task.id)}`,
      );
      commentDraft.value = '';
    } catch (err) {
      detailError.value = err instanceof Error ? err.message : String(err);
    } finally {
      commentSaving.value = false;
    }
  }

  function runExecute() {
    if (!detail.value) return;
    void startExecute(detail.value.task.id);
  }

  watch(drawerOpen, (open) => {
    if (!open) {
      activeId.value = null;
      resetExecute();
    }
  });

  watch([execRunning, () => data.value?.activeTaskId], syncPollTimer);

  onMounted(async () => {
    await reload();
    syncPollTimer();
  });

  onBeforeUnmount(() => {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  });

  return {
    data,
    loading,
    loadError,
    columns,
    runningTaskId,
    reload,
    drawerOpen,
    activeId,
    detail,
    detailError,
    openTask,
    closeDrawer,
    statusDraft,
    statusSaving,
    statusOptions,
    changeStatus,
    commentDraft,
    commentAsAidev,
    commentSaving,
    postComment,
    cwd,
    execLines,
    execRunning,
    execText,
    runExecute,
    stopExecute,
    clearExecLines,
  };
}

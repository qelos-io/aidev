import { useApi } from '~/composables/useApi';
import { useInitialLoading } from '~/composables/useInitialLoading';
import { useTaskExecute } from '~/composables/useTaskExecute';
import type { SuggestedTag, TaskDetailResponse, TasksResponse, UiTask } from '~/types/tasks';
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
  const loadError = ref('');
  const { loading, beginFetch, endFetch } = useInitialLoading(data);
  const refreshing = ref(false);

  const drawerOpen = ref(false);
  const activeId = ref<string | null>(null);
  const detail = ref<TaskDetailResponse | null>(null);
  const detailError = ref('');

  const statusDraft = ref('');
  const statusSaving = ref(false);

  const commentDraft = ref('');
  const commentAsAidev = ref(false);
  const commentSaving = ref(false);

  const tagSaving = ref(false);

  const createModalOpen = ref(false);
  const createSaving = ref(false);
  const createError = ref('');

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
  let refreshTimer: ReturnType<typeof setInterval> | null = null;

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
        void fetchTasks();
      }, 5000);
    } else if (!shouldPoll && pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  async function fetchTasks() {
    const isInitial = beginFetch(loadError);
    try {
      data.value = await api<TasksResponse>('/api/tasks');
      if (!isInitial) loadError.value = '';
    } catch (err) {
      loadError.value = err instanceof Error ? err.message : String(err);
    } finally {
      endFetch(isInitial);
      syncPollTimer();
    }
  }

  async function reload() {
    refreshing.value = true;
    try {
      await fetchTasks();
    } finally {
      refreshing.value = false;
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

  const suggestedTags = computed<SuggestedTag[]>(() => data.value?.suggestedTags ?? []);

  async function saveTags(addTags: string[], removeTags: string[]) {
    if (!detail.value) return;
    if (addTags.length === 0 && removeTags.length === 0) return;
    tagSaving.value = true;
    detailError.value = '';
    try {
      await api(`/api/tasks/${encodeURIComponent(detail.value.task.id)}`, {
        method: 'PATCH',
        body: { addTags, removeTags },
      });
      const t = detail.value.task;
      const next = new Set(t.tags);
      for (const tag of removeTags) next.delete(tag);
      for (const tag of addTags) next.add(tag);
      t.tags = [...next];
      const board = data.value?.tasks.find((b) => b.id === t.id);
      if (board) board.tags = t.tags;
    } catch (err) {
      detailError.value = err instanceof Error ? err.message : String(err);
    } finally {
      tagSaving.value = false;
    }
  }

  function openCreateModal() {
    createModalOpen.value = true;
    createError.value = '';
  }

  function closeCreateModal() {
    createModalOpen.value = false;
    createError.value = '';
  }

  async function createTask(params: {
    title: string;
    description: string;
    tags: string[];
    priority?: number;
  }) {
    createSaving.value = true;
    createError.value = '';
    try {
      await api('/api/tasks', { method: 'POST', body: params });
      createModalOpen.value = false;
      await fetchTasks();
    } catch (err) {
      createError.value = err instanceof Error ? err.message : String(err);
    } finally {
      createSaving.value = false;
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
    await fetchTasks();
    syncPollTimer();
    refreshTimer = setInterval(() => { void fetchTasks(); }, 30_000);
  });

  onBeforeUnmount(() => {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
    if (refreshTimer) {
      clearInterval(refreshTimer);
      refreshTimer = null;
    }
  });

  return {
    data,
    loading,
    refreshing,
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
    suggestedTags,
    tagSaving,
    saveTags,
    createModalOpen,
    createSaving,
    createError,
    openCreateModal,
    closeCreateModal,
    createTask,
  };
}

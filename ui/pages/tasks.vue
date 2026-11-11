<template>
  <div class="tasks">
    <header class="page-head">
      <div>
        <h1>Tasks</h1>
        <p v-if="data">
          {{ data.tasks.length }} {{ data.tasks.length === 1 ? 'task' : 'tasks' }} from
          <span class="from"><IconTile :image="providerMeta(data.provider).image" :icon="providerMeta(data.provider).icon" :color="providerMeta(data.provider).color" size="sm" /><strong>{{ providerMeta(data.provider).name }}</strong></span>.
          Click one to read it, change its status or run aidev on it.
        </p>
        <p v-else>Loading your tasks…</p>
      </div>
      <div class="head-actions">
        <UButton color="neutral" variant="ghost" icon="i-lucide-refresh-cw" :loading="refreshing" :disabled="refreshing" @click="reload">Refresh</UButton>
        <UButton icon="i-lucide-plus" :disabled="!data" @click="openCreateModal">New task</UButton>
      </div>
    </header>

    <UAlert v-if="loadError" color="error" variant="soft" icon="i-lucide-triangle-alert" title="Couldn't load your tasks" :description="loadError" class="mb-5" />

    <div v-if="data && data.tasks.length > 0" class="toolbar">
      <UInput v-model="search" icon="i-lucide-search" placeholder="Search tasks by name, ID or tag…" aria-label="Search tasks" class="search" :ui="{ trailing: 'pe-1' }">
        <template v-if="search" #trailing>
          <UButton color="neutral" variant="link" size="sm" icon="i-lucide-x" aria-label="Clear search" @click="search = ''" />
        </template>
      </UInput>
      <p v-if="search" class="found" aria-live="polite">{{ matchCount }} {{ matchCount === 1 ? 'match' : 'matches' }}</p>
    </div>

    <section v-if="data && data.tasks.length === 0 && !loading" class="empty">
      <UIcon name="i-lucide-clipboard-list" class="size-8" aria-hidden="true" />
      <strong>No tasks found</strong>
      <span>Check your task tool's connection and tag under <NuxtLink to="/config#connection">Settings → Task tool</NuxtLink>, or create your first task.</span>
      <UButton icon="i-lucide-plus" class="mt-2" @click="openCreateModal">New task</UButton>
    </section>

    <TasksBoard
      v-if="!loadError"
      :columns="filteredColumns"
      :loading="loading"
      :loaded="Boolean(data)"
      :active-id="activeId"
      :running-task-id="runningTaskId"
      @select="openTask"
    />

    <TasksTaskCreateModal
      :open="createModalOpen"
      :saving="createSaving"
      :error="createError"
      :suggested-tags="suggestedTags"
      @update:open="createModalOpen = $event"
      @close="closeCreateModal"
      @submit="createTask"
    />

    <TasksTaskDetailModal
      :open="drawerOpen"
      :detail="detail"
      :provider-name="data?.provider || 'provider'"
      :error="detailError"
      :status-draft="statusDraft"
      :status-saving="statusSaving"
      :status-options="statusOptions"
      :comment-draft="commentDraft"
      :comment-as-aidev="commentAsAidev"
      :comment-saving="commentSaving"
      :cwd="cwd"
      :exec-running="execRunning"
      :exec-lines="execLines"
      :exec-text="execText"
      :suggested-tags="suggestedTags"
      :tag-saving="tagSaving"
      @update:open="drawerOpen = $event"
      @close="closeDrawer"
      @update:status-draft="statusDraft = $event"
      @change-status="changeStatus"
      @update:comment-draft="commentDraft = $event"
      @update:comment-as-aidev="commentAsAidev = $event"
      @post-comment="postComment"
      @run="runExecute"
      @stop="stopExecute"
      @clear-exec="clearExecLines"
      @save-tags="saveTags"
    />
  </div>
</template>

<script setup lang="ts">
import { useTasksPage } from '~/composables/useTasksPage';

const {
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
} = useTasksPage();

const search = ref('');
const filteredColumns = computed(() => {
  const q = search.value.trim().toLowerCase();
  if (!q) return columns.value;
  return columns.value.map((c) => ({
    ...c,
    tasks: c.tasks.filter((t) => `${t.id} ${t.name} ${t.tags.join(' ')}`.toLowerCase().includes(q)),
  }));
});
const matchCount = computed(() => filteredColumns.value.reduce((n, c) => n + c.tasks.length, 0));
</script>

<style scoped>
.tasks { padding-bottom: 2rem; }
.page-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 1rem; flex-wrap: wrap; padding: 0.75rem 0 1.25rem; }
.page-head h1 { margin: 0; font-size: 1.875rem; font-weight: 700; letter-spacing: -0.02em; color: var(--ui-text-highlighted); }
.page-head p { margin: 0.25rem 0 0; color: var(--wb-ink-soft); max-width: 44rem; }
.from { display: inline-flex; align-items: center; gap: 0.375rem; vertical-align: middle; margin: 0 0.125rem; }
.from strong { color: var(--ui-text-highlighted); }
.head-actions { display: flex; gap: 0.5rem; }
.toolbar { display: flex; align-items: center; gap: 0.875rem; margin-bottom: 1rem; }
.search { width: 100%; max-width: 24rem; }
.found { margin: 0; font-size: 0.875rem; color: var(--wb-ink-soft); }
.empty { display: flex; flex-direction: column; align-items: center; gap: 0.25rem; padding: 3rem 1rem; margin-bottom: 1rem; text-align: center; border: 1px dashed var(--ui-border-accented); border-radius: 1rem; color: var(--wb-ink-soft); background: var(--ui-bg); }
.empty strong { color: var(--ui-text-highlighted); font-size: 1.0625rem; }
.empty a { color: var(--ui-primary); font-weight: 600; text-underline-offset: 2px; }
</style>

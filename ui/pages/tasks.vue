<template>
  <div class="tasks-page">
    <UCard>
      <template #header>
        <div class="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h1 class="text-lg font-semibold">Tasks</h1>
            <p class="text-xs text-gray-500 mt-1">
              <span v-if="data">
                Provider: <code>{{ data.provider }}</code> · {{ data.tasks.length }} task(s)
              </span>
              <span v-else>—</span>
            </p>
          </div>
          <div class="flex items-center gap-2">
            <UButton
              color="primary"
              size="sm"
              :disabled="!data"
              @click="openCreateModal"
            >
              New Task
            </UButton>
            <UButton
              color="neutral"
              variant="ghost"
              size="sm"
              :loading="refreshing"
              :disabled="refreshing"
              @click="reload"
            >
              Refresh
            </UButton>
          </div>
        </div>
      </template>

      <UAlert
        v-if="loadError"
        color="red"
        variant="soft"
        :title="loadError"
        class="mb-3"
      />

      <p
        v-if="data && data.tasks.length === 0 && !loading"
        class="empty-banner"
      >
        No tasks — check
        <NuxtLink to="/config" class="link">Config</NuxtLink>
        for provider keys, list ids, and tag filter.
      </p>

      <TasksBoard
        v-if="!loadError"
        :columns="columns"
        :loading="loading"
        :loaded="Boolean(data)"
        :active-id="activeId"
        :running-task-id="runningTaskId"
        @select="openTask"
      />
    </UCard>

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
</script>

<style scoped>
.tasks-page {
  display: flex;
  flex-direction: column;
}
.empty-banner {
  font-size: 0.85rem;
  color: #64748b;
  margin-bottom: 0.75rem;
}
.link { color: #2563eb; text-decoration: underline; }
.link:hover { color: #1d4ed8; }
</style>

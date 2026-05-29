<template>
  <UModal :model-value="open" :ui="{ width: 'sm:max-w-4xl' }" @update:model-value="emit('update:open', $event)">
    <UCard v-if="detail" class="task-drawer-card">
      <template #header>
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0">
            <p class="text-xs text-gray-500"><code>{{ detail.task.id }}</code></p>
            <h2 class="text-base font-semibold truncate" :title="detail.task.name">
              {{ detail.task.name }}
            </h2>
            <p class="text-xs text-gray-500 mt-0.5">
              <a
                v-if="detail.task.url"
                :href="detail.task.url"
                target="_blank"
                rel="noopener"
                class="link"
              >
                Open in {{ providerName }} ↗
              </a>
            </p>
          </div>
          <UButton size="xs" color="gray" variant="ghost" @click="emit('close')">Close</UButton>
        </div>
      </template>

      <UAlert
        v-if="error"
        color="red"
        variant="soft"
        :title="error"
        class="mb-3"
      />

      <section class="drawer-section">
        <h3 class="section-title">Description</h3>
        <div v-if="detail.task.description" class="desc">
          <MarkdownContent :content="detail.task.description" />
        </div>
        <p v-else class="muted">No description.</p>
      </section>

      <section class="drawer-section">
        <h3 class="section-title">Status</h3>
        <div class="status-row">
          <USelect
            v-if="statusOptions.length > 0"
            :model-value="statusDraft"
            :options="statusOptions"
            size="sm"
            @update:model-value="emit('update:statusDraft', $event)"
          />
          <UInput
            v-else
            :model-value="statusDraft"
            placeholder="status name"
            size="sm"
            @update:model-value="emit('update:statusDraft', $event)"
          />
          <UButton
            size="sm"
            color="primary"
            :loading="statusSaving"
            :disabled="statusSaving || !statusDraft || statusDraft === detail.task.status"
            @click="emit('changeStatus')"
          >
            Update status
          </UButton>
        </div>
      </section>

      <section class="drawer-section">
        <h3 class="section-title">Comments ({{ detail.comments.length }})</h3>
        <div v-if="detail.comments.length > 0" class="comments">
          <article v-for="c in detail.comments" :key="c.id" class="comment">
            <header class="comment-head">
              <span class="comment-author">{{ c.author || 'unknown' }}</span>
              <span class="comment-date">{{ formatTaskDate(c.date) }}</span>
            </header>
            <div class="comment-body">
              <MarkdownContent :content="c.text" />
            </div>
          </article>
        </div>
        <p v-else class="muted">No comments yet.</p>

        <div class="comment-form">
          <UTextarea
            :model-value="commentDraft"
            placeholder="Write a comment…"
            :rows="3"
            @update:model-value="emit('update:commentDraft', $event)"
          />
          <div class="comment-actions">
            <UCheckbox
              :model-value="commentAsAidev"
              label="Send as [aidev] comment"
              @update:model-value="emit('update:commentAsAidev', $event)"
            />
            <UButton
              size="sm"
              color="primary"
              :loading="commentSaving"
              :disabled="commentSaving || !commentDraft.trim()"
              @click="emit('postComment')"
            >
              Add comment
            </UButton>
          </div>
        </div>
      </section>

      <TasksTaskDetailExecute
        :task-id="detail.task.id"
        :cwd="cwd"
        :running="execRunning"
        :lines="execLines"
        :text="execText"
        @run="emit('run')"
        @stop="emit('stop')"
        @clear="emit('clearExec')"
      />
    </UCard>
  </UModal>
</template>

<script setup lang="ts">
import type { TaskDetailResponse } from '~/types/tasks';
import { formatTaskDate } from '~/utils/taskBoardColumns';

defineProps<{
  open: boolean;
  detail: TaskDetailResponse | null;
  providerName: string;
  error: string;
  statusDraft: string;
  statusSaving: boolean;
  statusOptions: { label: string; value: string }[];
  commentDraft: string;
  commentAsAidev: boolean;
  commentSaving: boolean;
  cwd: string;
  execRunning: boolean;
  execLines: string[];
  execText: string;
}>();

const emit = defineEmits<{
  'update:open': [value: boolean];
  close: [];
  'update:statusDraft': [value: string];
  changeStatus: [];
  'update:commentDraft': [value: string];
  'update:commentAsAidev': [value: boolean];
  postComment: [];
  run: [];
  stop: [];
  clearExec: [];
}>();
</script>

<style scoped>
.drawer-section { margin-top: 1rem; }
.drawer-section:first-child { margin-top: 0; }
.section-title {
  font-size: 0.8rem;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: #475569;
  margin-bottom: 0.4rem;
}
.desc {
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 0.375rem;
  padding: 0.6rem 0.75rem;
  max-height: 16rem;
  overflow: auto;
}
.muted { font-size: 0.85rem; color: #64748b; }
.status-row {
  display: flex;
  gap: 0.5rem;
  align-items: center;
}
.comments {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  max-height: 16rem;
  overflow: auto;
  padding-right: 0.25rem;
}
.comment {
  border: 1px solid #e2e8f0;
  border-radius: 0.375rem;
  padding: 0.5rem 0.65rem;
  background: #f8fafc;
}
.comment-head {
  display: flex;
  justify-content: space-between;
  font-size: 0.7rem;
  color: #64748b;
  margin-bottom: 0.25rem;
}
.comment-author { font-weight: 600; color: #334155; }
.comment-body { margin: 0; }
.comment-form {
  margin-top: 0.75rem;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}
.comment-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
}
.link { color: #2563eb; text-decoration: underline; }
.link:hover { color: #1d4ed8; }
</style>

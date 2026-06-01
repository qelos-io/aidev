<template>
  <UModal :model-value="open" :ui="{ width: 'sm:max-w-6xl' }" @update:model-value="emit('update:open', $event)">
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

      <div class="modal-body">
        <!-- Left column: description, status, tags, execute -->
        <div class="left-col">
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
            <div class="tags-header">
              <h3 class="section-title">Tags</h3>
              <span v-if="detail.task.tags.length > 0" class="tags-count">
                {{ detail.task.tags.length }} applied
              </span>
            </div>

            <div class="tags-panel" :class="{ 'tags-panel--saving': tagSaving }">
              <TasksTagsBar
                :model-value="detail.task.tags"
                :suggested-tags="suggestedTags"
                :other-tags="otherTags"
                :saving="tagSaving"
                @update:model-value="onTagsChanged"
                @remove-other="(tag) => emit('saveTags', [], [tag])"
              />
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
        </div>

        <!-- Right column: comments with independent scroll -->
        <div class="right-col">
          <h3 class="section-title">Comments ({{ detail.comments.length }})</h3>

          <div class="comments-list">
            <template v-if="detail.comments.length > 0">
              <article v-for="c in detail.comments" :key="c.id" class="comment">
                <header class="comment-head">
                  <span class="comment-author">{{ c.author || 'unknown' }}</span>
                  <span class="comment-date">{{ formatTaskDate(c.date) }}</span>
                </header>
                <div class="comment-body">
                  <MarkdownContent :content="c.text" />
                </div>
              </article>
            </template>
            <p v-else class="muted">No comments yet.</p>
          </div>

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
        </div>
      </div>
    </UCard>
  </UModal>
</template>

<script setup lang="ts">
import type { SuggestedTag, TaskDetailResponse } from '~/types/tasks';
import { formatTaskDate } from '~/utils/taskBoardColumns';

const props = defineProps<{
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
  suggestedTags: SuggestedTag[];
  tagSaving: boolean;
}>();

const otherTags = computed(() => {
  if (!props.detail) return [];
  const suggested = new Set(props.suggestedTags.map((s) => s.tag));
  return props.detail.task.tags.filter((tag) => !suggested.has(tag));
});

function onTagsChanged(next: string[]) {
  if (!props.detail) return;
  const prev = props.detail.task.tags;
  const prevSet = new Set(prev);
  const nextSet = new Set(next);
  const add = next.filter((t) => !prevSet.has(t));
  const remove = prev.filter((t) => !nextSet.has(t));
  if (add.length || remove.length) emit('saveTags', add, remove);
}

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
  saveTags: [addTags: string[], removeTags: string[]];
}>();
</script>

<style scoped>
.modal-body {
  display: grid;
  grid-template-columns: 1fr;
  gap: 1.25rem;
}

@media (min-width: 768px) {
  .modal-body {
    grid-template-columns: 1fr 1fr;
    align-items: start;
    min-height: 420px;
  }
}

/* Left column */
.left-col {
  display: flex;
  flex-direction: column;
  gap: 0;
}

.drawer-section { margin-top: 1rem; }
.drawer-section:first-child { margin-top: 0; }

/* Right column: fixed height, flex column so comments scroll and form sticks */
.right-col {
  display: flex;
  flex-direction: column;
  max-height: 65vh;
  border-left: 1px solid #e2e8f0;
  padding-left: 1.25rem;
}

@media (max-width: 767px) {
  .right-col {
    border-left: none;
    padding-left: 0;
    border-top: 1px solid #e2e8f0;
    padding-top: 1rem;
    max-height: none;
  }
}

.comments-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding-right: 0.25rem;
  margin-top: 0.4rem;
  margin-bottom: 0.75rem;
}

.comment-form {
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding-top: 0.5rem;
  border-top: 1px solid #e2e8f0;
}

/* Shared */
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
.comment {
  border: 1px solid #e2e8f0;
  border-radius: 0.375rem;
  padding: 0.5rem 0.65rem;
  background: #f8fafc;
  flex-shrink: 0;
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
.comment-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
}
.tags-header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.5rem;
  margin-bottom: 0.3rem;
}
.tags-header .section-title { margin-bottom: 0; }
.tags-count {
  font-size: 0.7rem;
  color: #94a3b8;
  flex-shrink: 0;
}
.tags-panel {
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 0.375rem;
  padding: 0.4rem 0.5rem;
}
.tags-panel--saving {
  opacity: 0.65;
  pointer-events: none;
}
.link { color: #2563eb; text-decoration: underline; }
.link:hover { color: #1d4ed8; }
</style>

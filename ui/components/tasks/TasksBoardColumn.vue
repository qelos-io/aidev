<template>
  <section class="column" :aria-labelledby="`col-${column.key}`">
    <header class="col-head">
      <span class="dot" :class="`dot--${column.key}`" aria-hidden="true" />
      <div class="col-titles">
        <h2 :id="`col-${column.key}`" class="col-title">{{ column.title }}</h2>
        <p v-if="HINTS[column.key]" class="col-hint">{{ HINTS[column.key] }}</p>
      </div>
      <span class="col-count tabular" :aria-label="`${column.tasks.length} tasks`">{{ column.tasks.length }}</span>
    </header>
    <div class="col-body">
      <template v-if="loading && !loaded">
        <USkeleton v-for="n in 2" :key="n" class="h-20 w-full rounded-xl" />
      </template>
      <template v-else>
        <TasksTaskCard
          v-for="task in column.tasks"
          :key="task.id"
          :task="task"
          :active="activeId === task.id"
          :running="runningTaskId === task.id"
          @select="emit('select', task)"
        />
        <p v-if="column.tasks.length === 0" class="col-empty">Nothing here</p>
      </template>
    </div>
  </section>
</template>

<script setup lang="ts">
import type { BoardColumn, UiTask } from '~/types/tasks';

defineProps<{
  column: BoardColumn;
  loading: boolean;
  loaded: boolean;
  activeId: string | null;
  runningTaskId: string | null;
}>();

const emit = defineEmits<{
  select: [task: UiTask];
}>();

const HINTS: Record<string, string> = {
  open: 'Ready for aidev',
  pending: 'Waiting on you',
  inprogress: 'Being worked on',
  review: 'Ready to review',
  done: 'Finished',
};
</script>

<style scoped>
.column {
  flex: 0 0 17rem;
  width: 17rem;
  display: flex;
  flex-direction: column;
  min-height: 14rem;
  padding: 0.75rem;
  border-radius: 1rem;
  background: var(--ui-bg-elevated);
  scroll-snap-align: start;
}
.col-head { display: flex; align-items: center; gap: 0.625rem; padding: 0.25rem 0.375rem 0.75rem; }
.col-titles { flex: 1; min-width: 0; }
.col-title { margin: 0; font-size: 0.9375rem; font-weight: 700; color: var(--ui-text-highlighted); }
.col-hint { margin: 0; font-size: 0.75rem; color: var(--wb-ink-soft); }
.dot { width: 0.625rem; height: 0.625rem; border-radius: 50%; background: var(--wb-ink-soft); flex-shrink: 0; }
.dot--open { background: var(--ui-primary); }
.dot--pending { background: var(--wb-wait); }
.dot--inprogress { background: oklch(65% 0.14 235); }
.dot--review { background: oklch(64% 0.14 290); }
.dot--done { background: var(--wb-ok); }
.col-count { font-size: 0.8125rem; font-weight: 600; min-width: 1.75rem; text-align: center; padding: 0.125rem 0.5rem; border-radius: 999px; background: var(--ui-bg); color: var(--wb-ink-soft); }
.col-body { display: flex; flex-direction: column; gap: 0.5rem; }
.col-empty { margin: 0; padding: 1.25rem 0; text-align: center; font-size: 0.8125rem; color: var(--wb-ink-soft); }
</style>

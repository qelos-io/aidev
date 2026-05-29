<template>
  <div class="column">
    <header class="col-head">
      <span class="col-title" :class="`col-title--${column.key}`">{{ column.title }}</span>
      <span class="col-count">{{ column.tasks.length }}</span>
    </header>
    <div class="col-body">
      <p v-if="loading && !loaded" class="col-empty">Loading…</p>
      <template v-else>
        <TasksTaskCard
          v-for="task in column.tasks"
          :key="task.id"
          :task="task"
          :active="activeId === task.id"
          :running="runningTaskId === task.id"
          @select="emit('select', task)"
        />
        <p v-if="column.tasks.length === 0" class="col-empty">empty</p>
      </template>
    </div>
  </div>
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
</script>

<style scoped>
.column {
  flex: 0 0 220px;
  width: 220px;
  background: #f1f5f9;
  border-radius: 0.5rem;
  padding: 0.5rem;
  display: flex;
  flex-direction: column;
  min-height: 14rem;
}
.col-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.35rem;
  padding: 0.25rem 0.5rem 0.5rem;
  white-space: nowrap;
}
.col-title {
  font-weight: 600;
  font-size: 0.85rem;
  color: #334155;
  flex-shrink: 0;
}
.col-title--pending { color: #ca8a04; }
.col-title--inprogress { color: #2563eb; }
.col-title--review { color: #7c3aed; }
.col-title--done { color: #16a34a; }
.col-count {
  font-size: 0.7rem;
  background: #e2e8f0;
  color: #475569;
  border-radius: 9999px;
  padding: 0.1rem 0.5rem;
}
.col-body { display: flex; flex-direction: column; gap: 0.4rem; }
.col-empty {
  font-size: 0.75rem;
  color: #94a3b8;
  text-align: center;
  padding: 1rem 0;
}
</style>

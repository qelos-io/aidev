<template>
  <div class="board-scroll">
    <div class="board">
      <TasksBoardColumn
        v-for="col in columns"
        :key="col.key"
        :column="col"
        :loading="loading"
        :loaded="loaded"
        :active-id="activeId"
        :running-task-id="runningTaskId"
        @select="emit('select', $event)"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import type { BoardColumn, UiTask } from '~/types/tasks';

defineProps<{
  columns: BoardColumn[];
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
.board-scroll {
  overflow-x: auto;
  overflow-y: visible;
  -webkit-overflow-scrolling: touch;
  padding-bottom: 0.5rem;
  scroll-snap-type: x proximity;
}
.board {
  display: flex;
  flex-wrap: nowrap;
  gap: 1rem;
  width: max-content;
  min-width: 100%;
}
</style>

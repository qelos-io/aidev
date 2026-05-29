<template>
  <article
    class="card"
    :class="{
      'card--active': active,
      'card--running': running,
    }"
    @click="emit('select')"
  >
    <div class="card-id">{{ task.id }}</div>
    <div class="card-title">{{ task.name }}</div>
    <div class="card-meta">
      <span
        v-if="running"
        class="badge badge--run"
        title="Being implemented by aidev in this working tree"
      >
        running here
      </span>
      <span class="badge" :title="`status: ${task.status}`">{{ task.status }}</span>
      <span v-if="task.priority" class="badge badge--p">P{{ task.priority }}</span>
      <span v-for="tag in task.tags.slice(0, 3)" :key="tag" class="badge badge--tag">{{ tag }}</span>
    </div>
  </article>
</template>

<script setup lang="ts">
import type { UiTask } from '~/types/tasks';

defineProps<{
  task: UiTask;
  active: boolean;
  running: boolean;
}>();

const emit = defineEmits<{
  select: [];
}>();
</script>

<style scoped>
.card {
  background: #fff;
  border: 1px solid #e2e8f0;
  border-radius: 0.375rem;
  padding: 0.55rem 0.65rem;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  transition: box-shadow 0.12s ease, border-color 0.12s ease;
}
.card:hover { border-color: #94a3b8; box-shadow: 0 1px 3px rgba(15, 23, 42, 0.08); }
.card--active { border-color: #2563eb; box-shadow: 0 0 0 2px rgba(37, 99, 235, 0.15); }
.card--running {
  border-color: #16a34a;
  box-shadow: 0 0 0 2px rgba(22, 163, 74, 0.18);
}
.card-id {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 0.7rem;
  color: #64748b;
}
.card-title {
  font-size: 0.85rem;
  font-weight: 500;
  color: #0f172a;
  line-height: 1.3;
  word-break: break-word;
}
.card-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem;
  margin-top: 0.1rem;
}
.badge {
  font-size: 0.65rem;
  background: #e2e8f0;
  color: #1e293b;
  border-radius: 0.25rem;
  padding: 0.05rem 0.35rem;
  font-weight: 500;
}
.badge--p { background: #fde68a; color: #78350f; }
.badge--tag { background: #dbeafe; color: #1e3a8a; }
.badge--run { background: #bbf7d0; color: #14532d; }
</style>

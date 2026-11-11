<template>
  <button
    type="button"
    class="card"
    :class="{ 'card--active': active, 'card--running': running }"
    :aria-label="`${task.name}, ${task.status}${running ? ', aidev is working on it' : ''}`"
    @click="emit('select')"
  >
    <span class="card-title">{{ task.name }}</span>
    <span v-if="running" class="running"><UIcon name="i-lucide-loader-circle" class="size-3.5 animate-spin" aria-hidden="true" /> aidev is working on this</span>
    <span class="card-meta">
      <span class="card-id">{{ task.id }}</span>
      <span v-if="task.priority" class="chip chip--p" :title="`Priority ${task.priority}`">P{{ task.priority }}</span>
      <span v-for="tag in task.tags.slice(0, 3)" :key="tag" class="chip">{{ tag }}</span>
      <span v-if="task.tags.length > 3" class="chip chip--more">+{{ task.tags.length - 3 }}</span>
    </span>
  </button>
</template>

<script setup lang="ts">
import type { UiTask } from '~/types/tasks';

defineProps<{ task: UiTask; active: boolean; running: boolean }>();
const emit = defineEmits<{ select: [] }>();
</script>

<style scoped>
.card {
  display: flex; flex-direction: column; gap: 0.5rem; width: 100%; padding: 0.75rem 0.875rem;
  text-align: left; cursor: pointer; font: inherit; color: inherit;
  background: var(--ui-bg); border: 1px solid var(--ui-border); border-radius: 0.75rem;
  transition: border-color 0.15s, box-shadow 0.15s;
}
.card:hover { border-color: var(--ui-border-accented); box-shadow: 0 2px 8px -4px rgb(0 0 0 / 0.2); }
.card:focus-visible { outline: 2px solid var(--ui-primary); outline-offset: 2px; }
.card--active { border-color: var(--ui-primary); box-shadow: 0 0 0 1px var(--ui-primary); }
.card--running { border-color: var(--wb-ok); }
.card-title { font-size: 0.9375rem; font-weight: 600; line-height: 1.35; color: var(--ui-text-highlighted); word-break: break-word; }
.running { display: inline-flex; align-items: center; gap: 0.375rem; font-size: 0.75rem; font-weight: 600; color: var(--wb-ok); }
.card-meta { display: flex; flex-wrap: wrap; align-items: center; gap: 0.375rem; }
.card-id { font-family: var(--font-mono); font-size: 0.6875rem; color: var(--wb-ink-soft); margin-right: 0.125rem; }
.chip { font-size: 0.6875rem; font-weight: 600; padding: 0.0625rem 0.5rem; border-radius: 999px; background: var(--ui-bg-elevated); color: var(--wb-ink-soft); }
.chip--p { background: color-mix(in oklch, var(--wb-wait) 25%, transparent); color: var(--ui-text-highlighted); }
.chip--more { background: transparent; }
</style>

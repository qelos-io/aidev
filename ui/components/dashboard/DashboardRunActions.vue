<template>
  <UCard>
    <template #header>
      <h2 class="text-sm font-semibold uppercase tracking-wide text-gray-500">Run Actions</h2>
    </template>
    <div class="actions">
      <UButton
        v-for="s in statuses"
        :key="s.value"
        size="md"
        :color="s.color"
        class="action-btn"
        @click="emit('run', s.value)"
      >
        {{ s.label }}
      </UButton>
    </div>
  </UCard>
</template>

<script setup lang="ts">
const emit = defineEmits<{
  (e: 'run', status: string): void;
}>();

const statuses: { value: string; label: string; color: 'primary' | 'sky' | 'amber' | 'neutral' }[] = [
  { value: 'open', label: 'Open', color: 'primary' },
  { value: 'pending', label: 'Pending', color: 'sky' },
  { value: 'review', label: 'Review', color: 'amber' },
  { value: 'all', label: 'All', color: 'neutral' },
];
</script>

<style scoped>
.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}
.action-btn {
  min-width: 7rem;
  justify-content: center;
}
</style>

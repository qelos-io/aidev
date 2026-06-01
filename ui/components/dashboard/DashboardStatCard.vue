<template>
  <UCard class="stat-card">
    <div class="stat-accent" :style="color ? `background: ${color}` : undefined" />
    <div class="stat-body">
      <p class="stat-label">{{ label }}</p>
      <div v-if="loading" class="stat-skeleton" />
      <p v-else class="stat-value">{{ value ?? '—' }}</p>
    </div>
  </UCard>
</template>

<script setup lang="ts">
defineProps<{
  label: string;
  value: number | null;
  loading: boolean;
  color?: string;
}>();
</script>

<style scoped>
.stat-card {
  position: relative;
  overflow: hidden;
}
.stat-accent {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 3px;
  background: #94a3b8;
}
.stat-body {
  padding-top: 0.25rem;
}
.stat-label {
  font-size: 0.75rem;
  font-weight: 500;
  color: #64748b;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin-bottom: 0.4rem;
}
.stat-value {
  font-size: 2rem;
  font-weight: 700;
  line-height: 1;
  color: inherit;
}
.stat-skeleton {
  height: 2rem;
  width: 4rem;
  border-radius: 0.25rem;
  background: #e2e8f0;
  animation: shimmer 1.4s ease-in-out infinite;
}
@keyframes shimmer {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}
</style>

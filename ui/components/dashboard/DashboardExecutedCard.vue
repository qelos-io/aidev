<template>
  <UCard>
    <template #header>
      <div class="flex items-center justify-between gap-3 flex-wrap">
        <h2 class="text-sm font-semibold uppercase tracking-wide text-gray-500">Executed Tasks</h2>
        <div class="period-tabs">
          <button
            v-for="p in periods"
            :key="p.value"
            class="period-tab"
            :class="{ 'period-tab--active': modelPeriod === p.value }"
            @click="emit('update:period', p.value)"
          >
            {{ p.label }}
          </button>
        </div>
      </div>
    </template>

    <div class="executed-body">
      <div v-if="loading" class="executed-skeleton" />
      <template v-else>
        <span class="executed-value">{{ data?.current ?? '—' }}</span>
        <span
          v-if="data"
          class="badge"
          :class="badgeClass"
        >
          {{ badgeText }}
        </span>
      </template>
    </div>
    <p class="executed-sub">tasks updated in this period</p>
  </UCard>
</template>

<script setup lang="ts">
import type { ExecutedStats } from '~/server/api/dashboard/stats.get';

const props = defineProps<{
  data: ExecutedStats | null;
  period: string;
  loading: boolean;
}>();

const emit = defineEmits<{
  (e: 'update:period', value: string): void;
}>();

const modelPeriod = computed(() => props.period);

const periods = [
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
  { value: '3months', label: '3 Months' },
];

const badgeText = computed(() => {
  if (!props.data) return '';
  const { changeAmount, changePercent, previous } = props.data;
  if (previous === 0 && changePercent === null) return 'N/A vs prior';
  const sign = changeAmount >= 0 ? '+' : '';
  const pct = changePercent !== null ? ` ${sign}${changePercent}%` : '';
  return `${sign}${changeAmount}${pct} vs prior`;
});

const badgeClass = computed(() => {
  if (!props.data || props.data.changePercent === null) return 'badge--neutral';
  return props.data.changeAmount >= 0 ? 'badge--up' : 'badge--down';
});
</script>

<style scoped>
.period-tabs {
  display: flex;
  gap: 0.25rem;
  background: #f1f5f9;
  border-radius: 0.375rem;
  padding: 0.2rem;
}
.period-tab {
  font-size: 0.75rem;
  font-weight: 500;
  padding: 0.2rem 0.6rem;
  border-radius: 0.25rem;
  border: none;
  background: transparent;
  color: #64748b;
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}
.period-tab:hover {
  background: #e2e8f0;
  color: #334155;
}
.period-tab--active {
  background: #fff;
  color: #0f172a;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.08);
}

.executed-body {
  display: flex;
  align-items: baseline;
  gap: 0.75rem;
  margin-bottom: 0.25rem;
}
.executed-value {
  font-size: 2.5rem;
  font-weight: 700;
  line-height: 1;
}
.executed-skeleton {
  height: 2.5rem;
  width: 5rem;
  border-radius: 0.25rem;
  background: #e2e8f0;
  animation: shimmer 1.4s ease-in-out infinite;
}
.executed-sub {
  font-size: 0.75rem;
  color: #94a3b8;
  margin: 0;
}

.badge {
  font-size: 0.7rem;
  font-weight: 600;
  padding: 0.2rem 0.5rem;
  border-radius: 9999px;
}
.badge--up {
  background: #dcfce7;
  color: #16a34a;
}
.badge--down {
  background: #fee2e2;
  color: #dc2626;
}
.badge--neutral {
  background: #f1f5f9;
  color: #64748b;
}

@keyframes shimmer {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}
</style>

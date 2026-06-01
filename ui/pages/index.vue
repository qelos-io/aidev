<template>
  <div class="dashboard-page">
    <UCard>
      <template #header>
        <h1 class="text-lg font-semibold">Dashboard</h1>
      </template>

      <UAlert
        v-if="error"
        color="red"
        variant="soft"
        :title="error"
        class="mb-4"
      />

      <!-- Row 1: stat cards -->
      <div class="stats-grid">
        <DashboardStatCard
          label="Open"
          :value="stats?.open ?? null"
          :loading="loading"
          color="#3b82f6"
        />
        <DashboardStatCard
          label="Pending"
          :value="stats?.pending ?? null"
          :loading="loading"
          color="#0ea5e9"
        />
        <DashboardStatCard
          label="In Review"
          :value="stats?.inReview ?? null"
          :loading="loading"
          color="#f59e0b"
        />
        <DashboardStatCard
          label="All-Time Done"
          :value="stats?.allTimeDone ?? null"
          :loading="loading"
          color="#10b981"
        />
      </div>

      <!-- Row 2: executed tasks -->
      <div class="mt-4">
        <DashboardExecutedCard
          :data="stats?.executed ?? null"
          :period="period"
          :loading="loading"
          @update:period="period = $event"
        />
      </div>

      <!-- Row 3: run actions -->
      <div class="mt-4">
        <DashboardRunActions @run="onRun" />
      </div>
    </UCard>
  </div>
</template>

<script setup lang="ts">
import { useDashboard } from '~/composables/useDashboard';

const { period, stats, loading, error } = useDashboard();

function onRun(status: string) {
  navigateTo({ path: '/run', query: { autorun: status } });
}
</script>

<style scoped>
.stats-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 1rem;
}

@media (max-width: 768px) {
  .stats-grid {
    grid-template-columns: repeat(2, 1fr);
  }
}
@media (max-width: 480px) {
  .stats-grid {
    grid-template-columns: 1fr;
  }
}
</style>

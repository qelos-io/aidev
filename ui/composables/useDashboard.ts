import type { DashboardStats } from '~/server/api/dashboard/stats.get';
import { useApi } from '~/composables/useApi';

export type DashboardPeriod = 'week' | 'month' | '3months';

export function useDashboard() {
  const api = useApi();
  const period = ref<DashboardPeriod>('week');
  const stats = ref<DashboardStats | null>(null);
  const loading = ref(false);
  const error = ref('');

  let timer: ReturnType<typeof setTimeout> | null = null;

  async function fetch() {
    loading.value = true;
    error.value = '';
    try {
      stats.value = await api<DashboardStats>('/api/dashboard/stats', {
        query: { period: period.value },
      });
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err);
    } finally {
      loading.value = false;
    }
  }

  function setPeriod(p: DashboardPeriod) {
    period.value = p;
  }

  function schedule() {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      fetch().then(schedule);
    }, 60_000);
  }

  watch(period, () => fetch());

  onMounted(() => {
    fetch().then(schedule);
  });

  onBeforeUnmount(() => {
    if (timer) clearTimeout(timer);
  });

  return { period, stats, loading, error, setPeriod };
}

import type { DashboardStats } from '~/server/api/dashboard/stats.get';
import { useApi } from '~/composables/useApi';
import { useInitialLoading } from '~/composables/useInitialLoading';

export type DashboardPeriod = 'week' | 'month' | '3months';

export function useDashboard() {
  const api = useApi();
  const period = ref<DashboardPeriod>('week');
  const stats = ref<DashboardStats | null>(null);
  const error = ref('');
  const { loading, beginFetch, endFetch } = useInitialLoading(stats);

  let timer: ReturnType<typeof setTimeout> | null = null;

  async function fetch() {
    const isInitial = beginFetch(error);
    try {
      const result = await api<DashboardStats>('/api/dashboard/stats', {
        query: { period: period.value },
      });
      stats.value = result;
      if (result.errors?.length) {
        error.value = result.errors.join('; ');
      } else if (!isInitial) {
        error.value = '';
      }
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err);
    } finally {
      endFetch(isInitial);
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

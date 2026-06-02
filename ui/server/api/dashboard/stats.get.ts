import { defineEventHandler, getQuery } from 'h3';
import { getProvider, statusesForFilter, type UiTask } from '../../utils/provider';

export interface ExecutedStats {
  current: number;
  previous: number;
  changeAmount: number;
  changePercent: number | null;
}

export interface DashboardStats {
  open: number;
  pending: number;
  inReview: number;
  allTimeDone: number;
  executed: ExecutedStats;
  errors?: string[];
}

const PERIOD_MS: Record<string, number> = {
  week: 7 * 24 * 60 * 60 * 1000,
  month: 30 * 24 * 60 * 60 * 1000,
  '3months': 90 * 24 * 60 * 60 * 1000,
};

export default defineEventHandler(async (event): Promise<DashboardStats> => {
  const { config, provider, nonCodeProvider } = getProvider(event);
  const q = getQuery(event);
  const periodKey = typeof q.period === 'string' && q.period in PERIOD_MS ? q.period : 'week';

  const now = Date.now();
  const periodMs = PERIOD_MS[periodKey];
  const currentPeriodStart = now - periodMs;
  const previousPeriodStart = now - 2 * periodMs;

  const opts = { skipAttachments: true, omitDescription: true } as const;

  const openStatuses = statusesForFilter(config, 'open') ?? [];
  const pendingStatuses = statusesForFilter(config, 'pending') ?? [];
  const reviewStatuses = statusesForFilter(config, 'review') ?? [];
  const inProgressStatuses = statusesForFilter(config, 'inprogress') ?? [];
  const doneStatuses = statusesForFilter(config, 'done') ?? [];
  // Executed = tasks that have moved past open/pending
  const executedStatuses = [...reviewStatuses, ...inProgressStatuses, ...doneStatuses];

  // Primary counts — let provider errors propagate as 5xx so the client knows something is wrong
  const [openTasks, pendingTasks, reviewTasks, doneTasks] = await Promise.all([
    openStatuses.length ? provider.fetchTasksByStatus(openStatuses, opts) : Promise.resolve([]),
    pendingStatuses.length ? provider.fetchTasksByStatus(pendingStatuses, opts) : Promise.resolve([]),
    reviewStatuses.length ? provider.fetchTasksByStatus(reviewStatuses, opts) : Promise.resolve([]),
    doneStatuses.length ? provider.fetchTasksByStatus(doneStatuses, opts) : Promise.resolve([]),
  ]);

  // Tag filter for executed metric — only count tasks with code or non-code tag
  const codeTag = (config.clickupTag as string | undefined) ?? '';
  const nonCodeTagVal = (config.nonCodeTag as string | undefined) ?? '';
  const hasTagFilter = !!(codeTag || nonCodeTagVal);

  function filterByTag(tasks: UiTask[]): UiTask[] {
    if (!hasTagFilter) return tasks;
    return tasks.filter(
      (t) =>
        (codeTag && t.tags.includes(codeTag)) ||
        (nonCodeTagVal && t.tags.includes(nonCodeTagVal)),
    );
  }

  let currentCount = 0;
  let combinedCount = 0; // tasks updated since previousPeriodStart (spans both periods)
  const errors: string[] = [];

  if (executedStatuses.length) {
    try {
      const [currentTasks, combinedTasks] = await Promise.all([
        provider.fetchTasksByStatus(executedStatuses, { ...opts, updatedAfter: currentPeriodStart }),
        provider.fetchTasksByStatus(executedStatuses, { ...opts, updatedAfter: previousPeriodStart }),
      ]);

      currentCount = filterByTag(currentTasks).length;
      combinedCount = filterByTag(combinedTasks).length;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[dashboard/stats] executed fetch failed (provider=${config.provider}): ${msg}`);
      errors.push(`Executed stats unavailable: ${msg}`);
    }

    if (nonCodeProvider) {
      try {
        // nonCodeProvider is already scoped to nonCodeTag by its config; no extra tag filter needed
        const [ncCurrent, ncCombined] = await Promise.all([
          nonCodeProvider.fetchTasksByStatus(executedStatuses, { ...opts, updatedAfter: currentPeriodStart }),
          nonCodeProvider.fetchTasksByStatus(executedStatuses, { ...opts, updatedAfter: previousPeriodStart }),
        ]);
        currentCount += ncCurrent.length;
        combinedCount += ncCombined.length;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[dashboard/stats] executed fetch failed (nonCodeProvider): ${msg}`);
        errors.push(`Executed stats (non-code) unavailable: ${msg}`);
      }
    }
  }

  // Derive previous-period-only count by subtracting the current period from the combined window
  const previousCount = Math.max(0, combinedCount - currentCount);
  const changeAmount = currentCount - previousCount;
  const changePercent = previousCount > 0 ? Math.round((changeAmount / previousCount) * 100) : null;

  return {
    open: openTasks.length,
    pending: pendingTasks.length,
    inReview: reviewTasks.length,
    allTimeDone: doneTasks.length,
    executed: {
      current: currentCount,
      previous: previousCount,
      changeAmount,
      changePercent,
    },
    ...(errors.length ? { errors } : {}),
  };
});

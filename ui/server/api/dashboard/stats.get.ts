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
}

const PERIOD_MS: Record<string, number> = {
  week: 7 * 24 * 60 * 60 * 1000,
  month: 30 * 24 * 60 * 60 * 1000,
  '3months': 90 * 24 * 60 * 60 * 1000,
};

async function safeFetch(fn: () => Promise<UiTask[]>): Promise<UiTask[]> {
  try {
    return await fn();
  } catch {
    return [];
  }
}

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

  const [openTasks, pendingTasks, reviewTasks, doneTasks] = await Promise.all([
    safeFetch(() => openStatuses.length ? provider.fetchTasksByStatus(openStatuses, opts) : Promise.resolve([])),
    safeFetch(() => pendingStatuses.length ? provider.fetchTasksByStatus(pendingStatuses, opts) : Promise.resolve([])),
    safeFetch(() => reviewStatuses.length ? provider.fetchTasksByStatus(reviewStatuses, opts) : Promise.resolve([])),
    safeFetch(() => doneStatuses.length ? provider.fetchTasksByStatus(doneStatuses, opts) : Promise.resolve([])),
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

  if (executedStatuses.length) {
    const [currentTasks, combinedTasks] = await Promise.all([
      safeFetch(() =>
        provider.fetchTasksByStatus(executedStatuses, { ...opts, updatedAfter: currentPeriodStart }),
      ),
      safeFetch(() =>
        provider.fetchTasksByStatus(executedStatuses, { ...opts, updatedAfter: previousPeriodStart }),
      ),
    ]);

    currentCount = filterByTag(currentTasks).length;
    combinedCount = filterByTag(combinedTasks).length;

    if (nonCodeProvider) {
      // nonCodeProvider is already scoped to nonCodeTag by its config; no extra tag filter needed
      const [ncCurrent, ncCombined] = await Promise.all([
        safeFetch(() =>
          nonCodeProvider.fetchTasksByStatus(executedStatuses, { ...opts, updatedAfter: currentPeriodStart }),
        ),
        safeFetch(() =>
          nonCodeProvider.fetchTasksByStatus(executedStatuses, { ...opts, updatedAfter: previousPeriodStart }),
        ),
      ]);
      currentCount += ncCurrent.length;
      combinedCount += ncCombined.length;
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
  };
});

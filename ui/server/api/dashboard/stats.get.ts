import { defineEventHandler, getQuery } from 'h3';
import { fetchBoardTasks, mergeTasksById } from '../../utils/boardTasks';
import { resolveDoneStatuses } from '../../utils/doneStatus';
import {
  getProvider,
  statusesForFilter,
  type UiConfig,
  type UiDashboardCounts,
  type UiDashboardStatsParams,
  type UiProvider,
  type UiTask,
} from '../../utils/provider';

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

const BOARD_OPTS = { skipAttachments: true, omitDescription: true } as const;

const ZERO_COUNTS: UiDashboardCounts = {
  open: 0,
  pending: 0,
  inReview: 0,
  allTimeDone: 0,
  executedCurrent: 0,
  executedPrevious: 0,
};

function addCounts(a: UiDashboardCounts, b: UiDashboardCounts): UiDashboardCounts {
  return {
    open: a.open + b.open,
    pending: a.pending + b.pending,
    inReview: a.inReview + b.inReview,
    allTimeDone: a.allTimeDone + b.allTimeDone,
    executedCurrent: a.executedCurrent + b.executedCurrent,
    executedPrevious: a.executedPrevious + b.executedPrevious,
  };
}

function countByStatuses(tasks: UiTask[], statuses: string[]): number {
  if (!statuses.length) return 0;
  const set = new Set(statuses.map((s) => s.toLowerCase()));
  return tasks.filter((t) => set.has(t.status.toLowerCase())).length;
}

async function fetchMergedBoardTasks(
  config: UiConfig,
  provider: UiProvider,
  nonCodeProvider?: UiProvider,
): Promise<UiTask[]> {
  let tasks = await fetchBoardTasks(config, provider);
  if (nonCodeProvider) {
    tasks = mergeTasksById(tasks, await fetchBoardTasks(config, nonCodeProvider));
  }
  return tasks;
}

async function fetchMergedByStatus(
  config: UiConfig,
  provider: UiProvider,
  nonCodeProvider: UiProvider | undefined,
  statuses: string[],
  options: { skipAttachments: true; omitDescription: true; includeClosed?: boolean; updatedAfter?: number },
): Promise<UiTask[]> {
  if (!statuses.length) return [];
  let tasks = await provider.fetchTasksByStatus(statuses, options);
  if (nonCodeProvider) {
    tasks = mergeTasksById(tasks, await nonCodeProvider.fetchTasksByStatus(statuses, options));
  }
  return tasks;
}

async function fetchOptimizedCounts(
  provider: UiProvider,
  nonCodeProvider: UiProvider | undefined,
  params: UiDashboardStatsParams,
): Promise<UiDashboardCounts> {
  const fetches: Promise<UiDashboardCounts>[] = [];
  if (typeof provider.fetchDashboardCounts === 'function') {
    fetches.push(provider.fetchDashboardCounts(params));
  }
  if (nonCodeProvider && typeof nonCodeProvider.fetchDashboardCounts === 'function') {
    fetches.push(nonCodeProvider.fetchDashboardCounts(params));
  }
  if (!fetches.length) return ZERO_COUNTS;
  const parts = await Promise.all(fetches);
  return parts.reduce(addCounts, ZERO_COUNTS);
}

async function fetchLegacyStats(
  config: UiConfig,
  provider: UiProvider,
  nonCodeProvider: UiProvider | undefined,
  openStatuses: string[],
  pendingStatuses: string[],
  reviewStatuses: string[],
  inProgressStatuses: string[],
  doneStatuses: string[],
  currentPeriodStart: number,
  previousPeriodStart: number,
): Promise<{ counts: UiDashboardCounts; errors: string[] }> {
  const boardTasks = await fetchMergedBoardTasks(config, provider, nonCodeProvider);
  const open = countByStatuses(boardTasks, openStatuses);
  const pending = countByStatuses(boardTasks, pendingStatuses);
  const inReview = countByStatuses(boardTasks, reviewStatuses);

  const doneTasks = await fetchMergedByStatus(
    config,
    provider,
    nonCodeProvider,
    doneStatuses,
    { ...BOARD_OPTS, includeClosed: true },
  );

  const executedStatuses = [...reviewStatuses, ...inProgressStatuses, ...doneStatuses];
  const executedOpts = { ...BOARD_OPTS, includeClosed: true };
  const errors: string[] = [];
  let executedCurrent = 0;
  let executedCombined = 0;

  if (executedStatuses.length) {
    try {
      const [currentTasks, combinedTasks] = await Promise.all([
        fetchMergedByStatus(config, provider, nonCodeProvider, executedStatuses, {
          ...executedOpts,
          updatedAfter: currentPeriodStart,
        }),
        fetchMergedByStatus(config, provider, nonCodeProvider, executedStatuses, {
          ...executedOpts,
          updatedAfter: previousPeriodStart,
        }),
      ]);
      executedCurrent = currentTasks.length;
      executedCombined = combinedTasks.length;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[dashboard/stats] executed fetch failed (provider=${config.provider}): ${msg}`);
      errors.push(`Executed stats unavailable: ${msg}`);
    }
  }

  return {
    counts: {
      open,
      pending,
      inReview,
      allTimeDone: doneTasks.length,
      executedCurrent,
      executedPrevious: Math.max(0, executedCombined - executedCurrent),
    },
    errors,
  };
}

export default defineEventHandler(async (event): Promise<DashboardStats> => {
  const { config, provider, nonCodeProvider } = getProvider(event);
  const q = getQuery(event);
  const periodKey = typeof q.period === 'string' && q.period in PERIOD_MS ? q.period : 'week';

  const now = Date.now();
  const periodMs = PERIOD_MS[periodKey];
  const currentPeriodStart = now - periodMs;
  const previousPeriodStart = now - 2 * periodMs;

  const openStatuses = statusesForFilter(config, 'open') ?? [];
  const pendingStatuses = statusesForFilter(config, 'pending') ?? [];
  const reviewStatuses = statusesForFilter(config, 'review') ?? [];
  const inProgressStatuses = statusesForFilter(config, 'inprogress') ?? [];
  const doneStatuses = await resolveDoneStatuses(config, provider);

  const statsParams: UiDashboardStatsParams = {
    openStatuses,
    pendingStatuses,
    reviewStatuses,
    inProgressStatuses,
    doneStatuses,
    currentPeriodStart,
    previousPeriodStart,
  };

  let counts: UiDashboardCounts;
  let errors: string[] = [];

  if (typeof provider.fetchDashboardCounts === 'function') {
    counts = await fetchOptimizedCounts(provider, nonCodeProvider, statsParams);
  } else {
    const legacy = await fetchLegacyStats(
      config,
      provider,
      nonCodeProvider,
      openStatuses,
      pendingStatuses,
      reviewStatuses,
      inProgressStatuses,
      doneStatuses,
      currentPeriodStart,
      previousPeriodStart,
    );
    counts = legacy.counts;
    errors = legacy.errors;
  }

  const changeAmount = counts.executedCurrent - counts.executedPrevious;
  const changePercent =
    counts.executedPrevious > 0
      ? Math.round((changeAmount / counts.executedPrevious) * 100)
      : null;

  return {
    open: counts.open,
    pending: counts.pending,
    inReview: counts.inReview,
    allTimeDone: counts.allTimeDone,
    executed: {
      current: counts.executedCurrent,
      previous: counts.executedPrevious,
      changeAmount,
      changePercent,
    },
    ...(errors.length ? { errors } : {}),
  };
});

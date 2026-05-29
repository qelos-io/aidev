import type { BoardColumn, TasksFilters, UiTask } from '~/types/tasks';

export const DEFAULT_TASK_FILTERS: TasksFilters = {
  open: ['open'],
  pending: ['pending'],
  inProgress: ['in progress'],
  review: ['review'],
  done: ['done'],
};

export function buildBoardColumns(
  tasks: UiTask[],
  filters: TasksFilters,
  loaded: boolean,
): BoardColumn[] {
  const lc = (xs: string[]) => xs.map((s) => s.toLowerCase());
  const open = new Set(lc(filters.open));
  const pending = new Set(lc(filters.pending));
  const inProgress = new Set(lc(filters.inProgress));
  const review = new Set(lc(filters.review));
  const done = new Set(lc(filters.done));

  const matches = (s: string, bucket: Set<string>) => bucket.has(s.toLowerCase());
  const isOther = (s: string) =>
    !matches(s, open) &&
    !matches(s, pending) &&
    !matches(s, inProgress) &&
    !matches(s, review) &&
    !matches(s, done);

  const cols: BoardColumn[] = [
    { key: 'open', title: 'Open', tasks: [] },
    { key: 'pending', title: 'Pending', tasks: [] },
    { key: 'inprogress', title: 'In Progress', tasks: [] },
    { key: 'review', title: 'In Review', tasks: [] },
    { key: 'done', title: 'Done', tasks: [] },
    { key: 'other', title: 'Other', tasks: [] },
  ];

  for (const task of tasks) {
    const status = task.status.toLowerCase();
    if (open.has(status)) cols[0].tasks.push(task);
    else if (pending.has(status)) cols[1].tasks.push(task);
    else if (inProgress.has(status)) cols[2].tasks.push(task);
    else if (review.has(status)) cols[3].tasks.push(task);
    else if (done.has(status)) cols[4].tasks.push(task);
    else cols[5].tasks.push(task);
  }

  for (const col of cols) {
    col.tasks.sort((a, b) => {
      const pa = a.priority ?? Number.MAX_SAFE_INTEGER;
      const pb = b.priority ?? Number.MAX_SAFE_INTEGER;
      if (pa !== pb) return pa - pb;
      return a.id.localeCompare(b.id);
    });
  }

  if (!loaded) {
    return cols.filter((c) => c.key !== 'other');
  }
  return cols.filter((c) => c.tasks.length > 0 || c.key !== 'other');
}

export function buildStatusOptions(
  filters: TasksFilters,
  providerStatuses: string[],
): { label: string; value: string }[] {
  if (providerStatuses.length > 0) {
    return providerStatuses.map((s) => ({ label: s, value: s }));
  }
  const all = [...filters.open, ...filters.pending, ...filters.inProgress, ...filters.review, ...filters.done];
  const seen = new Set<string>();
  const opts: { label: string; value: string }[] = [];
  for (const s of all) {
    if (!s || seen.has(s)) continue;
    seen.add(s);
    opts.push({ label: s, value: s });
  }
  return opts;
}

export function formatTaskDate(epochMs: number): string {
  if (!epochMs) return '';
  try {
    return new Date(epochMs).toLocaleString();
  } catch {
    return '';
  }
}

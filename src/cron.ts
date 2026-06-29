/**
 * Minimal 5-field cron parser and matcher.
 * Supports: *, N, N-M, N,M, *​/N, N-M/S, and L (last day of month in day-of-month field).
 */

interface CronFields {
  minute: Set<number>;
  hour: Set<number>;
  dayOfMonth: Set<number> | 'L';
  month: Set<number>;
  dayOfWeek: Set<number>;
}

function parseField(field: string, min: number, max: number): Set<number> {
  const values = new Set<number>();

  for (const part of field.split(',')) {
    const stepMatch = part.match(/^(.+)\/(\d+)$/);
    const range = stepMatch ? stepMatch[1] : part;
    const step = stepMatch ? parseInt(stepMatch[2], 10) : 1;

    if (range === '*') {
      for (let i = min; i <= max; i += step) values.add(i);
    } else {
      const rangeMatch = range.match(/^(\d+)-(\d+)$/);
      if (rangeMatch) {
        const start = parseInt(rangeMatch[1], 10);
        const end = parseInt(rangeMatch[2], 10);
        for (let i = start; i <= end; i += step) values.add(i);
      } else {
        values.add(parseInt(range, 10));
      }
    }
  }

  return values;
}

export function parseCron(expr: string): CronFields {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) throw new Error(`Invalid cron expression: "${expr}" (expected 5 fields)`);

  const [minF, hourF, domF, monthF, dowF] = parts;

  return {
    minute: parseField(minF, 0, 59),
    hour: parseField(hourF, 0, 23),
    dayOfMonth: domF.toUpperCase() === 'L' ? 'L' : parseField(domF, 1, 31),
    month: parseField(monthF, 1, 12),
    dayOfWeek: parseField(dowF, 0, 6),
  };
}

function lastDayOfMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

export function cronMatchesDate(fields: CronFields, date: Date): boolean {
  if (!fields.minute.has(date.getMinutes())) return false;
  if (!fields.hour.has(date.getHours())) return false;
  if (!fields.month.has(date.getMonth() + 1)) return false;

  if (fields.dayOfMonth === 'L') {
    if (date.getDate() !== lastDayOfMonth(date.getFullYear(), date.getMonth() + 1)) return false;
  } else {
    if (!fields.dayOfMonth.has(date.getDate())) return false;
  }

  if (!fields.dayOfWeek.has(date.getDay())) return false;
  return true;
}

/**
 * Returns true if the cron expression would have fired between `lastPushedAt`
 * and now.  If `lastPushedAt` is undefined the task has never been pushed, so
 * the answer is always true.
 *
 * Scans minute-by-minute from (lastPushedAt + 1 min) to now.
 */
export function shouldCronFire(expr: string, lastPushedAt?: number): boolean {
  if (lastPushedAt === undefined) return true;

  const fields = parseCron(expr);
  const now = new Date();
  now.setSeconds(0, 0);
  const nowMs = now.getTime();

  const startDate = new Date(lastPushedAt + 60_000);
  startDate.setSeconds(0, 0);

  for (let ts = startDate.getTime(); ts <= nowMs; ts += 60_000) {
    if (cronMatchesDate(fields, new Date(ts))) return true;
  }

  return false;
}

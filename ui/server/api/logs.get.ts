import { defineEventHandler, getQuery, createError } from 'h3';
import * as fs from 'node:fs';
import { resolveLogPath } from '../utils/logFile';

const DEFAULT_LIMIT = 1000;
const MAX_LIMIT = 50000;

export interface LogsResponse {
  path: string;
  exists: boolean;
  total: number;
  shown: number;
  truncated: boolean;
  limit: number;
  query: string;
  lines: string[];
  ttlDays: number;
}

export default defineEventHandler((event): LogsResponse => {
  const cwd = process.env.AIDEV_CWD;
  if (!cwd) {
    throw createError({ statusCode: 500, statusMessage: 'AIDEV_CWD not set' });
  }

  const file = resolveLogPath(cwd);
  const rawTtl = (process.env.AIDEV_LOG_TTL_DAYS || '').trim();
  const ttlParsed = rawTtl === '' ? 14 : parseInt(rawTtl, 10);
  const ttlDays = Number.isFinite(ttlParsed) && ttlParsed > 0 ? ttlParsed : 0;

  const query = getQuery(event);
  const rawLimit = Number.parseInt(String(query.limit ?? ''), 10);
  const limit = Number.isFinite(rawLimit) && rawLimit > 0
    ? Math.min(rawLimit, MAX_LIMIT)
    : DEFAULT_LIMIT;
  const q = typeof query.q === 'string' ? query.q : '';
  const needle = q.toLowerCase();

  if (!fs.existsSync(file)) {
    return {
      path: file,
      exists: false,
      total: 0,
      shown: 0,
      truncated: false,
      limit,
      query: q,
      lines: [],
      ttlDays,
    };
  }

  const raw = fs.readFileSync(file, 'utf8');
  const all = raw.split(/\r?\n/);
  // split() leaves a trailing empty string when the file ends with a newline —
  // drop it so the count reflects real log lines.
  if (all.length > 0 && all[all.length - 1] === '') all.pop();

  const total = all.length;
  const tail = total > limit ? all.slice(total - limit) : all;
  const lines = needle ? tail.filter((l) => l.toLowerCase().includes(needle)) : tail;

  return {
    path: file,
    exists: true,
    total,
    shown: lines.length,
    truncated: total > tail.length,
    limit,
    query: q,
    lines,
    ttlDays,
  };
});

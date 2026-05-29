import { defineEventHandler, readBody, createError } from 'h3';
import { setSchedule } from '../utils/schedule';

interface ScheduleSetBody {
  cron?: string;
  envFile?: string;
}

export default defineEventHandler(async (event) => {
  const body = await readBody<ScheduleSetBody>(event);
  const cron = typeof body?.cron === 'string' ? body.cron.trim() : '';
  if (!cron) {
    throw createError({ statusCode: 400, statusMessage: 'cron is required' });
  }

  const extraArgs: string[] = [];
  const envFile = typeof body?.envFile === 'string' ? body.envFile.trim() : '';
  if (envFile) extraArgs.push('-e', envFile);

  return setSchedule(cron, extraArgs);
});

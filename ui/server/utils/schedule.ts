import { createError } from 'h3';
import { createRequire } from 'node:module';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type {
  ScheduleFixResponse,
  ScheduleMutationResponse,
  SchedulesResponse,
} from '~/types/schedule';

interface ScheduleModule {
  listSchedules(currentCwd: string): SchedulesResponse;
  setScheduleForCwd(cwd: string, cron: string, extraArgs?: string[]): ScheduleMutationResponse;
  removeScheduleById(id: number): ScheduleMutationResponse;
  fixSchedules(): ScheduleFixResponse;
}

function getDistDir(cwd: string): string {
  const dist = path.join(cwd, 'dist');
  if (!fs.existsSync(dist)) {
    throw createError({
      statusCode: 503,
      statusMessage:
        `aidev build artifacts not found at ${dist}. ` +
        `Run \`npm run build\` in the aidev repo before using the dashboard.`,
    });
  }
  return dist;
}

function loadScheduleModule(cwd: string): ScheduleModule {
  const dist = getDistDir(cwd);
  const req = createRequire(path.join(cwd, 'package.json'));
  return req(path.join(dist, 'commands/schedule.js')) as ScheduleModule;
}

function requireCwd(): string {
  const cwd = process.env.AIDEV_CWD;
  if (!cwd) {
    throw createError({ statusCode: 500, statusMessage: 'AIDEV_CWD not set' });
  }
  return cwd;
}

export function getSchedulesSnapshot(): SchedulesResponse {
  const cwd = requireCwd();
  return loadScheduleModule(cwd).listSchedules(cwd);
}

export function setSchedule(cron: string, extraArgs: string[] = []): ScheduleMutationResponse {
  const cwd = requireCwd();
  const result = loadScheduleModule(cwd).setScheduleForCwd(cwd, cron, extraArgs);
  if (!result.ok) {
    throw createError({ statusCode: 400, statusMessage: result.message });
  }
  return result;
}

export function removeSchedule(id: number): ScheduleMutationResponse {
  const cwd = requireCwd();
  const result = loadScheduleModule(cwd).removeScheduleById(id);
  if (!result.ok) {
    throw createError({ statusCode: 400, statusMessage: result.message });
  }
  return result;
}

export function fixSchedules(): ScheduleFixResponse {
  const cwd = requireCwd();
  const result = loadScheduleModule(cwd).fixSchedules();
  if (!result.ok) {
    throw createError({ statusCode: 400, statusMessage: result.message });
  }
  return result;
}

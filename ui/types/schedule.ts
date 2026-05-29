export type ScheduleBackend = 'cron' | 'launchd' | 'schtasks';

export interface SchedulePreset {
  label: string;
  cron: string;
}

export interface ScheduleEntry {
  id: number;
  cwd: string;
  cron: string | null;
  label: string;
  extraArgs: string[];
  current: boolean;
}

export interface SchedulesResponse {
  platform: string;
  backend: ScheduleBackend;
  presets: SchedulePreset[];
  entries: ScheduleEntry[];
  currentCwd: string;
  fixSupported: boolean;
}

export interface ScheduleMutationResponse {
  ok: boolean;
  message: string;
}

export interface ScheduleFixResponse {
  ok: boolean;
  message: string;
  fixed: number;
  unchanged: number;
}

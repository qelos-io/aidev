import * as os from 'node:os';
import * as path from 'node:path';
import { readEnvFile } from './envFile';

const DEFAULT_LOG_FILENAME = 'aidev.log';

// Mirrors resolveLogFile() in src/logger.ts so the UI points at the same file
// the CLI is writing to. The CLI reads AIDEV_LOG_PATH from process.env after
// loadConfig() merges it in; here we read it straight from .env.aidev so the
// UI doesn't depend on the CLI being booted.
export function resolveLogPath(cwd: string): string {
  const env = readEnvFile(cwd);
  const raw = (env.values.AIDEV_LOG_PATH || '').trim();
  if (!raw) return path.join(cwd, DEFAULT_LOG_FILENAME);
  if (raw === '~') return os.homedir();
  if (raw.startsWith('~/')) return path.join(os.homedir(), raw.slice(2));
  if (path.isAbsolute(raw)) return raw;
  return path.resolve(cwd, raw);
}

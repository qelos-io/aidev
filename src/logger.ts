import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import chalk from 'chalk';

const DEFAULT_LOG_FILENAME = 'aidev.log';
const DEFAULT_LOG_TTL_DAYS = 14;
const ISO_DATE_RE = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})/;

function resolveLogFile(): string {
  const raw = (process.env.AIDEV_LOG_PATH || '').trim();
  if (!raw) return path.join(process.cwd(), DEFAULT_LOG_FILENAME);
  if (raw.startsWith('~/') || raw === '~') {
    return path.join(os.homedir(), raw.slice(2));
  }
  if (path.isAbsolute(raw)) return raw;
  return path.resolve(process.cwd(), raw);
}

function getLogFile(): string {
  const file = resolveLogFile();
  const dir = path.dirname(file);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return file;
}

// Strip ANSI escape codes for clean file output
function strip(s: string): string {
  return s.replace(/\x1B\[[0-9;]*m/g, '');
}

function timestamp(): string {
  return new Date().toISOString();
}

function writeLog(level: string, msg: string): void {
  const line = `${timestamp()} [${level}] ${strip(msg)}\n`;
  fs.appendFileSync(getLogFile(), line, 'utf8');
}

export function pruneLog(): void {
  const rawTtl = (process.env.AIDEV_LOG_TTL_DAYS || '').trim();
  const ttlDays = rawTtl === '' ? DEFAULT_LOG_TTL_DAYS : parseInt(rawTtl, 10);
  if (!Number.isFinite(ttlDays) || ttlDays <= 0) return;

  const file = resolveLogFile();
  if (!fs.existsSync(file)) return;

  const content = fs.readFileSync(file, 'utf8');
  const lines = content.split('\n');
  const cutoff = Date.now() - ttlDays * 24 * 60 * 60 * 1000;

  let keepFrom = 0;
  for (let i = 0; i < lines.length; i++) {
    const m = ISO_DATE_RE.exec(lines[i]);
    if (m) {
      const ts = new Date(m[1]).getTime();
      if (!Number.isNaN(ts) && ts < cutoff) {
        keepFrom = i + 1;
      } else {
        break;
      }
    }
  }

  if (keepFrom === 0) return;
  fs.writeFileSync(file, lines.slice(keepFrom).join('\n'), 'utf8');
}

export function logRunStart(): void {
  pruneLog();
  const sep = '─'.repeat(60);
  fs.appendFileSync(getLogFile(), `\n${sep}\n${timestamp()} [run] started\n${sep}\n`, 'utf8');
}

export const logger = {
  info: (msg: string) => {
    console.log(chalk.blue('[aidev]'), msg);
    writeLog('info', msg);
  },
  success: (msg: string) => {
    console.log(chalk.green('[aidev]'), msg);
    writeLog('success', msg);
  },
  warn: (msg: string) => {
    console.log(chalk.yellow('[aidev]'), msg);
    writeLog('warn', msg);
  },
  error: (msg: string) => {
    console.error(chalk.red('[aidev]'), msg);
    writeLog('error', msg);
  },
  task: (msg: string) => {
    console.log(chalk.cyan('[task]'), msg);
    writeLog('task', msg);
  },
  debug: (msg: string) => {
    if (process.env.DEBUG) {
      console.log(chalk.gray('[debug]'), msg);
      writeLog('debug', msg);
    }
  },
};

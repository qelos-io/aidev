import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import chalk from 'chalk';

const DEFAULT_LOG_FILENAME = 'aidev.log';

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

export function logRunStart(): void {
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

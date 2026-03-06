import * as fs from 'node:fs';
import * as path from 'node:path';
import chalk from 'chalk';

const LOG_FILE = path.join(process.cwd(), 'aidev.log');

// Strip ANSI escape codes for clean file output
function strip(s: string): string {
  return s.replace(/\x1B\[[0-9;]*m/g, '');
}

function timestamp(): string {
  return new Date().toISOString();
}

function writeLog(level: string, msg: string): void {
  const line = `${timestamp()} [${level}] ${strip(msg)}\n`;
  fs.appendFileSync(LOG_FILE, line, 'utf8');
}

export function logRunStart(): void {
  const sep = '─'.repeat(60);
  fs.appendFileSync(LOG_FILE, `\n${sep}\n${timestamp()} [run] started\n${sep}\n`, 'utf8');
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

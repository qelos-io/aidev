import { spawnSync } from 'node:child_process';
import * as readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { logger } from '../logger';
import { isWindows, findBin } from '../platform';
import chalk from 'chalk';

// ─── Preset schedules ────────────────────────────────────────────────────────

const PRESETS: Array<{ label: string; cron: string }> = [
  { label: 'Every 15 minutes', cron: '*/15 * * * *' },
  { label: 'Every 30 minutes', cron: '*/30 * * * *' },
  { label: 'Every hour',       cron: '0 * * * *'    },
  { label: 'Every 5 hours',    cron: '0 */5 * * *'  },
  { label: 'Every day at 8am', cron: '0 8 * * *'    },
];

async function pickCron(): Promise<string> {
  console.log('\n  Select a schedule:');
  PRESETS.forEach((p, i) =>
    console.log(`    ${chalk.cyan(String(i + 1))}. ${p.label}  ${chalk.dim(p.cron)}`)
  );

  const rl = readline.createInterface({ input, output });
  try {
    while (true) {
      const raw = await rl.question(`\n  Choice ${chalk.dim('[1]')}: `);
      const val = raw.trim() || '1';
      const idx = parseInt(val, 10);
      if (idx >= 1 && idx <= PRESETS.length) return PRESETS[idx - 1].cron;
      console.log(chalk.yellow(`  Enter a number between 1 and ${PRESETS.length}.`));
    }
  } finally {
    rl.close();
  }
}

// ─── Shared helpers ───────────────────────────────────────────────────────────

function getAidevBin(): string {
  return findBin('aidev') ?? 'aidev';
}

// ─── Unix (crontab) ───────────────────────────────────────────────────────────

const UNIX_MARKER_PREFIX = '# aidev-cwd:';

function getCrontab(): string {
  const result = spawnSync('crontab', ['-l'], { encoding: 'utf8' });
  return result.status === 0 ? result.stdout || '' : '';
}

function setCrontab(content: string): boolean {
  const result = spawnSync('crontab', ['-'], { input: content, encoding: 'utf8' });
  return result.status === 0;
}

function scheduleSetUnix(cronExpr: string): void {
  const cwd = process.cwd();
  const marker = `${UNIX_MARKER_PREFIX}${cwd}`;
  const aidevBin = getAidevBin();
  const newLine = `${cronExpr} cd ${cwd} && ${aidevBin} run ${marker}`;

  const lines = getCrontab().split('\n').filter((l) => !l.includes(marker));
  lines.push(newLine);
  const updated = lines.join('\n').replace(/\n+$/, '') + '\n';

  if (setCrontab(updated)) {
    logger.success(`Cron schedule set: ${cronExpr}`);
    logger.info(`Entry: ${newLine}`);
  } else {
    logger.error('Failed to update crontab');
    process.exit(1);
  }
}

interface CronEntry {
  cron: string;
  cwd: string;
  line: string;
}

function parseAidevEntries(crontab: string): CronEntry[] {
  return crontab
    .split('\n')
    .filter((l) => l.includes(UNIX_MARKER_PREFIX))
    .map((line) => {
      const cwdMatch = line.match(/# aidev-cwd:(.+)$/);
      const cwd = cwdMatch ? cwdMatch[1].trim() : '(unknown)';
      const parts = line.trim().split(/\s+/);
      const cron = parts.slice(0, 5).join(' ');
      return { cron, cwd, line };
    });
}

function printEntriesTable(entries: CronEntry[]): void {
  const cwdW = Math.max(9, ...entries.map((e) => e.cwd.length));
  const cronW = Math.max(8, ...entries.map((e) => e.cron.length));
  const header =
    `  ${chalk.bold('ID')}  ` +
    `${chalk.bold('Directory'.padEnd(cwdW))}  ` +
    chalk.bold('Schedule'.padEnd(cronW));
  const sep =
    `  ──  ` + `${'─'.repeat(cwdW)}  ` + '─'.repeat(cronW);
  console.log(header);
  console.log(sep);
  entries.forEach((e, i) => {
    const id = chalk.cyan(String(i + 1).padStart(2));
    const isCurrentDir = e.cwd === process.cwd();
    const dir = isCurrentDir ? chalk.green(e.cwd.padEnd(cwdW)) : e.cwd.padEnd(cwdW);
    console.log(`  ${id}  ${dir}  ${e.cron}`);
  });
}

function scheduleGetUnix(): void {
  const entries = parseAidevEntries(getCrontab());
  if (entries.length === 0) {
    logger.warn('No aidev schedules found');
    logger.info('Use "aidev schedule set" to configure one.');
    return;
  }
  logger.info('Scheduled aidev jobs:');
  console.log();
  printEntriesTable(entries);
  console.log();
}

async function scheduleRemoveUnix(id?: number): Promise<void> {
  const crontab = getCrontab();
  const entries = parseAidevEntries(crontab);

  if (entries.length === 0) {
    logger.warn('No aidev schedules found');
    return;
  }

  let idx: number;
  if (id !== undefined) {
    idx = id - 1;
  } else {
    logger.info('Scheduled aidev jobs:');
    console.log();
    printEntriesTable(entries);
    console.log();
    const rl = readline.createInterface({ input, output });
    try {
      while (true) {
        const raw = await rl.question(`  Remove ID ${chalk.dim('[1]')}: `);
        const val = raw.trim() || '1';
        const n = parseInt(val, 10);
        if (n >= 1 && n <= entries.length) { idx = n - 1; break; }
        console.log(chalk.yellow(`  Enter a number between 1 and ${entries.length}.`));
      }
    } finally {
      rl.close();
    }
  }

  if (idx! < 0 || idx! >= entries.length) {
    logger.error(`Invalid ID: ${id}. Valid range: 1–${entries.length}`);
    process.exit(1);
  }

  const toRemove = entries[idx!];
  const updated = crontab
    .split('\n')
    .filter((l) => l !== toRemove.line)
    .join('\n')
    .replace(/\n+$/, '') + '\n';

  if (setCrontab(updated)) {
    logger.success(`Removed schedule for ${toRemove.cwd}`);
  } else {
    logger.error('Failed to update crontab');
    process.exit(1);
  }
}

// ─── Windows (schtasks) ───────────────────────────────────────────────────────

/**
 * Converts a cron expression to schtasks /sc + /mo + /st arguments.
 * Supports the subset used by the preset list.
 */
export function cronToSchtasksArgs(cron: string): string[] | null {
  // */N * * * *  →  every N minutes
  const everyMin = cron.match(/^\*\/(\d+) \* \* \* \*$/);
  if (everyMin) return ['/sc', 'MINUTE', '/mo', everyMin[1]];

  // 0 * * * *  →  every hour
  if (cron === '0 * * * *') return ['/sc', 'HOURLY', '/mo', '1'];

  // 0 */N * * *  →  every N hours
  const everyHour = cron.match(/^0 \*\/(\d+) \* \* \*$/);
  if (everyHour) return ['/sc', 'HOURLY', '/mo', everyHour[1]];

  // 0 H * * *  →  daily at H:00
  const daily = cron.match(/^0 (\d+) \* \* \*$/);
  if (daily) return ['/sc', 'DAILY', '/st', `${daily[1].padStart(2, '0')}:00`];

  return null;
}

/** Stable task name derived from cwd — safe for Task Scheduler. */
export function windowsTaskName(cwd: string): string {
  const sanitized = cwd.replace(/[:\\\/]+/g, '-').replace(/^-+|-+$/g, '');
  return `aidev\\${sanitized}`;
}

function scheduleSetWindows(cronExpr: string): void {
  const cwd = process.cwd();
  const schtasksArgs = cronToSchtasksArgs(cronExpr);
  if (!schtasksArgs) {
    logger.error(
      `Cron expression "${cronExpr}" cannot be mapped to Windows Task Scheduler.\n` +
      '  Use "aidev schedule set" (no argument) to choose a supported preset.'
    );
    process.exit(1);
  }

  const taskName = windowsTaskName(cwd);
  const aidevBin = getAidevBin();
  // cmd /c: run command and exit; /d: change drive+dir
  const command = `cmd /c cd /d "${cwd}" && "${aidevBin}" run`;

  const result = spawnSync(
    'schtasks',
    ['/create', '/f', '/tn', taskName, '/tr', command, ...schtasksArgs],
    { encoding: 'utf8' }
  );

  if (result.status === 0) {
    logger.success(`Task Scheduler entry created: ${taskName}`);
    logger.info(`Schedule: ${cronExpr}`);
  } else {
    logger.error(`Failed to create Task Scheduler entry:\n${result.stderr}`);
    process.exit(1);
  }
}

function scheduleGetWindows(): void {
  const cwd = process.cwd();
  const taskName = windowsTaskName(cwd);

  const result = spawnSync('schtasks', ['/query', '/tn', taskName, '/fo', 'LIST'], {
    encoding: 'utf8',
  });

  if (result.status === 0) {
    logger.info(`Task Scheduler entry for ${cwd}:`);
    console.log(result.stdout.trim());
  } else {
    logger.warn(`No Task Scheduler entry found for ${cwd}`);
    logger.info('Use "aidev schedule set" to configure one.');
  }
}

function scheduleRemoveWindows(): void {
  const cwd = process.cwd();
  const taskName = windowsTaskName(cwd);

  const result = spawnSync('schtasks', ['/delete', '/f', '/tn', taskName], { encoding: 'utf8' });
  if (result.status === 0) {
    logger.success(`Removed Task Scheduler entry: ${taskName}`);
  } else {
    logger.error(`Failed to remove task:\n${result.stderr}`);
    process.exit(1);
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function scheduleSetCommand(cronExpr?: string): Promise<void> {
  if (!cronExpr) cronExpr = await pickCron();
  isWindows ? scheduleSetWindows(cronExpr) : scheduleSetUnix(cronExpr);
}

export async function scheduleGetCommand(): Promise<void> {
  isWindows ? scheduleGetWindows() : scheduleGetUnix();
}

export async function scheduleRemoveCommand(id?: number): Promise<void> {
  if (isWindows) {
    scheduleRemoveWindows();
  } else {
    await scheduleRemoveUnix(id);
  }
}

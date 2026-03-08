import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
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

export function buildUnixCronLine(cronExpr: string, cwd: string, nodeBin: string, aidevBin: string): string {
  const marker = `${UNIX_MARKER_PREFIX}${cwd}`;
  return `${cronExpr} zsh -i -l -c 'cd ${cwd} && ${nodeBin} ${aidevBin} run' ${marker}`;
}

function scheduleSetUnix(cronExpr: string): void {
  const cwd = process.cwd();
  const aidevBin = getAidevBin();
  const nodeBin = findBin('node') ?? 'node';
  const newLine = buildUnixCronLine(cronExpr, cwd, nodeBin, aidevBin);

  const lines = getCrontab().split('\n').filter((l) => l !== newLine);
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

// ─── macOS (launchd) ─────────────────────────────────────────────────────────
//
// On macOS, LaunchAgents (unlike cron) run inside the user's GUI session and
// have access to the login Keychain. This lets claude / cursor / windsurf read
// their OAuth tokens, which they store in the Keychain via Electron safeStorage.

const DARWIN_LABEL_PREFIX = 'com.aidev.run.';

function launchdLabel(cwd: string): string {
  // djb2 hash — stable, unique label per project directory
  let h = 5381;
  for (let i = 0; i < cwd.length; i++) {
    h = (((h << 5) + h) ^ cwd.charCodeAt(i)) >>> 0;
  }
  return `${DARWIN_LABEL_PREFIX}${h.toString(16)}`;
}

function getLaunchAgentsDir(): string {
  return path.join(os.homedir(), 'Library', 'LaunchAgents');
}

function xmlEscape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export type LaunchdSchedule =
  | { key: 'StartInterval'; seconds: number }
  | { key: 'StartCalendarInterval'; hour: number; minute: number };

/**
 * Maps a cron expression to a launchd schedule.
 * Supports the same subset as cronToSchtasksArgs.
 */
export function cronToLaunchdSchedule(cron: string): LaunchdSchedule | null {
  // */N * * * * → every N minutes
  const everyMin = cron.match(/^\*\/(\d+) \* \* \* \*$/);
  if (everyMin) return { key: 'StartInterval', seconds: parseInt(everyMin[1], 10) * 60 };

  // 0 * * * * → every hour
  if (cron === '0 * * * *') return { key: 'StartInterval', seconds: 3600 };

  // 0 */H * * * → every H hours
  const everyHr = cron.match(/^0 \*\/(\d+) \* \* \*$/);
  if (everyHr) return { key: 'StartInterval', seconds: parseInt(everyHr[1], 10) * 3600 };

  // 0 H * * * → daily at H:00
  const daily = cron.match(/^0 (\d+) \* \* \*$/);
  if (daily) return { key: 'StartCalendarInterval', hour: parseInt(daily[1], 10), minute: 0 };

  return null;
}

export function buildLaunchAgentPlist(
  label: string,
  nodeBin: string,
  aidevBin: string,
  cwd: string,
  schedule: LaunchdSchedule,
): string {
  // Capture PATH at scheduling time (from the developer's live terminal session).
  // This ensures the right node/claude/cursor/windsurf binaries are found when
  // the agent fires later.
  const envPath = process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin';
  const home = process.env.HOME ?? os.homedir();

  const scheduleXml =
    schedule.key === 'StartInterval'
      ? `\t<key>StartInterval</key>\n\t<integer>${schedule.seconds}</integer>`
      : [
          '\t<key>StartCalendarInterval</key>',
          '\t<dict>',
          '\t\t<key>Hour</key>',
          `\t\t<integer>${schedule.hour}</integer>`,
          '\t\t<key>Minute</key>',
          `\t\t<integer>${schedule.minute}</integer>`,
          '\t</dict>',
        ].join('\n');

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    '<dict>',
    '\t<key>Label</key>',
    `\t<string>${xmlEscape(label)}</string>`,
    '\t<key>ProgramArguments</key>',
    '\t<array>',
    `\t\t<string>${xmlEscape(nodeBin)}</string>`,
    `\t\t<string>${xmlEscape(aidevBin)}</string>`,
    '\t\t<string>run</string>',
    '\t</array>',
    '\t<key>WorkingDirectory</key>',
    `\t<string>${xmlEscape(cwd)}</string>`,
    scheduleXml,
    '\t<key>EnvironmentVariables</key>',
    '\t<dict>',
    '\t\t<key>PATH</key>',
    `\t\t<string>${xmlEscape(envPath)}</string>`,
    '\t\t<key>HOME</key>',
    `\t\t<string>${xmlEscape(home)}</string>`,
    '\t</dict>',
    '\t<key>RunAtLoad</key>',
    '\t<false/>',
    '</dict>',
    '</plist>',
    '',
  ].join('\n');
}

function scheduleSetDarwin(cronExpr: string): void {
  const schedule = cronToLaunchdSchedule(cronExpr);
  if (!schedule) {
    logger.error(
      `Cron expression "${cronExpr}" cannot be mapped to a launchd schedule.\n` +
        '  Use "aidev schedule set" (no argument) to choose a supported preset.',
    );
    process.exit(1);
  }

  const cwd = process.cwd();
  const label = launchdLabel(cwd);
  const aidevBin = getAidevBin();
  const nodeBin = findBin('node') ?? 'node';
  const launchAgentsDir = getLaunchAgentsDir();
  const plistPath = path.join(launchAgentsDir, `${label}.plist`);
  const plist = buildLaunchAgentPlist(label, nodeBin, aidevBin, cwd, schedule);

  try {
    fs.mkdirSync(launchAgentsDir, { recursive: true });
  } catch { /* already exists */ }

  // Unload any existing version first (ignore errors — it may not be loaded)
  if (fs.existsSync(plistPath)) {
    spawnSync('launchctl', ['unload', '-w', plistPath], { encoding: 'utf8' });
  }

  fs.writeFileSync(plistPath, plist, 'utf8');

  const loadResult = spawnSync('launchctl', ['load', '-w', plistPath], { encoding: 'utf8' });
  if (loadResult.status !== 0) {
    logger.error(`Failed to load Launch Agent:\n${loadResult.stderr}`);
    process.exit(1);
  }

  logger.success(`Launch Agent scheduled: ${cronExpr}`);
  logger.info(`Plist: ${plistPath}`);
}

interface DarwinEntry {
  label: string;
  cwd: string;
  schedule: string;
  plistPath: string;
}

function parseDarwinEntries(): DarwinEntry[] {
  const dir = getLaunchAgentsDir();
  let files: string[];
  try {
    files = fs
      .readdirSync(dir)
      .filter((f) => f.startsWith(DARWIN_LABEL_PREFIX) && f.endsWith('.plist'))
      .map((f) => path.join(dir, f));
  } catch {
    return [];
  }

  return files.map((plistPath) => {
    const xml = fs.readFileSync(plistPath, 'utf8');

    const cwdMatch = xml.match(/<key>WorkingDirectory<\/key>\s*<string>([^<]+)<\/string>/);
    const cwd = cwdMatch ? cwdMatch[1] : '(unknown)';

    const labelMatch = xml.match(/<key>Label<\/key>\s*<string>([^<]+)<\/string>/);
    const label = labelMatch ? labelMatch[1] : path.basename(plistPath, '.plist');

    const intervalMatch = xml.match(/<key>StartInterval<\/key>\s*<integer>(\d+)<\/integer>/);
    let schedule = '(custom)';
    if (intervalMatch) {
      const secs = parseInt(intervalMatch[1], 10);
      schedule = secs % 3600 === 0 ? `every ${secs / 3600}h` : `every ${secs / 60}m`;
    } else {
      const hourMatch = xml.match(
        /<key>StartCalendarInterval<\/key>[\s\S]*?<key>Hour<\/key>\s*<integer>(\d+)<\/integer>/,
      );
      if (hourMatch) {
        schedule = `daily at ${String(parseInt(hourMatch[1], 10)).padStart(2, '0')}:00`;
      }
    }

    return { label, cwd, schedule, plistPath };
  });
}

function printDarwinEntriesTable(entries: DarwinEntry[]): void {
  const cwdW = Math.max(9, ...entries.map((e) => e.cwd.length));
  const schedW = Math.max(8, ...entries.map((e) => e.schedule.length));
  const header =
    `  ${chalk.bold('ID')}  ` +
    `${chalk.bold('Directory'.padEnd(cwdW))}  ` +
    chalk.bold('Schedule'.padEnd(schedW));
  const sep = `  ──  ${'─'.repeat(cwdW)}  ${'─'.repeat(schedW)}`;
  console.log(header);
  console.log(sep);
  entries.forEach((e, i) => {
    const id = chalk.cyan(String(i + 1).padStart(2));
    const isCurrentDir = e.cwd === process.cwd();
    const dir = isCurrentDir ? chalk.green(e.cwd.padEnd(cwdW)) : e.cwd.padEnd(cwdW);
    console.log(`  ${id}  ${dir}  ${e.schedule}`);
  });
}

function scheduleGetDarwin(): void {
  const entries = parseDarwinEntries();
  if (entries.length === 0) {
    logger.warn('No aidev schedules found');
    logger.info('Use "aidev schedule set" to configure one.');
    return;
  }
  logger.info('Scheduled aidev jobs:');
  console.log();
  printDarwinEntriesTable(entries);
  console.log();
}

async function scheduleRemoveDarwin(id?: number): Promise<void> {
  const entries = parseDarwinEntries();

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
    printDarwinEntriesTable(entries);
    console.log();
    const rl = readline.createInterface({ input, output });
    try {
      while (true) {
        const raw = await rl.question(`  Remove ID ${chalk.dim('[1]')}: `);
        const val = raw.trim() || '1';
        const n = parseInt(val, 10);
        if (n >= 1 && n <= entries.length) {
          idx = n - 1;
          break;
        }
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
  spawnSync('launchctl', ['unload', '-w', toRemove.plistPath], { encoding: 'utf8' });
  try {
    fs.unlinkSync(toRemove.plistPath);
  } catch { /* already removed */ }
  logger.success(`Removed schedule for ${toRemove.cwd}`);
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

/** Stable task name derived from cwd + optional cron expr — safe for Task Scheduler. */
export function windowsTaskName(cwd: string, cronExpr?: string): string {
  const sanitized = cwd.replace(/[:\\\/]+/g, '-').replace(/^-+|-+$/g, '');
  if (!cronExpr) return `aidev\\${sanitized}`;
  const cronTag = cronExpr.replace(/\*/g, 'x').replace(/\//g, 'e').replace(/\s+/g, '_');
  return `aidev\\${sanitized}--${cronTag}`;
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

  const taskName = windowsTaskName(cwd, cronExpr);
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

interface WindowsTaskEntry {
  taskName: string;
  nextRun: string;
  status: string;
}

const WINDOWS_TASK_PREFIX = 'aidev\\';

function listWindowsAidevTasks(): WindowsTaskEntry[] {
  const result = spawnSync('schtasks', ['/query', '/fo', 'CSV', '/nh'], { encoding: 'utf8' });
  if (result.status !== 0) return [];
  return result.stdout
    .split(/\r?\n/)
    .filter((line) => line.includes(`"\\${WINDOWS_TASK_PREFIX}`))
    .map((line) => {
      const cols = line.match(/"([^"]*)"/g)?.map((s) => s.replace(/"/g, ''));
      if (!cols || cols.length < 3) return null;
      return { taskName: cols[0].replace(/^\\/, ''), nextRun: cols[1], status: cols[2] };
    })
    .filter((x): x is WindowsTaskEntry => x !== null);
}

function printWindowsEntriesTable(entries: WindowsTaskEntry[]): void {
  const nameW = Math.max(4, ...entries.map((e) => e.taskName.length));
  const nextW = Math.max(8, ...entries.map((e) => e.nextRun.length));
  const header =
    `  ${chalk.bold('ID')}  ` +
    `${chalk.bold('Task'.padEnd(nameW))}  ` +
    chalk.bold('Next Run'.padEnd(nextW));
  const sep = `  ──  ` + `${'─'.repeat(nameW)}  ` + '─'.repeat(nextW);
  console.log(header);
  console.log(sep);
  entries.forEach((e, i) => {
    const id = chalk.cyan(String(i + 1).padStart(2));
    console.log(`  ${id}  ${e.taskName.padEnd(nameW)}  ${e.nextRun}`);
  });
}

function scheduleGetWindows(): void {
  const entries = listWindowsAidevTasks();
  if (entries.length === 0) {
    logger.warn('No aidev schedules found');
    logger.info('Use "aidev schedule set" to configure one.');
    return;
  }
  logger.info('Scheduled aidev jobs:');
  console.log();
  printWindowsEntriesTable(entries);
  console.log();
}

async function scheduleRemoveWindows(id?: number): Promise<void> {
  const entries = listWindowsAidevTasks();

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
    printWindowsEntriesTable(entries);
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
  const result = spawnSync('schtasks', ['/delete', '/f', '/tn', toRemove.taskName], {
    encoding: 'utf8',
  });
  if (result.status === 0) {
    logger.success(`Removed Task Scheduler entry: ${toRemove.taskName}`);
  } else {
    logger.error(`Failed to remove task:\n${result.stderr}`);
    process.exit(1);
  }
}

// ─── schedule fix ─────────────────────────────────────────────────────────────

/** Extracts the launchd schedule object from a plist XML string. */
export function extractLaunchdSchedule(xml: string): LaunchdSchedule | null {
  const intervalMatch = xml.match(/<key>StartInterval<\/key>\s*<integer>(\d+)<\/integer>/);
  if (intervalMatch) return { key: 'StartInterval', seconds: parseInt(intervalMatch[1], 10) };

  const hourMatch = xml.match(/<key>Hour<\/key>\s*<integer>(\d+)<\/integer>/);
  const minMatch = xml.match(/<key>Minute<\/key>\s*<integer>(\d+)<\/integer>/);
  if (hourMatch && minMatch) {
    return {
      key: 'StartCalendarInterval',
      hour: parseInt(hourMatch[1], 10),
      minute: parseInt(minMatch[1], 10),
    };
  }
  return null;
}

function scheduleFixDarwin(): void {
  const entries = parseDarwinEntries();
  if (entries.length === 0) {
    logger.warn('No aidev schedules found');
    return;
  }

  const aidevBin = getAidevBin();
  const nodeBin = findBin('node') ?? 'node';
  let fixed = 0;

  for (const entry of entries) {
    const xml = fs.readFileSync(entry.plistPath, 'utf8');
    const schedule = extractLaunchdSchedule(xml);
    if (!schedule) {
      logger.warn(`${entry.cwd}: cannot parse schedule — skipping`);
      continue;
    }

    const expected = buildLaunchAgentPlist(entry.label, nodeBin, aidevBin, entry.cwd, schedule);
    if (expected === xml) {
      logger.info(`${entry.cwd}: already up to date`);
      continue;
    }

    spawnSync('launchctl', ['unload', '-w', entry.plistPath], { encoding: 'utf8' });
    fs.writeFileSync(entry.plistPath, expected, 'utf8');
    const loadResult = spawnSync('launchctl', ['load', '-w', entry.plistPath], { encoding: 'utf8' });
    if (loadResult.status !== 0) {
      logger.error(`Failed to reload ${entry.plistPath}:\n${loadResult.stderr}`);
      continue;
    }
    logger.success(`Fixed: ${entry.cwd}`);
    fixed++;
  }

  logger.info(`${fixed} fixed, ${entries.length - fixed} already up to date`);
}

function scheduleFixUnix(): void {
  const crontab = getCrontab();
  const entries = parseAidevEntries(crontab);
  if (entries.length === 0) {
    logger.warn('No aidev schedules found');
    return;
  }

  const aidevBin = getAidevBin();
  const nodeBin = findBin('node') ?? 'node';
  let lines = crontab.split('\n');
  let fixed = 0;

  for (const entry of entries) {
    const expected = buildUnixCronLine(entry.cron, entry.cwd, nodeBin, aidevBin);
    if (entry.line === expected) {
      logger.info(`${entry.cwd}: already up to date`);
      continue;
    }
    lines = lines.map((l) => (l === entry.line ? expected : l));
    logger.success(`Fixed: ${entry.cwd}`);
    fixed++;
  }

  if (fixed > 0) {
    const updated = lines.join('\n').replace(/\n+$/, '') + '\n';
    if (!setCrontab(updated)) {
      logger.error('Failed to update crontab');
      process.exit(1);
    }
  }

  logger.info(`${fixed} fixed, ${entries.length - fixed} already up to date`);
}

function scheduleFixWindows(): void {
  logger.warn('schedule fix is not supported on Windows — re-run "aidev schedule set" for each project.');
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function scheduleSetCommand(cronExpr?: string): Promise<void> {
  if (!cronExpr) cronExpr = await pickCron();
  if (isWindows) scheduleSetWindows(cronExpr);
  else if (process.platform === 'darwin') scheduleSetDarwin(cronExpr);
  else scheduleSetUnix(cronExpr);
}

export async function scheduleGetCommand(): Promise<void> {
  if (isWindows) scheduleGetWindows();
  else if (process.platform === 'darwin') scheduleGetDarwin();
  else scheduleGetUnix();
}

export async function scheduleRemoveCommand(id?: number): Promise<void> {
  if (isWindows) await scheduleRemoveWindows(id);
  else if (process.platform === 'darwin') await scheduleRemoveDarwin(id);
  else await scheduleRemoveUnix(id);
}

export function scheduleFixCommand(): void {
  if (isWindows) scheduleFixWindows();
  else if (process.platform === 'darwin') scheduleFixDarwin();
  else scheduleFixUnix();
}

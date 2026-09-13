import chalk from 'chalk';

export type OutputFormat = 'table' | 'json' | 'csv';

export interface OutputColumn<T> {
  key: string;
  value: (row: T) => string;
}

const VALID_FORMATS: OutputFormat[] = ['table', 'json', 'csv'];

export function parseOutputFormat(raw: string | undefined): OutputFormat {
  if (raw === undefined) return 'table';
  if ((VALID_FORMATS as string[]).includes(raw)) return raw as OutputFormat;
  throw new Error(`Invalid output format: "${raw}". Valid values: ${VALID_FORMATS.join(', ')}`);
}

function printTable<T>(rows: T[], columns: OutputColumn<T>[]): void {
  const widths = columns.map((c) =>
    Math.max(c.key.length, ...rows.map((r) => c.value(r).length)),
  );

  const header = `  ${columns
    .map((c, i) => chalk.bold(c.key.padEnd(widths[i])))
    .join('  ')}`;
  const sep = `  ${widths.map((w) => '─'.repeat(w)).join('  ')}`;

  console.log(header);
  console.log(sep);

  rows.forEach((row) => {
    const line = columns.map((c, i) => c.value(row).padEnd(widths[i])).join('  ');
    console.log(`  ${line}`);
  });
}

function printJson<T>(rows: T[], columns: OutputColumn<T>[]): void {
  const data = rows.map((row) => Object.fromEntries(columns.map((c) => [c.key, c.value(row)])));
  console.log(JSON.stringify(data, null, 2));
}

function csvField(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function printCsv<T>(rows: T[], columns: OutputColumn<T>[]): void {
  console.log(columns.map((c) => csvField(c.key)).join(','));
  rows.forEach((row) => {
    console.log(columns.map((c) => csvField(c.value(row))).join(','));
  });
}

export function printRows<T>(rows: T[], columns: OutputColumn<T>[], format: OutputFormat): void {
  if (format === 'json') return printJson(rows, columns);
  if (format === 'csv') return printCsv(rows, columns);
  return printTable(rows, columns);
}

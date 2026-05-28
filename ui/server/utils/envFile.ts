import * as fs from 'node:fs';
import * as path from 'node:path';
import * as dotenv from 'dotenv';

const FILE_NAME = '.env.aidev';

export interface EnvFileResult {
  path: string;
  exists: boolean;
  values: Record<string, string>;
  // Keys in the order they appear in the file. Used by the UI so newly-added
  // keys land at the bottom of the form, matching how they sit in the file.
  keys: string[];
}

export function envFilePath(cwd: string): string {
  return path.join(cwd, FILE_NAME);
}

export function readEnvFile(cwd: string): EnvFileResult {
  const file = envFilePath(cwd);
  if (!fs.existsSync(file)) {
    return { path: file, exists: false, values: {}, keys: [] };
  }
  const raw = fs.readFileSync(file, 'utf8');
  const values = dotenv.parse(raw);
  const keys: string[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/);
    const key = m?.[1];
    if (key && !keys.includes(key)) keys.push(key);
  }
  return { path: file, exists: true, values, keys };
}

// Mirrors the quoting rule used by src/commands/init.ts so writes from the UI
// match the format `aidev init` emits.
export function escapeEnvValue(val: string): string {
  return /[\s#"']/.test(val) ? `"${val.replace(/"/g, '\\"')}"` : val;
}

/**
 * Rewrite `.env.aidev` so its keys reflect `kv`.
 *
 * Strategy: walk the existing file line-by-line. For each `KEY=` line, replace
 * the value when `KEY` is present in `kv` (preserving the line's position) and
 * drop the line when it isn't. Comment and blank lines are kept verbatim so
 * section dividers/explanations survive a round trip. Keys present in `kv` but
 * not seen in the file are appended after a blank separator.
 *
 * Callers are expected to submit the full intended state — anything omitted
 * from `kv` is treated as a deletion.
 */
export function writeEnvFile(cwd: string, kv: Record<string, string>): { path: string; written: number } {
  const file = envFilePath(cwd);
  const raw = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  const lines = raw === '' ? [] : raw.split(/\r?\n/);
  const seen = new Set<string>();
  const out: string[] = [];

  for (const line of lines) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/);
    if (!m) {
      out.push(line);
      continue;
    }
    const key = m[1];
    if (!key) continue;
    if (Object.prototype.hasOwnProperty.call(kv, key)) {
      const val = kv[key] ?? '';
      out.push(`${key}=${escapeEnvValue(val)}`);
      seen.add(key);
    }
    // else: key was removed from the posted kv — drop the existing line.
  }

  const newKeys = Object.keys(kv).filter((k) => !seen.has(k));
  if (newKeys.length > 0) {
    if (out.length > 0 && out[out.length - 1] !== '') out.push('');
    for (const k of newKeys) {
      out.push(`${k}=${escapeEnvValue(kv[k] ?? '')}`);
    }
  }

  let content = out.join('\n');
  if (!content.endsWith('\n')) content += '\n';

  fs.writeFileSync(file, content, 'utf8');
  return { path: file, written: Object.keys(kv).length };
}

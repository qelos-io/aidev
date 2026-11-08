import * as fs from 'node:fs';
import * as path from 'node:path';
import type { AIExtraContext } from './base';

const RULE_FILE_EXTENSIONS = new Set(['.md', '.mdc', '.txt']);
const MAX_RULE_FILES = 50;

function isDir(p: string | undefined): p is string {
  if (!p) return false;
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Directories an agent CLI should be granted access to (deduplicated, existing
 * only). The root normally contains the skills/rules/agents dirs, but a layout
 * may point outside it, so each one is listed.
 */
export function getExtraContextDirs(ctx: AIExtraContext | undefined): string[] {
  if (!ctx) return [];
  const dirs = [ctx.rootDir, ctx.skillsDir, ctx.rulesDir, ctx.agentsDir]
    .filter(isDir)
    .map((d) => path.resolve(d));
  return Array.from(new Set(dirs));
}

/** Prompt text telling the agent where the external, read-only skills/rules live. */
export function buildSkillsHint(ctx: AIExtraContext | undefined): string {
  if (!ctx) return '';
  const lines: string[] = [];
  if (ctx.skillsDir) lines.push(`- Skills: ${ctx.skillsDir} (each skill is a folder with a SKILL.md)`);
  if (ctx.rulesDir) lines.push(`- Rules: ${ctx.rulesDir}`);
  if (ctx.agentsDir) lines.push(`- Agents: ${ctx.agentsDir}`);
  if (lines.length === 0) lines.push(`- Skills/rules root: ${ctx.rootDir}`);
  return [
    'An external skills/rules library is available outside the repository (read-only).',
    ...lines,
    'Read and follow the relevant skills and rules. Never modify, copy into, or commit anything from these paths.',
  ].join('\n');
}

/** Appends the skills hint to a prompt (no-op without context). */
export function withSkillsHint(prompt: string, ctx: AIExtraContext | undefined): string {
  const hint = buildSkillsHint(ctx);
  return hint ? `${prompt}\n\n${hint}` : prompt;
}

/** Rule files (shallow-recursive, capped) suitable for aider's `--read`. */
export function listRuleFiles(ctx: AIExtraContext | undefined): string[] {
  if (!ctx || !isDir(ctx.rulesDir)) return [];
  const out: string[] = [];
  const walk = (dir: string, depth: number): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const e of entries) {
      if (out.length >= MAX_RULE_FILES) return;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (depth < 3 && !e.name.startsWith('.')) walk(full, depth + 1);
      } else if (e.isFile() && RULE_FILE_EXTENSIONS.has(path.extname(e.name).toLowerCase())) {
        out.push(path.resolve(full));
      }
    }
  };
  walk(ctx.rulesDir, 0);
  return out;
}

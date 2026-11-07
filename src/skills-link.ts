import * as fs from 'node:fs';
import * as path from 'node:path';
import { AIDEV_SKILLS_LINK_NAME, ensureLocalExclude } from './git';
import { logger } from './logger';
import type { ResolvedSkillsSource } from './skills-source';

/** Which part of the skills source a link points at. */
export type SkillsLinkKind = 'skills' | 'rules' | 'agents' | 'root';

export interface SkillsLinkTarget {
  /** Repo-relative parent dir in which `aidev-skills` is created (posix separators). */
  parentDir: string;
  kind: SkillsLinkKind;
}

/** Generic locations every fallback runner may read. */
export const DEFAULT_LINK_TARGETS: SkillsLinkTarget[] = [
  { parentDir: '.agents/skills', kind: 'skills' },
  { parentDir: '.agents/rules', kind: 'rules' },
];

/** Runner-specific extra locations. */
export const CLAUDE_LINK_TARGETS: SkillsLinkTarget[] = [{ parentDir: '.claude/skills', kind: 'skills' }];
export const CURSOR_LINK_TARGETS: SkillsLinkTarget[] = [{ parentDir: '.cursor/rules', kind: 'rules' }];

export interface CreatedLink {
  /** Absolute path of the link. */
  linkPath: string;
  /** Absolute path the link points to. */
  target: string;
}

export interface SkillsLinks {
  repoDir: string;
  links: CreatedLink[];
  /** Absolute paths of directories aidev created to hold links (removed if left empty). */
  createdDirs: string[];
}

const activeLinkSets = new Set<SkillsLinks>();

function resolveKindDir(source: ResolvedSkillsSource, kind: SkillsLinkKind): string | undefined {
  switch (kind) {
    case 'skills':
      return source.skillsDir;
    case 'rules':
      return source.rulesDir;
    case 'agents':
      return source.agentsDir;
    case 'root':
      return source.rootDir;
  }
}

function lstatOrNull(p: string): fs.Stats | null {
  try {
    return fs.lstatSync(p);
  } catch {
    return null;
  }
}

function sameTarget(linkPath: string, target: string): boolean {
  try {
    const current = path.resolve(path.dirname(linkPath), fs.readlinkSync(linkPath));
    const norm = (p: string) => (process.platform === 'win32' ? p.toLowerCase() : p);
    return norm(path.resolve(current)) === norm(path.resolve(target));
  } catch {
    return false;
  }
}

/** mkdir -p that reports which directories were newly created. */
function mkdirTracked(dir: string, created: string[]): void {
  const missing: string[] = [];
  let cur = dir;
  while (!fs.existsSync(cur)) {
    missing.push(cur);
    const parent = path.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  fs.mkdirSync(dir, { recursive: true });
  // Outermost first, so cleanup can walk them in reverse.
  for (const m of missing.reverse()) created.push(m);
}

function removeLink(linkPath: string): void {
  try {
    fs.unlinkSync(linkPath);
  } catch (err) {
    // Windows junctions can refuse unlink; rmdir removes the junction only.
    try {
      fs.rmdirSync(linkPath);
    } catch {
      throw err;
    }
  }
}

/**
 * Creates `<repoDir>/<parentDir>/aidev-skills` links (junction on Windows) to the
 * skills source. Never overwrites real files/dirs or foreign links. Returns the
 * links actually created (or adopted: same-target leftovers from a crashed run),
 * which `unlinkSkills` removes.
 */
export function linkSkills(
  repoDir: string,
  source: ResolvedSkillsSource,
  targets: SkillsLinkTarget[] = DEFAULT_LINK_TARGETS,
): SkillsLinks {
  const set: SkillsLinks = { repoDir, links: [], createdDirs: [] };
  const seen = new Set<string>();

  for (const t of targets) {
    const targetDir = resolveKindDir(source, t.kind);
    if (!targetDir) continue;
    const absTarget = path.resolve(targetDir);
    const parentAbs = path.resolve(repoDir, ...t.parentDir.split('/'));
    const linkPath = path.join(parentAbs, AIDEV_SKILLS_LINK_NAME);
    if (seen.has(linkPath)) continue;
    seen.add(linkPath);

    const existing = lstatOrNull(linkPath);
    if (existing) {
      if (existing.isSymbolicLink() && sameTarget(linkPath, absTarget)) {
        set.links.push({ linkPath, target: absTarget });
      } else {
        logger.warn(`Not linking skills at ${linkPath}: path already exists and was not created by aidev.`);
      }
      continue;
    }

    try {
      mkdirTracked(parentAbs, set.createdDirs);
      fs.symlinkSync(absTarget, linkPath, process.platform === 'win32' ? 'junction' : 'dir');
      set.links.push({ linkPath, target: absTarget });
    } catch (err) {
      logger.warn(`Could not link skills at ${linkPath}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (set.links.length > 0) {
    ensureLocalExclude(repoDir);
    activeLinkSets.add(set);
  }
  return set;
}

/**
 * Removes only the links recorded in `set` (and only if they still point at the
 * recorded target), then removes directories aidev created if they are empty.
 */
export function unlinkSkills(set: SkillsLinks | null | undefined): void {
  if (!set) return;
  for (const link of set.links) {
    const st = lstatOrNull(link.linkPath);
    if (!st) continue;
    if (!st.isSymbolicLink() || !sameTarget(link.linkPath, link.target)) {
      logger.warn(`Leaving ${link.linkPath} in place: it is no longer the link aidev created.`);
      continue;
    }
    try {
      removeLink(link.linkPath);
    } catch (err) {
      logger.warn(`Could not remove link ${link.linkPath}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  for (const dir of [...set.createdDirs].reverse()) {
    try {
      fs.rmdirSync(dir); // fails (ignored) if not empty
    } catch {
      /* not empty or already gone */
    }
  }
  set.links = [];
  set.createdDirs = [];
  activeLinkSets.delete(set);
}

/** Removes every link set still active; safe to call from signal/exit handlers. */
export function unlinkAllSkills(): void {
  for (const set of [...activeLinkSets]) unlinkSkills(set);
}

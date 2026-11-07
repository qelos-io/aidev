import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { Config } from './types';
import { logger } from './logger';
import {
  cloneRepo,
  fetchBranchIn,
  checkoutBranchForce,
  resetHardTo,
  remoteHasBranch,
  remoteDefaultBranch,
} from './git';

export interface ResolvedSkillsSource {
  /** Root of the skills source (already includes `skillsSubdir`). */
  rootDir: string;
  skillsDir?: string;
  rulesDir?: string;
  agentsDir?: string;
  /** True when the source is an aidev-owned git cache clone. */
  isGit: boolean;
}

const REMOTE = 'origin';
const LOCK_STALE_MS = 10 * 60 * 1000;
const LOCK_WAIT_MS = 120 * 1000;

const SKILLS_DIR_CANDIDATES = ['skills', '.agents/skills', '.claude/skills'];
const RULES_DIR_CANDIDATES = ['rules', '.agents/rules', '.cursor/rules'];
const AGENTS_DIR_CANDIDATES = ['agents', '.agents/agents', '.claude/agents'];

/** True for `https://`, `http://`, `ssh://`, `git://`, `git@host:path`, or anything ending in `.git`. */
export function isGitUrl(source: string): boolean {
  const s = source.trim();
  if (!s || s.startsWith('-')) return false;
  if (/^(https?|ssh|git|file):\/\//i.test(s)) return true;
  if (/^[\w.-]+@[\w.-]+:/.test(s)) return true;
  return /\.git\/?$/i.test(s);
}

export function skillsCacheRoot(): string {
  return path.join(os.homedir(), '.aidev', 'skills-cache');
}

export function skillsCacheDirFor(url: string, cacheRoot: string = skillsCacheRoot()): string {
  const hash = crypto.createHash('sha256').update(url.trim()).digest('hex').slice(0, 16);
  return path.join(cacheRoot, hash);
}

function isDir(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function firstDir(base: string, candidates: string[]): string | undefined {
  for (const c of candidates) {
    const full = path.join(base, ...c.split('/'));
    if (isDir(full)) return full;
  }
  return undefined;
}

function hasSkillFiles(dir: string): boolean {
  try {
    if (fs.existsSync(path.join(dir, 'SKILL.md'))) return true;
    return fs.readdirSync(dir, { withFileTypes: true }).some(
      (e) => e.isDirectory() && !e.name.startsWith('.') && fs.existsSync(path.join(dir, e.name, 'SKILL.md')),
    );
  } catch {
    return false;
  }
}

/** Detects which of skills/rules/agents folders exist under `rootDir`. */
export function detectLayout(rootDir: string): Omit<ResolvedSkillsSource, 'isGit'> {
  let skillsDir = firstDir(rootDir, SKILLS_DIR_CANDIDATES);
  const rulesDir = firstDir(rootDir, RULES_DIR_CANDIDATES);
  const agentsDir = firstDir(rootDir, AGENTS_DIR_CANDIDATES);
  // Flat folder: SKILL.md files directly inside the root.
  if (!skillsDir && hasSkillFiles(rootDir)) skillsDir = rootDir;
  return { rootDir, skillsDir, rulesDir, agentsDir };
}

// ─── read-only handling ──────────────────────────────────────────────────────

function walkFiles(dir: string, visit: (file: string) => void): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (e.name === '.git') continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walkFiles(full, visit);
    else if (e.isFile()) visit(full);
  }
}

function chmodTree(dir: string, mode: number): void {
  walkFiles(dir, (f) => {
    try {
      fs.chmodSync(f, mode);
    } catch {
      /* best-effort */
    }
  });
}

/** Makes cache files writable so git can update them. Best-effort. */
export function makeCacheWritable(dir: string): void {
  chmodTree(dir, 0o644);
}

/** Marks cache files read-only (a-w; read-only attribute on Windows). Best-effort. */
export function makeCacheReadOnly(dir: string): void {
  chmodTree(dir, 0o444);
}

// ─── lock ────────────────────────────────────────────────────────────────────

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function acquireCacheLock(lockPath: string): () => void {
  const deadline = Date.now() + LOCK_WAIT_MS;
  for (;;) {
    try {
      const fd = fs.openSync(lockPath, 'wx');
      fs.writeSync(fd, String(process.pid));
      fs.closeSync(fd);
      return () => {
        try {
          fs.unlinkSync(lockPath);
        } catch {
          /* already gone */
        }
      };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
    }
    // Break stale locks (dead owner or very old).
    try {
      const pid = parseInt(fs.readFileSync(lockPath, 'utf8').trim(), 10);
      const age = Date.now() - fs.statSync(lockPath).mtimeMs;
      if ((!isNaN(pid) && !pidAlive(pid)) || age > LOCK_STALE_MS) {
        fs.unlinkSync(lockPath);
        continue;
      }
    } catch {
      continue; // lock vanished between checks — retry
    }
    if (Date.now() > deadline) {
      throw new Error(`Timed out waiting for another aidev process to finish updating the skills cache (${lockPath})`);
    }
    sleepSync(200);
  }
}

// ─── git cache ───────────────────────────────────────────────────────────────

/** Picks the branch to track: configured → master → remote HEAD. Null if the remote is unreachable. */
function pickBranch(dir: string, wanted: string): string | null | undefined {
  const candidates = [wanted];
  if (wanted === 'main') candidates.push('master');
  for (const b of candidates) {
    const r = remoteHasBranch(dir, REMOTE, b);
    if (!r.ok) return null; // unreachable
    if (r.exists) return b;
  }
  return remoteDefaultBranch(dir, REMOTE) ?? undefined;
}

function updateCache(url: string, dir: string, wantedBranch: string): void {
  const exists = isDir(path.join(dir, '.git'));
  if (!exists) {
    fs.mkdirSync(path.dirname(dir), { recursive: true });
    fs.rmSync(dir, { recursive: true, force: true }); // partial earlier clone
    const clone = cloneRepo(url, dir);
    if (!clone.ok) {
      fs.rmSync(dir, { recursive: true, force: true });
      throw new Error(
        `Cannot access skills repository "${url}": ${clone.stderr || 'git clone failed'}. ` +
        'Check AIDEV_SKILLS_SOURCE and your git credentials.',
      );
    }
  } else {
    makeCacheWritable(dir);
  }

  try {
    const branch = pickBranch(dir, wantedBranch);
    if (branch === null) {
      if (!exists) throw new Error('unreachable'); // just cloned; should not happen
      logger.warn(`Skills repository "${url}" is unreachable — using the existing cache (may be stale)`);
      return;
    }
    if (branch === undefined) {
      throw new Error(`Branch "${wantedBranch}" not found in skills repository "${url}" and its default branch could not be determined`);
    }
    if (branch !== wantedBranch) {
      logger.warn(`Skills branch "${wantedBranch}" not found in "${url}" — using "${branch}"`);
    }

    const fetched = fetchBranchIn(dir, REMOTE, branch);
    if (!fetched.ok) {
      if (!exists) throw new Error(`git fetch failed: ${fetched.stderr}`);
      logger.warn(`Could not update skills cache (${fetched.stderr}) — using the existing cache (may be stale)`);
      return;
    }
    const ref = `${REMOTE}/${branch}`;
    const checkout = checkoutBranchForce(dir, branch, ref);
    if (!checkout.ok) throw new Error(`git checkout ${branch} failed in skills cache: ${checkout.stderr}`);
    const reset = resetHardTo(dir, ref);
    if (!reset.ok) throw new Error(`git reset --hard ${ref} failed in skills cache: ${reset.stderr}`);
  } finally {
    makeCacheReadOnly(dir);
  }
}

/**
 * Resolves the configured skills source into concrete directories, or null
 * when none is configured. Git sources are kept in a user-level cache clone
 * and forced to the latest remote branch on every call. Throws with a clear
 * message when the source is unusable.
 */
export function resolveSkillsSource(
  config: Pick<Config, 'skillsSource' | 'skillsBranch' | 'skillsSubdir'>,
  opts: { cacheRoot?: string } = {},
): ResolvedSkillsSource | null {
  const source = (config.skillsSource || '').trim();
  if (!source) return null;

  let baseDir: string;
  const isGit = isGitUrl(source);

  if (isGit) {
    const cacheDir = skillsCacheDirFor(source, opts.cacheRoot);
    fs.mkdirSync(path.dirname(cacheDir), { recursive: true });
    const release = acquireCacheLock(`${cacheDir}.lock`);
    try {
      updateCache(source, cacheDir, (config.skillsBranch || '').trim() || 'main');
    } finally {
      release();
    }
    baseDir = cacheDir;
  } else {
    const expanded = source === '~' || source.startsWith('~/') || source.startsWith('~\\')
      ? path.join(os.homedir(), source.slice(1))
      : source;
    baseDir = path.resolve(expanded);
    if (!fs.existsSync(baseDir)) {
      throw new Error(`Skills source "${source}" does not exist (resolved to ${baseDir})`);
    }
    if (!isDir(baseDir)) {
      throw new Error(`Skills source "${source}" is not a directory`);
    }
  }

  const subdir = (config.skillsSubdir || '').trim();
  const rootDir = subdir ? path.resolve(baseDir, subdir) : baseDir;
  const rel = path.relative(baseDir, rootDir);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`AIDEV_SKILLS_SUBDIR "${subdir}" must stay inside the skills source`);
  }
  if (!isDir(rootDir)) {
    throw new Error(`AIDEV_SKILLS_SUBDIR "${subdir}" does not exist in the skills source`);
  }

  const layout = detectLayout(rootDir);
  if (!layout.skillsDir && !layout.rulesDir && !layout.agentsDir) {
    logger.warn(`Skills source ${rootDir} has no skills/, rules/ or SKILL.md files — exposing it as-is`);
  }
  return { ...layout, isGit };
}

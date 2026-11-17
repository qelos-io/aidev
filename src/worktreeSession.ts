import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { AIRunner } from './ai/base';
import * as git from './git';
import { logger } from './logger';

/** Worktrees created by this process that have not been released yet (repo root → paths). */
const activeWorktrees = new Map<string, string>();

export function trackWorktree(workDir: string, repoRoot: string): void {
  activeWorktrees.set(workDir, repoRoot);
}

export function trackedWorktrees(): string[] {
  return [...activeWorktrees.keys()];
}

/**
 * Wraps runners so every `run` executes in `cwd` (explicit caller values win).
 * Used to point the agents at a task's git worktree.
 */
export function withCwd(runners: AIRunner[], cwd: string): AIRunner[] {
  return runners.map((runner) => ({
    name: runner.name,
    supportsSessions: runner.supportsSessions,
    supportsExternalContext: runner.supportsExternalContext,
    isAvailable: () => runner.isAvailable(),
    run: (prompt, notes, options) => runner.run(prompt, notes, { ...options, cwd: options?.cwd ?? cwd }),
  }));
}

/**
 * Task assets stay in the main repo (`.aidev/assets/` is git-ignored, so a worktree has no copy).
 * Rewrites the repo-relative `.aidev/assets/` references in a prompt to absolute paths so an
 * agent running in the worktree can still reach them.
 */
export function absolutizeAssetPaths(prompt: string, repoRoot: string): string {
  const abs = join(repoRoot, '.aidev', 'assets').split('\\').join('/') + '/';
  return prompt.split('.aidev/assets/').join(abs);
}

/**
 * Removes a task worktree (the branch is kept). A worktree that still has uncommitted
 * changes is left in place so no work is lost; the weekly cleanup deals with it later.
 * Idempotent and never throws. Returns true when the worktree is gone.
 */
export function releaseWorktree(workDir: string, repoRoot: string): boolean {
  try {
    if (!existsSync(workDir)) {
      activeWorktrees.delete(workDir);
      git.pruneWorktrees(repoRoot);
      return true;
    }
    if (git.hasChanges(workDir)) {
      logger.warn(`Keeping worktree ${workDir} — it has uncommitted changes`);
      // Intentionally kept (work would be lost): stop tracking so shutdown doesn't retry.
      activeWorktrees.delete(workDir);
      return false;
    }
    const removed = git.removeWorktree(workDir, true, repoRoot);
    // Keep tracking on failure so releaseAllWorktrees can retry on shutdown.
    if (removed) activeWorktrees.delete(workDir);
    return removed;
  } catch (err) {
    logger.warn(`Could not release worktree ${workDir}: ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
}

/** Releases every worktree this process still tracks (shutdown / fatal-error path). */
export function releaseAllWorktrees(): void {
  for (const [workDir, repoRoot] of [...activeWorktrees]) {
    releaseWorktree(workDir, repoRoot);
  }
}

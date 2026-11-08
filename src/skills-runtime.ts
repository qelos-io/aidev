import type { AIRunner, AIExtraContext } from './ai/base';
import { runnersNeedingSkillsLink } from './ai';
import {
  linkSkills,
  unlinkSkills,
  DEFAULT_LINK_TARGETS,
  CLAUDE_LINK_TARGETS,
  CURSOR_LINK_TARGETS,
  type SkillsLinks,
  type SkillsLinkTarget,
} from './skills-link';
import { resolveSkillsSource, type ResolvedSkillsSource } from './skills-source';
import { logger } from './logger';
import type { Config } from './types';

export interface SkillsRuntime {
  /** Runners that pass the skills source to every invocation via `extraContext`. */
  runners: AIRunner[];
  source: ResolvedSkillsSource | null;
  /** Removes any fallback links created for this run. Idempotent. */
  cleanup: () => void;
}

export function toExtraContext(source: ResolvedSkillsSource): AIExtraContext {
  return {
    rootDir: source.rootDir,
    skillsDir: source.skillsDir,
    rulesDir: source.rulesDir,
    agentsDir: source.agentsDir,
  };
}

/** Wraps runners so every `run` receives the skills `extraContext` (explicit caller values win). */
export function withSkillsContext(runners: AIRunner[], ctx: AIExtraContext): AIRunner[] {
  return runners.map((runner) => ({
    name: runner.name,
    supportsSessions: runner.supportsSessions,
    supportsExternalContext: runner.supportsExternalContext,
    isAvailable: () => runner.isAvailable(),
    run: (prompt, notes, options) => runner.run(prompt, notes, { ...options, extraContext: options?.extraContext ?? ctx }),
  }));
}

function linkTargetsFor(runners: AIRunner[]): SkillsLinkTarget[] {
  const targets = [...DEFAULT_LINK_TARGETS];
  for (const r of runners) {
    if (r.name === 'claude') targets.push(...CLAUDE_LINK_TARGETS);
    if (r.name === 'cursor') targets.push(...CURSOR_LINK_TARGETS);
  }
  return targets;
}

/**
 * Resolves the configured skills source once (throws with a clear message when it is
 * unusable), hands it to the runners, and creates fallback symlinks only when some
 * runner cannot take the source directly. Without a configured source this is a no-op.
 * Callers own `cleanup()` (call it in `finally` and on signals).
 */
export function setupSkills(
  config: Pick<Config, 'skillsSource' | 'skillsBranch' | 'skillsSubdir'>,
  runners: AIRunner[],
  repoDir: string,
  resolve: typeof resolveSkillsSource = resolveSkillsSource,
): SkillsRuntime {
  const source = resolve(config);
  if (!source) return { runners, source: null, cleanup: () => {} };

  logger.info(`Skills source ready: ${source.rootDir}${source.isGit ? ' (git cache, read-only)' : ''}`);
  const wrapped = withSkillsContext(runners, toExtraContext(source));

  let links: SkillsLinks | null = null;
  const needLink = runnersNeedingSkillsLink(runners);
  if (needLink.length > 0) {
    logger.info(`Linking skills for runners without direct support: ${needLink.map((r) => r.name).join(', ')}`);
    links = linkSkills(repoDir, source, linkTargetsFor(runners));
  }

  return {
    runners: wrapped,
    source,
    cleanup: () => {
      const l = links;
      links = null;
      unlinkSkills(l);
    },
  };
}

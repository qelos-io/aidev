import { Config } from './types';

/** Returns true when `tag` is empty, `*`, or present in `tags` (case-insensitive). */
export function taskMatchesTag(tags: string[], tag: string): boolean {
  if (!tag || tag === '*') return true;
  const want = tag.toLowerCase();
  return tags.some((t) => t.toLowerCase() === want);
}

/** Applies a task tag/label filter across all tag-aware providers. */
export function applyTaskTagToProviderConfig(config: Config, tag: string): Config {
  return {
    ...config,
    clickupTag: tag,
    jiraLabel: tag,
    linearLabel: tag,
    trelloLabel: tag,
  };
}

export function buildNonCodeProviderConfig(config: Config): Config {
  return {
    ...applyTaskTagToProviderConfig(config, config.nonCodeTag),
    clickupTeamId: config.nonCodeClickupTeamId || config.clickupTeamId,
    jiraProject: config.nonCodeJiraProject || config.jiraProject,
    linearTeamId: config.nonCodeLinearTeamId || config.linearTeamId,
  };
}

export function buildConsultProviderConfig(config: Config): Config {
  return applyTaskTagToProviderConfig(config, config.consultTag);
}

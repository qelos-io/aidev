import { Config } from '../types';
import { getInReviewStatus, getPendingStatus } from '../taskStatus';
import { cleanAgentResponseForComment } from './shared';

export function buildCompletionComment(branch: string, prUrl: string, config: Config): string {
  const lines = [
    `${config.commentPrefix} Implementation complete!`,
    ``,
    `Branch: \`${branch}\``,
  ];

  if (prUrl) {
    lines.push(`Open PR: ${prUrl}`);
  }

  lines.push(``, `Status set to: ${getInReviewStatus(config)}`);
  return lines.join('\n');
}

export function buildNonCodeCompletionComment(config: Config, agentResponse?: string): string {
  const lines = [`${config.commentPrefix} Non-code task complete!`];

  if (agentResponse) {
    lines.push(``, `---`, ``, cleanAgentResponseForComment(agentResponse));
  }

  lines.push(``, `Status set to: ${getInReviewStatus(config)}`);
  return lines.join('\n');
}

export function buildConsultCompletionComment(config: Config, agentResponse?: string): string {
  const lines = [`${config.commentPrefix} Consultation complete — task remains pending.`];

  if (agentResponse) {
    lines.push(``, `---`, ``, cleanAgentResponseForComment(agentResponse));
  }

  lines.push(``, `Status remains: ${getPendingStatus(config)}`);
  return lines.join('\n');
}

export function buildNonCodeThinkingCompletionComment(config: Config): string {
  return [
    `${config.commentPrefix} Non-code task complete!`,
    ``,
    `All sub-tasks finished. Individual summaries were posted above.`,
    ``,
    `Status set to: ${getInReviewStatus(config)}`,
  ].join('\n');
}

export function buildReviewCompletionComment(config: Config, resolvedCount: number, repliedCount: number): string {
  const parts: string[] = [`${config.commentPrefix} Code review comments addressed!`];

  if (resolvedCount > 0) {
    parts.push(`Resolved ${resolvedCount} thread(s) with code fixes.`);
  }
  if (repliedCount > 0) {
    parts.push(`Replied to ${repliedCount} thread(s).`);
  }

  return parts.join('\n');
}

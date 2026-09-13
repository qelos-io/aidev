import { Config } from './types';

const LOGICAL_STATUSES = ['open', 'pending', 'review', 'done'] as const;
type LogicalStatus = typeof LOGICAL_STATUSES[number];

function isLogicalStatus(value: string): value is LogicalStatus {
  return (LOGICAL_STATUSES as readonly string[]).includes(value);
}

/**
 * Resolves a logical status name (open/pending/review/done) to the raw
 * provider-specific status string configured for `config.provider`.
 * Values outside the logical vocabulary (or providers with no configured
 * mapping for a given logical status) pass through unchanged.
 */
export function resolveStatus(config: Config, status: string): string {
  if (!isLogicalStatus(status)) return status;

  const provider = config.provider.toLowerCase();

  switch (status) {
    case 'open':
      switch (provider) {
        case 'clickup':
          return config.clickupOpenStatus || status;
        case 'trello':
          return config.trelloOpenStatus || status;
        default:
          return status;
      }
    case 'pending':
      switch (provider) {
        case 'clickup':
          return config.clickupPendingStatus || status;
        case 'jira':
          return config.jiraPendingStatus || status;
        case 'linear':
          return config.linearPendingStatus || status;
        case 'notion':
          return config.notionPendingStatus || status;
        case 'trello':
          return config.trelloPendingStatus || status;
        default:
          return status;
      }
    case 'review':
      switch (provider) {
        case 'clickup':
          return config.clickupInReviewStatus || status;
        case 'jira':
          return config.jiraInReviewStatus || status;
        case 'linear':
          return config.linearInReviewStatus || status;
        case 'notion':
          return config.notionInReviewStatus || status;
        case 'trello':
          return config.trelloInReviewStatus || status;
        default:
          return status;
      }
    case 'done':
      return config.doneStatus || status;
    default:
      return status;
  }
}

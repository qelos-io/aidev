export interface Task {
  id: string;
  name: string;
  description: string;
  status: string;
  url: string;
  tags: string[];
  priority?: number;
}

export interface LocalTask {
  id: string;
  title: string;
  description: string;
  type: 'code' | 'non-code';
  priority?: number;
  assignee?: string;
  dueDate?: string;
  tags?: string[];
  listId?: string;
  cron?: string;
  lastPushedAt?: number;
}

export interface CreateTaskParams {
  title: string;
  description: string;
  tags: string[];
  priority?: number;
  dueDate?: number;
  listId?: string;
}

export interface CreateTaskResult {
  id: string;
  url: string;
}

export interface Comment {
  id: string;
  text: string;
  author: string;
  authorId: string;
  date: number; // epoch ms
}

export type AgentName = 'antigravity' | 'claude' | 'codex' | 'cursor' | 'windsurf';

export interface Config {
  provider: string;
  // ClickUp
  clickupApiKey: string;
  clickupTeamId: string;
  clickupTag: string;
  clickupPendingStatus: string;
  clickupOpenStatus: string;
  clickupInReviewStatus: string;
  // Jira
  jiraBaseUrl: string;
  jiraEmail: string;
  jiraApiToken: string;
  jiraProject: string;
  jiraLabel: string;
  jiraPendingStatus: string;
  jiraInReviewStatus: string;
  // Linear
  linearApiKey: string;
  linearTeamId: string;
  linearLabel: string;
  linearPendingStatus: string;
  linearInReviewStatus: string;
  // Monday
  mondayApiToken: string;
  mondayBoardId: string;
  mondayStatusColumnId: string;
  mondayGroupId: string;
  // Notion
  notionApiKey: string;
  notionDatabaseId: string;
  notionStatusProperty: string;
  notionPendingStatus: string;
  notionInReviewStatus: string;
  // Trello
  trelloApiKey: string;
  trelloToken: string;
  trelloBoardId: string;
  trelloLabel: string;
  trelloOpenList: string;
  trelloPendingList: string;
  trelloInProgressList: string;
  trelloInReviewList: string;
  trelloOpenStatus: string;
  trelloPendingStatus: string;
  trelloInReviewStatus: string;
  // Non-code tasks
  nonCodeTag: string;
  nonCodeClickupTeamId: string;
  nonCodeJiraProject: string;
  nonCodeLinearTeamId: string;
  // Shared
  clickupListId: string;
  assigneeTag: string;
  gitRemote: string;
  githubBaseBranch: string;
  githubRepo: string;
  agents: AgentName[];
  devNotesMode: 'smart' | 'always';
  triggerWord: string;
  thinkingTag: string;
  commentPrefix: string;
  hooksPath: string;
  acceptedTag: string;
  doneStatus: string;
  /** When true, summarize older ticket comments if the prompt exceeds the size budget. Opt out with AUTO_COMPRESS=0. */
  autoCompress: boolean;
  /** Character budget for full prompt+notes; used with autoCompressThreshold. */
  autoCompressMaxChars: number;
  /** Compress when measured length exceeds maxChars * threshold (default 0.8). */
  autoCompressThreshold: number;
}

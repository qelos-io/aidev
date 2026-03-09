export interface Task {
  id: string;
  name: string;
  description: string;
  status: string;
  url: string;
  tags: string[];
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

export type AgentName = 'claude' | 'cursor' | 'windsurf';

export interface Config {
  provider: string;
  // ClickUp
  clickupApiKey: string;
  clickupTeamId: string;
  clickupTag: string;
  clickupPendingStatus: string;
  clickupInReviewStatus: string;
  // Jira
  jiraBaseUrl: string;
  jiraEmail: string;
  jiraApiToken: string;
  jiraProject: string;
  jiraLabel: string;
  jiraPendingStatus: string;
  jiraInReviewStatus: string;
  // Non-code tasks
  nonCodeTag: string;
  nonCodeClickupTeamId: string;
  nonCodeJiraProject: string;
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
}

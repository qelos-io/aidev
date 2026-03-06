export interface Task {
  id: string;
  name: string;
  description: string;
  status: string;
  url: string;
  tags: string[];
}

export interface Comment {
  id: string;
  text: string;
  author: string;
  authorId: string;
  date: number; // epoch ms
}

export type AgentName = 'claude' | 'cursor';

export interface Config {
  provider: string;
  clickupApiKey: string;
  clickupTeamId: string;
  clickupTag: string;
  clickupPendingStatus: string;
  clickupInReviewStatus: string;
  assigneeTag: string;
  gitRemote: string;
  githubBaseBranch: string;
  githubRepo: string;
  agents: AgentName[];
  devNotesMode: 'smart' | 'always';
}

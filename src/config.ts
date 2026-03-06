import * as dotenv from 'dotenv';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { Config, AgentName } from './types';
import { detectRemote } from './git';

export function loadConfig(customEnvPath?: string): Config {
  const envPath = customEnvPath
    ? path.resolve(customEnvPath)
    : path.join(process.cwd(), '.env.aidev');

  if (customEnvPath && !fs.existsSync(envPath)) {
    throw new Error(`Env file not found: ${envPath}`);
  }
  if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath });
  }

  const provider = (process.env.PROVIDER || 'clickup').toLowerCase();

  const required =
    provider === 'jira'
      ? ['JIRA_BASE_URL', 'JIRA_EMAIL', 'JIRA_API_TOKEN', 'JIRA_PROJECT']
      : ['CLICKUP_API_KEY', 'CLICKUP_TEAM_ID', 'CLICKUP_TAG'];
  for (const key of required) {
    if (!process.env[key]) {
      throw new Error(`Missing required config: ${key}. Run 'aidev init' to create .env.aidev`);
    }
  }

  const validAgents: AgentName[] = ['claude', 'cursor', 'windsurf'];
  const agentsRaw = process.env.AGENTS || 'claude,cursor';
  const agents = agentsRaw
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean) as AgentName[];
  const invalid = agents.filter((a) => !validAgents.includes(a));
  if (invalid.length) {
    throw new Error(`Invalid agent(s): ${invalid.join(', ')}. Valid: ${validAgents.join(', ')}`);
  }
  if (agents.length === 0) {
    throw new Error(`AGENTS must contain at least one agent. Valid: ${validAgents.join(', ')}`);
  }

  const devNotesMode = (process.env.DEV_NOTES_MODE || 'smart') as Config['devNotesMode'];
  if (!['smart', 'always'].includes(devNotesMode)) {
    throw new Error(`Invalid DEV_NOTES_MODE: ${devNotesMode}. Must be smart or always`);
  }

  return {
    provider,
    clickupApiKey: process.env.CLICKUP_API_KEY || '',
    clickupTeamId: process.env.CLICKUP_TEAM_ID || '',
    clickupTag: process.env.CLICKUP_TAG || '',
    clickupPendingStatus: process.env.CLICKUP_PENDING_STATUS || 'pending',
    clickupInReviewStatus: process.env.CLICKUP_IN_REVIEW_STATUS || 'review',
    jiraBaseUrl: process.env.JIRA_BASE_URL || '',
    jiraEmail: process.env.JIRA_EMAIL || '',
    jiraApiToken: process.env.JIRA_API_TOKEN || '',
    jiraProject: process.env.JIRA_PROJECT || '',
    jiraLabel: process.env.JIRA_LABEL || '',
    jiraPendingStatus: process.env.JIRA_PENDING_STATUS || 'To Do',
    jiraInReviewStatus: process.env.JIRA_IN_REVIEW_STATUS || 'In Review',
    assigneeTag: process.env.ASSIGNEE_TAG || '',
    gitRemote: process.env.GIT_REMOTE || detectRemote() || 'origin',
    githubBaseBranch: process.env.GITHUB_BASE_BRANCH || 'main',
    githubRepo: process.env.GITHUB_REPO || '',
    agents,
    devNotesMode,
  };
}

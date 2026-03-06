import { Task, Comment, Config } from '../types';
import { TaskProvider } from './base';
import { logger } from '../logger';

export class JiraProvider implements TaskProvider {
  private baseUrl: string;
  private authHeader: string;
  private project: string;
  private label: string;
  private assigneeTag: string;

  constructor(config: Config) {
    this.baseUrl = config.jiraBaseUrl.replace(/\/$/, '');
    this.authHeader =
      'Basic ' + Buffer.from(`${config.jiraEmail}:${config.jiraApiToken}`).toString('base64');
    this.project = config.jiraProject;
    this.label = config.jiraLabel;
    this.assigneeTag = config.assigneeTag;
  }

  private async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const url = `${this.baseUrl}/rest/api/3${path}`;
    const res = await fetch(url, {
      ...options,
      headers: {
        Authorization: this.authHeader,
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...(options.headers || {}),
      },
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Jira API error ${res.status}: ${body}`);
    }

    return res.json() as Promise<T>;
  }

  /** Extract plain text from an Atlassian Document Format node. */
  private adfToText(node: unknown): string {
    if (!node || typeof node !== 'object') return '';
    const n = node as Record<string, unknown>;
    if (n.type === 'text' && typeof n.text === 'string') return n.text;
    if (Array.isArray(n.content)) {
      return (n.content as unknown[]).map((c) => this.adfToText(c)).join('');
    }
    return '';
  }

  async fetchTasks(): Promise<Task[]> {
    logger.debug(`Fetching Jira issues in project "${this.project}" with label "${this.label}"`);

    interface RawIssue {
      id: string;
      key: string;
      fields: {
        summary: string;
        description: unknown;
        status: { name: string };
        labels: string[];
        self: string;
      };
    }

    interface SearchResponse {
      issues: RawIssue[];
    }

    const jql = `project = "${this.project}" AND labels = "${this.label}" AND statusCategory != Done ORDER BY created DESC`;
    const fields = 'summary,description,status,labels';
    const data = await this.request<SearchResponse>(
      `/search?jql=${encodeURIComponent(jql)}&fields=${fields}&maxResults=50`
    );

    return data.issues.map((issue) => ({
      id: issue.key,
      name: issue.fields.summary,
      description: this.adfToText(issue.fields.description),
      status: issue.fields.status.name.toLowerCase(),
      url: `${this.baseUrl}/browse/${issue.key}`,
      tags: issue.fields.labels,
    }));
  }

  async postComment(taskId: string, text: string): Promise<void> {
    logger.debug(`Posting comment to Jira issue ${taskId}`);
    await this.request(`/issue/${taskId}/comment`, {
      method: 'POST',
      body: JSON.stringify({
        body: {
          type: 'doc',
          version: 1,
          content: [
            {
              type: 'paragraph',
              content: [{ type: 'text', text }],
            },
          ],
        },
      }),
    });
  }

  async getComments(taskId: string): Promise<Comment[]> {
    logger.debug(`Fetching comments for Jira issue ${taskId}`);

    interface RawComment {
      id: string;
      body: unknown;
      author: { displayName: string; accountId: string };
      created: string;
    }

    interface CommentsResponse {
      comments: RawComment[];
    }

    const data = await this.request<CommentsResponse>(`/issue/${taskId}/comment`);

    return data.comments.map((c) => ({
      id: c.id,
      text: this.adfToText(c.body),
      author: c.author.displayName,
      authorId: c.author.accountId,
      date: new Date(c.created).getTime(),
    }));
  }

  async updateStatus(taskId: string, status: string): Promise<void> {
    logger.debug(`Transitioning Jira issue ${taskId} to "${status}"`);

    interface Transition {
      id: string;
      name: string;
    }
    interface TransitionsResponse {
      transitions: Transition[];
    }

    const data = await this.request<TransitionsResponse>(`/issue/${taskId}/transitions`);
    const transition = data.transitions.find(
      (t) => t.name.toLowerCase() === status.toLowerCase()
    );

    if (!transition) {
      const names = data.transitions.map((t) => t.name).join(', ');
      throw new Error(
        `Jira transition "${status}" not found for issue ${taskId}. Available: ${names}`
      );
    }

    await this.request(`/issue/${taskId}/transitions`, {
      method: 'POST',
      body: JSON.stringify({ transition: { id: transition.id } }),
    });
  }
}

import { Task, Comment, Config } from '../types';
import { TaskProvider } from './base';
import { logger } from '../logger';

export class ClickUpProvider implements TaskProvider {
  private apiKey: string;
  private teamId: string;
  private tag: string;
  private assigneeTag: string;

  constructor(config: Config) {
    this.apiKey = config.clickupApiKey;
    this.teamId = config.clickupTeamId;
    this.tag = config.clickupTag;
    this.assigneeTag = config.assigneeTag;
  }

  private async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const url = `https://api.clickup.com/api/v2${path}`;
    const res = await fetch(url, {
      ...options,
      headers: {
        Authorization: this.apiKey,
        'Content-Type': 'application/json',
        ...(options.headers || {}),
      },
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`ClickUp API error ${res.status}: ${body}`);
    }

    return res.json() as Promise<T>;
  }

  async fetchTasks(): Promise<Task[]> {
    logger.debug(`Fetching tasks with tag "${this.tag}" from team ${this.teamId}`);

    interface RawTask {
      id: string;
      name: string;
      description?: string;
      status: { status: string };
      url: string;
      tags: Array<{ name: string }>;
    }

    interface TasksResponse {
      tasks: RawTask[];
    }

    const data = await this.request<TasksResponse>(
      `/team/${this.teamId}/task?tags[]=${encodeURIComponent(this.tag)}&subtasks=true&include_closed=false`
    );

    return data.tasks.map((t) => ({
      id: t.id,
      name: t.name,
      description: t.description || '',
      status: t.status.status.toLowerCase(),
      url: t.url,
      tags: t.tags.map((tag) => tag.name),
    }));
  }

  async postComment(taskId: string, text: string): Promise<void> {
    logger.debug(`Posting comment to task ${taskId}`);
    await this.request(`/task/${taskId}/comment`, {
      method: 'POST',
      body: JSON.stringify({ comment_text: text }),
    });
  }

  async getComments(taskId: string): Promise<Comment[]> {
    logger.debug(`Fetching comments for task ${taskId}`);

    interface RawComment {
      id: string;
      comment_text: string;
      user: { username: string; id: number };
      date: string;
    }

    interface CommentsResponse {
      comments: RawComment[];
    }

    const data = await this.request<CommentsResponse>(`/task/${taskId}/comment`);

    return data.comments.map((c) => ({
      id: c.id,
      text: c.comment_text,
      author: c.user.username,
      authorId: String(c.user.id),
      date: parseInt(c.date, 10),
    }));
  }

  async updateStatus(taskId: string, status: string): Promise<void> {
    logger.debug(`Updating task ${taskId} status to "${status}"`);
    await this.request(`/task/${taskId}`, {
      method: 'PUT',
      body: JSON.stringify({ status }),
    });
  }
}

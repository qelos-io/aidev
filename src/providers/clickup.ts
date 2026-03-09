import { Task, Comment, Config, CreateTaskParams, CreateTaskResult } from '../types';
import { TaskProvider } from './base';
import { logger } from '../logger';

export class ClickUpProvider implements TaskProvider {
  private apiKey: string;
  private teamId: string;
  private tag: string;
  private assigneeTag: string;
  private listId: string;

  constructor(config: Config) {
    this.apiKey = config.clickupApiKey;
    this.teamId = config.clickupTeamId;
    this.tag = config.clickupTag;
    this.assigneeTag = config.assigneeTag;
    this.listId = config.clickupListId;
  }

  private async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const url = `https://api.clickup.com/api/v2${path}`;
    const maxAttempts = 3;
    let lastError: Error | undefined;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
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
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        const isNetworkError = lastError.message.includes('fetch failed')
          || lastError.message.includes('ECONNRESET')
          || lastError.message.includes('ETIMEDOUT')
          || lastError.message.includes('UND_ERR_SOCKET');

        if (!isNetworkError || attempt === maxAttempts) {
          const cause = (err as Record<string, unknown>)?.cause;
          const detail = cause instanceof Error ? `: ${cause.message}` : '';
          throw new Error(`ClickUp API request failed (${options.method || 'GET'} ${path})${detail}`);
        }

        const delay = attempt * 1000;
        logger.debug(`Fetch attempt ${attempt}/${maxAttempts} failed, retrying in ${delay}ms...`);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }

    throw lastError;
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

    interface RawCommentBlock {
      text?: string;
    }

    interface RawComment {
      id: string;
      comment_text: string | RawCommentBlock[];
      comment?: RawCommentBlock[];
      user: { username: string; id: number };
      date: string;
    }

    interface CommentsResponse {
      comments: RawComment[];
    }

    const data = await this.request<CommentsResponse>(`/task/${taskId}/comment`);

    // ClickUp returns comments newest-first; sort ascending so newest is last
    const sorted = [...data.comments].sort((a, b) => parseInt(a.date, 10) - parseInt(b.date, 10));

    return sorted.map((c) => {
      let text: string;
      if (typeof c.comment_text === 'string' && c.comment_text) {
        text = c.comment_text;
      } else if (Array.isArray(c.comment_text) && c.comment_text.length > 0) {
        text = c.comment_text.map((b) => b.text || '').join('');
      } else if (Array.isArray(c.comment) && c.comment.length > 0) {
        text = c.comment.map((b) => b.text || '').join('');
      } else {
        text = '';
      }
      return {
        id: c.id,
        text,
        author: c.user.username,
        authorId: String(c.user.id),
        date: parseInt(c.date, 10),
      };
    });
  }

  async updateStatus(taskId: string, status: string): Promise<void> {
    logger.debug(`Updating task ${taskId} status to "${status}"`);
    await this.request(`/task/${taskId}`, {
      method: 'PUT',
      body: JSON.stringify({ status }),
    });
  }

  async createTask(params: CreateTaskParams): Promise<CreateTaskResult> {
    const listId = params.listId || this.listId;
    if (!listId) {
      throw new Error(
        'Cannot create task: no ClickUp list ID configured. Set CLICKUP_LIST_ID in .env.aidev or specify listId on the task.',
      );
    }

    const body: Record<string, unknown> = {
      name: params.title,
      description: params.description,
      tags: params.tags,
    };
    if (params.priority) body.priority = params.priority;
    if (params.dueDate) {
      body.due_date = params.dueDate;
      body.due_date_time = true;
    }

    interface CreateResponse {
      id: string;
      url: string;
    }

    const result = await this.request<CreateResponse>(`/list/${listId}/task`, {
      method: 'POST',
      body: JSON.stringify(body),
    });

    return { id: result.id, url: result.url };
  }
}

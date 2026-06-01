import { Task, Comment, Config, CreateTaskParams, CreateTaskResult } from '../types';
import { TaskProvider } from './base';
import { logger } from '../logger';

const NOTION_API_BASE = 'https://api.notion.com/v1';
const NOTION_VERSION = '2022-06-28';

interface NotionDatabaseSchema {
  properties: Record<
    string,
    { type: string; name?: string; id?: string; select?: { options?: Array<{ name: string }> }; status?: { options?: Array<{ name: string }> } }
  >;
}

interface NotionDatabaseResponse {
  id: string;
  properties: NotionDatabaseSchema['properties'];
  url?: string;
}

interface NotionRichTextItem {
  plain_text?: string;
  type?: string;
  text?: { content?: string };
}

interface NotionPagePropertyValue {
  id?: string;
  type: string;
  title?: NotionRichTextItem[];
  rich_text?: NotionRichTextItem[];
  select?: { name: string };
  status?: { name: string };
  multi_select?: Array<{ name: string }>;
}

interface NotionPage {
  id: string;
  url: string;
  properties: Record<string, NotionPagePropertyValue>;
}

interface NotionQueryResponse {
  results: NotionPage[];
  next_cursor: string | null;
  has_more: boolean;
}

interface NotionCommentRichText {
  plain_text?: string;
}

interface NotionComment {
  id: string;
  created_time: string;
  created_by?: { id: string; object?: string };
  rich_text?: NotionCommentRichText[];
}

interface NotionCommentsResponse {
  results: NotionComment[];
  next_cursor: string | null;
  has_more: boolean;
}

function extractPlainText(items: NotionRichTextItem[] | undefined): string {
  if (!Array.isArray(items)) return '';
  return items.map((t) => t.plain_text ?? t.text?.content ?? '').join('');
}

function getTitlePropertyName(properties: NotionDatabaseSchema['properties']): string {
  const entry = Object.entries(properties).find(([, p]) => p.type === 'title');
  return entry?.[0] ?? 'Name';
}

function getStatusPropertyInfo(properties: NotionDatabaseSchema['properties'], statusPropName: string): { name: string; type: 'status' | 'select' } | null {
  const name = statusPropName || 'Status';
  const prop = properties[name];
  if (!prop) return null;
  if (prop.type === 'status') return { name, type: 'status' };
  if (prop.type === 'select') return { name, type: 'select' };
  return null;
}

export class NotionProvider implements TaskProvider {
  private apiKey: string;
  private databaseId: string;
  private statusPropertyName: string;
  private pendingStatus: string;
  private inReviewStatus: string;
  private titlePropertyName: string | null = null;
  private statusPropertyType: 'status' | 'select' | null = null;

  constructor(config: Config) {
    this.apiKey = config.notionApiKey;
    this.databaseId = config.notionDatabaseId;
    this.statusPropertyName = config.notionStatusProperty || 'Status';
    this.pendingStatus = config.notionPendingStatus || 'pending';
    this.inReviewStatus = config.notionInReviewStatus || 'review';
  }

  private async ensureSchema(): Promise<void> {
    if (this.titlePropertyName !== null && this.statusPropertyType !== null) return;

    const db = await this.request<NotionDatabaseResponse>(`/databases/${this.databaseId}`, {
      method: 'GET',
    });
    this.titlePropertyName = getTitlePropertyName(db.properties);
    const statusInfo = getStatusPropertyInfo(db.properties, this.statusPropertyName);
    if (statusInfo) {
      this.statusPropertyType = statusInfo.type;
    } else {
      this.statusPropertyType = 'select';
    }
  }

  private async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const url = `${NOTION_API_BASE}${path}`;
    const res = await fetch(url, {
      ...options,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Notion-Version': NOTION_VERSION,
        'Content-Type': 'application/json',
        ...(options.headers || {}),
      },
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Notion API error ${res.status}: ${body}`);
    }

    return res.json() as Promise<T>;
  }

  private buildQueryFilter(): Record<string, unknown> {
    const prop = this.statusPropertyName;
    const pending = this.pendingStatus;
    const inReview = this.inReviewStatus;
    const key = this.statusPropertyType === 'status' ? 'status' : 'select';
    return {
      or: [
        { property: prop, [key]: { equals: pending } },
        { property: prop, [key]: { equals: inReview } },
      ],
    };
  }

  async fetchTasks(_options?: import('../types').FetchTasksOptions): Promise<Task[]> {
    await this.ensureSchema();
    logger.debug(`Fetching tasks from Notion database ${this.databaseId}`);

    const body: { filter?: Record<string, unknown>; page_size?: number } = {
      page_size: 100,
      filter: this.buildQueryFilter(),
    };

    const data = await this.request<NotionQueryResponse>(`/databases/${this.databaseId}/query`, {
      method: 'POST',
      body: JSON.stringify(body),
    });

    const titleKey = this.titlePropertyName ?? 'Name';
    const statusKey = this.statusPropertyName;
    const tasks: Task[] = [];

    for (const page of data.results) {
      const props = page.properties || {};
      const titleProp = props[titleKey];
      const statusProp = props[statusKey];
      const name = titleProp?.title ? extractPlainText(titleProp.title) : '';
      const statusValue = statusProp?.status?.name ?? statusProp?.select?.name ?? '';
      const descProp = props['Description'] ?? props['description'];
      const description = descProp?.rich_text ? extractPlainText(descProp.rich_text) : '';
      const tagsProp = props['Tags'] ?? props['tags'];
      const tags = Array.isArray(tagsProp?.multi_select)
        ? tagsProp.multi_select.map((o) => o.name)
        : [];

      tasks.push({
        id: page.id.replace(/-/g, ''),
        name,
        description,
        status: statusValue.toLowerCase(),
        url: page.url || `https://notion.so/${page.id.replace(/-/g, '')}`,
        tags,
        sourceListId: this.databaseId,
      });
    }

    return tasks;
  }

  async fetchTasksByStatus(statuses: string[], _options?: import('../types').FetchTasksOptions): Promise<Task[]> {
    const normalized = statuses.map((s) => s.toLowerCase());
    const all = await this.fetchTasks();
    return all.filter((t) => normalized.includes(t.status.toLowerCase()));
  }

  async postComment(taskId: string, text: string): Promise<void> {
    logger.debug(`Posting comment to Notion page ${taskId}`);
    const pageId = taskId.length === 32 ? `${taskId.slice(0, 8)}-${taskId.slice(8, 12)}-${taskId.slice(12, 16)}-${taskId.slice(16, 20)}-${taskId.slice(20, 32)}` : taskId;
    await this.request('/comments', {
      method: 'POST',
      body: JSON.stringify({
        parent: { page_id: pageId },
        rich_text: [{ type: 'text', text: { content: text } }],
      }),
    });
  }

  async getComments(taskId: string): Promise<Comment[]> {
    logger.debug(`Fetching comments for Notion page ${taskId}`);
    const pageId = taskId.length === 32 ? `${taskId.slice(0, 8)}-${taskId.slice(8, 12)}-${taskId.slice(12, 16)}-${taskId.slice(16, 20)}-${taskId.slice(20, 32)}` : taskId;
    const data = await this.request<NotionCommentsResponse>(`/comments?block_id=${pageId}`);

    const comments: Comment[] = (data.results || []).map((c) => ({
      id: c.id,
      text: (c.rich_text || []).map((t) => t.plain_text ?? '').join(''),
      author: 'Notion',
      authorId: c.created_by?.id ?? '',
      date: new Date(c.created_time).getTime(),
    }));
    comments.sort((a, b) => a.date - b.date);
    return comments;
  }

  async fetchAvailableStatuses(): Promise<string[]> {
    const db = await this.request<NotionDatabaseResponse>(`/databases/${this.databaseId}`);
    const prop = db.properties[this.statusPropertyName];
    const options = prop?.status?.options ?? prop?.select?.options ?? [];
    return options.map((o) => o.name);
  }

  async updateStatus(taskId: string, status: string): Promise<void> {
    await this.ensureSchema();
    logger.debug(`Updating Notion page ${taskId} status to "${status}"`);
    const pageId = taskId.length === 32 ? `${taskId.slice(0, 8)}-${taskId.slice(8, 12)}-${taskId.slice(12, 16)}-${taskId.slice(16, 20)}-${taskId.slice(20, 32)}` : taskId;
    const key = this.statusPropertyType === 'status' ? 'status' : 'select';
    const value = key === 'status' ? { name: status } : { name: status };
    await this.request(`/pages/${pageId}`, {
      method: 'PATCH',
      body: JSON.stringify({
        properties: {
          [this.statusPropertyName]: { [key]: value },
        },
      }),
    });
  }

  async removeTag(taskId: string, tag: string): Promise<void> {
    logger.debug(`Removing tag "${tag}" from Notion page ${taskId}`);
    const pageId = taskId.length === 32 ? `${taskId.slice(0, 8)}-${taskId.slice(8, 12)}-${taskId.slice(12, 16)}-${taskId.slice(16, 20)}-${taskId.slice(20, 32)}` : taskId;

    const page = await this.request<NotionPage>(`/pages/${pageId}`);
    const tagsProp = page.properties['Tags'] ?? page.properties['tags'];
    const propName = page.properties['Tags'] ? 'Tags' : page.properties['tags'] ? 'tags' : null;
    if (!propName || !Array.isArray(tagsProp?.multi_select)) return;

    const want = tag.toLowerCase();
    const remaining = tagsProp.multi_select.filter((o) => o.name.toLowerCase() !== want);
    if (remaining.length === tagsProp.multi_select.length) return;

    await this.request(`/pages/${pageId}`, {
      method: 'PATCH',
      body: JSON.stringify({
        properties: {
          [propName]: { multi_select: remaining.map((o) => ({ name: o.name })) },
        },
      }),
    });
  }

  async addTag(taskId: string, tag: string): Promise<void> {
    logger.debug(`Adding tag "${tag}" to Notion page ${taskId}`);
    const pageId = taskId.length === 32 ? `${taskId.slice(0, 8)}-${taskId.slice(8, 12)}-${taskId.slice(12, 16)}-${taskId.slice(16, 20)}-${taskId.slice(20, 32)}` : taskId;

    const page = await this.request<NotionPage>(`/pages/${pageId}`);
    const propName = page.properties['Tags'] ? 'Tags' : page.properties['tags'] ? 'tags' : null;
    if (!propName) return;

    const tagsProp = page.properties[propName];
    const existing: Array<{ name: string }> = Array.isArray(tagsProp?.multi_select)
      ? tagsProp.multi_select
      : [];
    if (existing.some((o) => o.name.toLowerCase() === tag.toLowerCase())) return;

    await this.request(`/pages/${pageId}`, {
      method: 'PATCH',
      body: JSON.stringify({
        properties: {
          [propName]: { multi_select: [...existing.map((o) => ({ name: o.name })), { name: tag }] },
        },
      }),
    });
  }

  async createTask(params: CreateTaskParams): Promise<CreateTaskResult> {
    await this.ensureSchema();
    const titleKey = this.titlePropertyName ?? 'Name';
    const props: Record<string, unknown> = {
      [titleKey]: {
        title: [{ type: 'text', text: { content: params.title } }],
      },
    };
    const key = this.statusPropertyType === 'status' ? 'status' : 'select';
    props[this.statusPropertyName] = { [key]: { name: this.pendingStatus } };

    const body = {
      parent: { database_id: this.databaseId },
      properties: props,
    };

    const page = await this.request<NotionPage>('/pages', {
      method: 'POST',
      body: JSON.stringify(body),
    });

    const id = page.id.replace(/-/g, '');
    const url = page.url || `https://notion.so/${page.id.replace(/-/g, '')}`;
    return { id, url };
  }
}

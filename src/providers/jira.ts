import { Task, Comment, Config, CreateTaskParams, CreateTaskResult, FetchTasksOptions } from '../types';
import { TaskProvider } from './base';
import { logger } from '../logger';
import {
  appendAttachmentPaths,
  downloadAttachments,
  DownloadedAttachment,
  NativeAttachment,
  normalizeAttachmentUrl,
} from './assets';

interface JiraRawAttachment {
  id?: string | number;
  filename?: string;
  content?: string;
}

interface JiraAttachmentReference {
  id?: string;
  url?: string;
}

export class JiraProvider implements TaskProvider {
  private baseUrl: string;
  private authHeader: string;
  private project: string;
  private label: string;
  private assigneeTag: string;
  private inReviewStatus: string;

  constructor(config: Config) {
    this.baseUrl = config.jiraBaseUrl.replace(/\/$/, '');
    this.authHeader =
      'Basic ' + Buffer.from(`${config.jiraEmail}:${config.jiraApiToken}`).toString('base64');
    this.project = config.jiraProject;
    this.label = config.jiraLabel;
    this.assigneeTag = config.assigneeTag;
    this.inReviewStatus = config.jiraInReviewStatus || 'In Review';
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

  private buildAuthHeaders(): Record<string, string> {
    return {
      Authorization: this.authHeader,
      Accept: '*/*',
    };
  }

  /** Extract plain text from an Atlassian Document Format node. */
  private adfToText(node: unknown): string {
    return this.normalizeAdfText(this.adfToTextNode(node));
  }

  private adfToTextNode(node: unknown): string {
    if (!node || typeof node !== 'object') return '';
    const n = node as Record<string, unknown>;
    if (n.type === 'text' && typeof n.text === 'string') return n.text;
    if (n.type === 'hardBreak') return '\n';
    if (Array.isArray(n.content)) {
      const children = (n.content as unknown[]).map((c) => this.adfToTextNode(c)).join('');
      if (n.type === 'paragraph' || n.type === 'heading' || n.type === 'listItem') {
        return `${children}\n`;
      }
      return children;
    }
    return '';
  }

  private normalizeAdfText(text: string): string {
    return text.replace(/\n{3,}/g, '\n\n').trim();
  }

  private async downloadIssueAttachments(
    taskId: string,
    attachments: JiraRawAttachment[]
  ): Promise<DownloadedAttachment[]> {
    const nativeAttachments: NativeAttachment[] = attachments
      .filter((attachment) => Boolean(attachment.content))
      .map((attachment) => ({
        id: attachment.id !== undefined ? String(attachment.id) : undefined,
        name: attachment.filename,
        url: attachment.content,
      }));

    return downloadAttachments(taskId, nativeAttachments, {
      headers: this.buildAuthHeaders(),
    });
  }

  private async fetchIssueAttachments(taskId: string): Promise<DownloadedAttachment[]> {
    interface IssueResponse {
      fields: {
        attachment?: JiraRawAttachment[];
      };
    }

    const issue = await this.request<IssueResponse>(`/issue/${taskId}?fields=attachment`);
    return this.downloadIssueAttachments(taskId, issue.fields.attachment || []);
  }

  private collectAttachmentReferences(
    node: unknown,
    refs: JiraAttachmentReference[] = []
  ): JiraAttachmentReference[] {
    if (!node || typeof node !== 'object') return refs;

    const record = node as Record<string, unknown>;
    const attrs = this.asRecord(record.attrs);
    if (record.type === 'media') {
      const id = typeof attrs?.id === 'string' ? attrs.id : undefined;
      const url = typeof attrs?.url === 'string' ? attrs.url : undefined;
      if (id || url) refs.push({ id, url });
    }

    if (Array.isArray(record.marks)) {
      for (const mark of record.marks) {
        const markRecord = this.asRecord(mark);
        const markAttrs = this.asRecord(markRecord?.attrs);
        if (markRecord?.type === 'link' && typeof markAttrs?.href === 'string') {
          refs.push({ url: markAttrs.href });
        }
      }
    }

    if (Array.isArray(record.content)) {
      for (const child of record.content) {
        this.collectAttachmentReferences(child, refs);
      }
    }

    return refs;
  }

  private resolveCommentAttachments(
    body: unknown,
    attachments: DownloadedAttachment[]
  ): DownloadedAttachment[] {
    const refs = this.collectAttachmentReferences(body);
    const matched: DownloadedAttachment[] = [];
    const seen = new Set<string>();

    for (const ref of refs) {
      const attachment = this.findAttachmentForReference(ref, attachments);
      if (!attachment || seen.has(attachment.path)) continue;
      seen.add(attachment.path);
      matched.push(attachment);
    }

    return matched;
  }

  private findAttachmentForReference(
    ref: JiraAttachmentReference,
    attachments: DownloadedAttachment[]
  ): DownloadedAttachment | undefined {
    if (ref.id) {
      const byId = attachments.find((attachment) => attachment.id === ref.id);
      if (byId) return byId;
    }

    if (!ref.url) return undefined;

    const absoluteUrl = this.toAbsoluteUrl(ref.url);
    const attachmentId = this.extractAttachmentId(ref.url);
    if (attachmentId) {
      const byId = attachments.find((attachment) => attachment.id === attachmentId);
      if (byId) return byId;
    }

    const normalized = normalizeAttachmentUrl(absoluteUrl);
    return attachments.find(
      (attachment) => normalizeAttachmentUrl(attachment.sourceUrl) === normalized
    );
  }

  private toAbsoluteUrl(url: string): string {
    try {
      return new URL(url, this.baseUrl).toString();
    } catch {
      return url;
    }
  }

  private extractAttachmentId(url: string): string | null {
    try {
      const pathname = new URL(url, this.baseUrl).pathname;
      const match = pathname.match(/\/attachment\/content\/(\d+)/)
        || pathname.match(/\/attachment\/(\d+)/)
        || pathname.match(/\/secure\/attachment\/(\d+)/);
      return match?.[1] || null;
    } catch {
      return null;
    }
  }

  private asRecord(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object' ? value as Record<string, unknown> : null;
  }

  private parseBlockedBy(issuelinks: unknown[]): string[] {
    return issuelinks
      .filter((link): link is Record<string, unknown> => {
        if (!link || typeof link !== 'object') return false;
        const l = link as Record<string, unknown>;
        const linkType = l.type as Record<string, unknown> | undefined;
        return linkType?.inward === 'is blocked by' && l.inwardIssue != null;
      })
      .map((link) => (link.inwardIssue as Record<string, unknown>).key as string);
  }

  async fetchTasks(options?: FetchTasksOptions): Promise<Task[]> {
    logger.debug(`Fetching Jira issues in project "${this.project}" with label "${this.label}"`);
    const skipAttachments = options?.skipAttachments === true;
    const omitDescription = options?.omitDescription === true;

    interface RawIssue {
      id: string;
      key: string;
      fields: {
        summary: string;
        description: unknown;
        status: { name: string };
        priority: { id: string } | null;
        labels: string[];
        self: string;
        attachment?: JiraRawAttachment[];
        project?: { key?: string };
        issuelinks?: unknown[];
      };
    }

    interface SearchResponse {
      issues: RawIssue[];
    }

    const labelClause = this.label === '*' ? '' : ` AND labels = "${this.label}"`;
    const updatedAfter = options?.updatedAfter;
    const updatedClause = updatedAfter
      ? ` AND updated >= "${new Date(updatedAfter).toISOString().split('T')[0]}"`
      : '';
    const jql = `project = "${this.project}"${labelClause}${updatedClause} AND statusCategory != Done ORDER BY created DESC`;
    const fields = 'summary,description,status,priority,labels,attachment,project,issuelinks';
    const data = await this.request<SearchResponse>(
      `/search/jql?jql=${encodeURIComponent(jql)}&fields=${fields}&maxResults=50`
    );

    return Promise.all(data.issues.map(async (issue) => {
      let description = omitDescription ? '' : this.adfToText(issue.fields.description);
      if (!skipAttachments && !omitDescription) {
        try {
          const attachments = await this.downloadIssueAttachments(
            issue.key,
            issue.fields.attachment || [],
          );
          description = appendAttachmentPaths(description, attachments);
        } catch (err) {
          logger.warn(
            `[${issue.key}] Failed to download Jira attachments: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }

      const blockedBy = this.parseBlockedBy(issue.fields.issuelinks || []);

      return {
        id: issue.key,
        name: issue.fields.summary,
        description,
        status: issue.fields.status.name.toLowerCase(),
        url: `${this.baseUrl}/browse/${issue.key}`,
        tags: issue.fields.labels,
        priority: issue.fields.priority ? parseInt(issue.fields.priority.id, 10) : undefined,
        sourceListId: issue.fields.project?.key,
        ...(blockedBy.length > 0 ? { blockedBy } : {}),
      };
    }));
  }

  async fetchTaskById(taskId: string): Promise<Task | null> {
    logger.debug(`Fetching Jira issue ${taskId}`);

    interface RawIssue {
      key: string;
      fields: {
        summary: string;
        description: unknown;
        status: { name: string };
        priority: { id: string } | null;
        labels: string[];
        project?: { key?: string };
        issuelinks?: unknown[];
      };
    }

    let issue: RawIssue;
    try {
      issue = await this.request<RawIssue>(
        `/issue/${encodeURIComponent(taskId)}?fields=summary,description,status,priority,labels,project,issuelinks`
      );
    } catch {
      return null;
    }

    const blockedBy = this.parseBlockedBy(issue.fields.issuelinks || []);

    return {
      id: issue.key,
      name: issue.fields.summary,
      description: this.adfToText(issue.fields.description),
      status: issue.fields.status.name.toLowerCase(),
      url: `${this.baseUrl}/browse/${issue.key}`,
      tags: issue.fields.labels,
      priority: issue.fields.priority ? parseInt(issue.fields.priority.id, 10) : undefined,
      sourceListId: issue.fields.project?.key,
      ...(blockedBy.length > 0 ? { blockedBy } : {}),
    };
  }

  async fetchTasksByStatus(statuses: string[], options?: FetchTasksOptions): Promise<Task[]> {
    const normalized = statuses.map((s) => s.toLowerCase());
    const all = await this.fetchTasks(options);
    return all.filter((t) => normalized.includes(t.status.toLowerCase()));
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

    let issueAttachments: DownloadedAttachment[] = [];
    try {
      issueAttachments = await this.fetchIssueAttachments(taskId);
    } catch (err) {
      logger.warn(
        `[${taskId}] Failed to fetch Jira attachments for comment context: ${err instanceof Error ? err.message : String(err)}`
      );
    }

    const data = await this.request<CommentsResponse>(`/issue/${taskId}/comment`);

    // Sort ascending by date so newest is always last (consistent with ClickUp provider)
    const sorted = [...data.comments].sort(
      (a, b) => new Date(a.created).getTime() - new Date(b.created).getTime()
    );

    return sorted.map((c) => ({
      id: c.id,
      text: appendAttachmentPaths(
        this.adfToText(c.body),
        this.resolveCommentAttachments(c.body, issueAttachments),
        'Local asset files referenced by this comment (read/use these if relevant):'
      ),
      author: c.author.displayName,
      authorId: c.author.accountId,
      date: new Date(c.created).getTime(),
    }));
  }

  async fetchAvailableStatuses(): Promise<string[]> {
    interface ProjectStatusesResponse extends Array<{
      statuses: Array<{ name: string }>;
    }> {}

    const data = await this.request<ProjectStatusesResponse>(
      `/project/${encodeURIComponent(this.project)}/statuses`
    );
    const seen = new Set<string>();
    for (const issueType of data) {
      for (const s of issueType.statuses || []) {
        if (s.name) seen.add(s.name);
      }
    }
    return [...seen];
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

  async fetchBoardTasks(options?: FetchTasksOptions): Promise<Task[]> {
    const boardOpts: FetchTasksOptions = { skipAttachments: true, omitDescription: true, ...options };
    const labeled = await this.fetchTasks(boardOpts);
    const labelClauseReview = this.label === '*' ? '' : ` AND labels = "${this.label}"`;
    const reviewJql = `project = "${this.project}"${labelClauseReview} AND status = "${this.inReviewStatus}" AND statusCategory != Done ORDER BY created DESC`;
    interface SearchResponse { issues: Array<{ id: string; key: string; fields: { summary: string; status: { name: string }; priority: { id: string } | null; labels: string[]; project?: { key?: string }; issuelinks?: unknown[] } }> }
    let reviewTasks: Task[] = [];
    try {
      const data = await this.request<SearchResponse>(
        `/search/jql?jql=${encodeURIComponent(reviewJql)}&fields=summary,status,priority,labels,project,issuelinks&maxResults=50`,
      );
      reviewTasks = data.issues.map((issue) => {
        const blockedBy = this.parseBlockedBy(issue.fields.issuelinks || []);
        return {
          id: issue.key,
          name: issue.fields.summary,
          description: '',
          status: issue.fields.status.name.toLowerCase(),
          url: `${this.baseUrl}/browse/${issue.key}`,
          tags: issue.fields.labels,
          priority: issue.fields.priority ? parseInt(issue.fields.priority.id, 10) : undefined,
          sourceListId: issue.fields.project?.key,
          ...(blockedBy.length > 0 ? { blockedBy } : {}),
        };
      });
    } catch (err) {
      logger.warn(`Failed to fetch Jira review tasks: ${err instanceof Error ? err.message : err}`);
    }
    const byId = new Map<string, Task>();
    for (const t of labeled) byId.set(t.id, t);
    for (const t of reviewTasks) byId.set(t.id, t);
    return [...byId.values()];
  }

  async removeTag(taskId: string, tag: string): Promise<void> {
    logger.debug(`Removing label "${tag}" from Jira issue ${taskId}`);
    await this.request(`/issue/${taskId}`, {
      method: 'PUT',
      body: JSON.stringify({
        update: { labels: [{ remove: tag }] },
      }),
    });
  }

  async addTag(taskId: string, tag: string): Promise<void> {
    logger.debug(`Adding label "${tag}" to Jira issue ${taskId}`);
    await this.request(`/issue/${taskId}`, {
      method: 'PUT',
      body: JSON.stringify({
        update: { labels: [{ add: tag }] },
      }),
    });
  }

  async createTask(params: CreateTaskParams): Promise<CreateTaskResult> {
    const project = params.listId || this.project;

    const fields: Record<string, unknown> = {
      project: { key: project },
      summary: params.title,
      description: {
        type: 'doc',
        version: 1,
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: params.description || ' ' }] },
        ],
      },
      issuetype: { name: 'Task' },
      labels: params.tags,
    };

    if (params.priority) {
      const names: Record<number, string> = { 1: 'Highest', 2: 'High', 3: 'Medium', 4: 'Low' };
      fields.priority = { name: names[params.priority] || 'Medium' };
    }
    if (params.dueDate) {
      fields.duedate = new Date(params.dueDate).toISOString().split('T')[0];
    }

    interface CreateResponse {
      id: string;
      key: string;
    }

    const result = await this.request<CreateResponse>('/issue', {
      method: 'POST',
      body: JSON.stringify({ fields }),
    });

    return { id: result.key, url: `${this.baseUrl}/browse/${result.key}` };
  }
}

import {
  Task,
  Comment,
  Config,
  CreateTaskParams,
  CreateTaskResult,
  DashboardCounts,
  DashboardStatsParams,
  FetchTasksOptions,
} from '../types';
import { TaskProvider } from './base';
import { logger } from '../logger';
import {
  appendAttachmentPaths,
  downloadAttachments,
  DownloadedAttachment,
  NativeAttachment,
} from './assets';
import {
  ClickUpBlock,
  clickupBlocksToMarkdown,
  markdownToClickupBlocks,
} from './clickup-format';

function mergeById<T extends { id: string }>(primary: T[], extra: T[]): T[] {
  const byId = new Map<string, T>();
  for (const t of primary) byId.set(t.id, t);
  for (const t of extra) byId.set(t.id, t);
  return [...byId.values()];
}

interface ClickUpDependency {
  task_id: string;
  depends_on?: string;
  type: number;
}

interface ClickUpRawTask {
  id: string;
  name: string;
  description?: string;
  markdown_description?: string;
  status: { status: string };
  priority: { id: string } | null;
  url: string;
  tags: Array<{ name: string }>;
  list?: { id?: string };
  dependencies?: ClickUpDependency[];
}

/** ClickUp "waiting on" dependencies expose the blocker id in `depends_on`.
 * type=1 means this task is waiting on `depends_on` (blocked by it).
 * type=2 means this task is blocking `depends_on` (the opposite direction). */
export function getBlockedByFromClickUpDependencies(
  dependencies: ClickUpDependency[] | undefined,
): string[] {
  if (!dependencies?.length) return [];
  return dependencies
    .filter((d) => d.type !== 2)
    .map((d) => d.depends_on)
    .filter((id): id is string => typeof id === 'string' && id.length > 0);
}

interface ClickUpLiteTask {
  id: string;
  status: { status: string };
  date_updated: string;
}

interface ClickUpTasksPage {
  tasks: ClickUpLiteTask[];
  last_page?: boolean;
}

export class ClickUpProvider implements TaskProvider {
  private apiKey: string;
  private teamId: string;
  private tag: string;
  private assigneeTag: string;
  private listId: string;
  private pendingStatus: string;
  private openStatus: string;
  private inReviewStatus: string;

  constructor(config: Config) {
    this.apiKey = config.clickupApiKey;
    this.teamId = config.clickupTeamId;
    this.tag = config.clickupTag;
    this.assigneeTag = config.assigneeTag;
    this.listId = config.clickupListId;
    this.pendingStatus = config.clickupPendingStatus || 'pending';
    this.openStatus = config.clickupOpenStatus || 'open';
    this.inReviewStatus = config.clickupInReviewStatus || 'review';
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

  private buildAuthHeaders(): Record<string, string> {
    return {
      Authorization: this.apiKey,
      Accept: '*/*',
    };
  }

  private static readonly IN_PROGRESS_STATUS = 'in progress';

  private buildTeamTasksQuery(opts: {
    includeClosed: boolean;
    statuses?: string[];
    updatedAfter?: number;
    page?: number;
    includeMarkdown?: boolean;
  }): string {
    const q: string[] = [];
    if (this.tag !== '*') q.push(`tags[]=${encodeURIComponent(this.tag)}`);
    q.push('subtasks=true');
    q.push(`include_closed=${opts.includeClosed ? 'true' : 'false'}`);
    q.push('include_dependencies=true');
    if (opts.includeMarkdown) q.push('include_markdown_description=true');
    for (const status of opts.statuses ?? []) {
      q.push(`statuses[]=${encodeURIComponent(status)}`);
    }
    if (opts.updatedAfter !== undefined) {
      q.push(`date_updated_gt=${opts.updatedAfter}`);
    }
    if (opts.page !== undefined) q.push(`page=${opts.page}`);
    return `/team/${this.teamId}/task?${q.join('&')}`;
  }

  private async fetchAllLiteTasks(opts: {
    includeClosed: boolean;
    statuses?: string[];
    updatedAfter?: number;
  }): Promise<ClickUpLiteTask[]> {
    const all: ClickUpLiteTask[] = [];
    let page = 0;
    while (true) {
      const data = await this.request<ClickUpTasksPage>(
        this.buildTeamTasksQuery({ ...opts, page }),
      );
      all.push(...(data.tasks ?? []));
      if (data.last_page !== false) break;
      page += 1;
    }
    return all;
  }

  private static statusSet(statuses: string[]): Set<string> {
    return new Set(statuses.map((s) => s.toLowerCase()));
  }

  async fetchDashboardCounts(params: DashboardStatsParams): Promise<DashboardCounts> {
    const openSet = ClickUpProvider.statusSet(params.openStatuses);
    const pendingSet = ClickUpProvider.statusSet(params.pendingStatuses);
    const reviewSet = ClickUpProvider.statusSet(params.reviewStatuses);
    const executedStatuses = [
      ...params.reviewStatuses,
      ...params.inProgressStatuses,
      ...params.doneStatuses,
    ];

    const [activeTasks, doneTasks, updatedTasks] = await Promise.all([
      this.fetchAllLiteTasks({ includeClosed: false }),
      params.doneStatuses.length
        ? this.fetchAllLiteTasks({ includeClosed: true, statuses: params.doneStatuses })
        : Promise.resolve([] as ClickUpLiteTask[]),
      executedStatuses.length
        ? this.fetchAllLiteTasks({
            includeClosed: true,
            updatedAfter: params.previousPeriodStart,
            statuses: executedStatuses,
          })
        : Promise.resolve([] as ClickUpLiteTask[]),
    ]);

    let open = 0;
    let pending = 0;
    let inReview = 0;
    for (const t of activeTasks) {
      const status = t.status.status.toLowerCase();
      if (openSet.has(status)) open += 1;
      else if (pendingSet.has(status)) pending += 1;
      else if (reviewSet.has(status)) inReview += 1;
    }

    let executedCurrent = 0;
    for (const t of updatedTasks) {
      if (parseInt(t.date_updated, 10) >= params.currentPeriodStart) {
        executedCurrent += 1;
      }
    }
    const executedCombined = updatedTasks.length;

    return {
      open,
      pending,
      inReview,
      allTimeDone: doneTasks.length,
      executedCurrent,
      executedPrevious: Math.max(0, executedCombined - executedCurrent),
    };
  }

  private async fetchTaggedTeamTasks(
    updatedAfter?: number,
    includeClosed = false,
    includeMarkdown = false,
  ): Promise<ClickUpRawTask[]> {
    interface TasksResponse {
      tasks: ClickUpRawTask[];
      last_page?: boolean;
    }

    const all: ClickUpRawTask[] = [];
    let page = 0;
    while (true) {
      const data = await this.request<TasksResponse>(
        this.buildTeamTasksQuery({
          includeClosed,
          updatedAfter,
          page,
          includeMarkdown,
        }),
      );
      all.push(...(data.tasks ?? []));
      if (data.last_page !== false) break;
      page += 1;
    }
    return all;
  }

  private async mapRawTasks(tasks: ClickUpRawTask[], options?: FetchTasksOptions): Promise<Task[]> {
    const skipAttachments = options?.skipAttachments === true;
    const omitDescription = options?.omitDescription === true;

    if (skipAttachments && omitDescription) {
      return tasks.map((t) => this.mapRawTaskSync(t, '', options));
    }

    return Promise.all(
      tasks.map(async (t) => {
        let description = omitDescription ? '' : (t.markdown_description || t.description || '');
        if (!skipAttachments) {
          try {
            const attachments = await this.fetchTaskAttachments(t.id);
            description = appendAttachmentPaths(description, attachments);
          } catch (err) {
            logger.warn(
              `[${t.id}] Failed to fetch ClickUp attachments: ${err instanceof Error ? err.message : String(err)}`,
            );
          }
        }
        return this.mapRawTaskSync(t, description, options);
      }),
    );
  }

  private mapRawTaskSync(t: ClickUpRawTask, description: string, _options?: FetchTasksOptions): Task {
    const blockedBy = getBlockedByFromClickUpDependencies(t.dependencies);
    return {
      id: t.id,
      name: t.name,
      description,
      status: t.status.status.toLowerCase(),
      url: t.url,
      tags: t.tags.map((tag) => tag.name),
      priority: t.priority ? parseInt(t.priority.id, 10) : undefined,
      sourceListId: t.list?.id,
      ...(blockedBy.length > 0 ? { blockedBy } : {}),
    };
  }

  private async fetchTaskAttachments(taskId: string): Promise<DownloadedAttachment[]> {
    interface RawTaskAttachment {
      id?: string | number;
      title?: string;
      url?: string;
    }

    interface TaskDetailsResponse {
      attachments?: RawTaskAttachment[];
    }

    const detail = await this.request<TaskDetailsResponse>(`/task/${taskId}`);
    const attachments: NativeAttachment[] = (detail.attachments || [])
      .filter((attachment) => Boolean(attachment.url))
      .map((attachment) => ({
        id: attachment.id !== undefined ? String(attachment.id) : undefined,
        name: attachment.title,
        url: attachment.url,
      }));

    return downloadAttachments(taskId, attachments, {
      headers: this.buildAuthHeaders(),
    });
  }

  private async fetchTeamTasksByStatus(statuses: string[]): Promise<ClickUpRawTask[]> {
    interface TasksResponse { tasks: ClickUpRawTask[] }
    const normalized = statuses.map((s) => s.toLowerCase());
    const data = await this.request<TasksResponse>(
      `/team/${this.teamId}/task?subtasks=true&include_closed=false&include_markdown_description=true`,
    );
    return data.tasks.filter((t) => normalized.includes(t.status.status.toLowerCase()));
  }

  async fetchBoardTasks(options?: FetchTasksOptions): Promise<Task[]> {
    logger.debug(`Fetching board tasks with tag "${this.tag}" from team ${this.teamId}`);
    const boardOpts: FetchTasksOptions = {
      skipAttachments: true,
      omitDescription: true,
      ...options,
    };
    const pendingStatus = this.pendingStatus.toLowerCase();
    const openStatus = this.openStatus.toLowerCase();
    const inProgress = ClickUpProvider.IN_PROGRESS_STATUS;
    const inReviewStatus = this.inReviewStatus.toLowerCase();

    const tagged = await this.fetchTaggedTeamTasks(
      options?.updatedAfter,
      options?.includeClosed === true,
      options?.omitDescription !== true,
    );
    const eligible = tagged.filter((t) => {
      const status = t.status.status.toLowerCase();
      return status === openStatus || status === pendingStatus || status === inProgress || status === inReviewStatus;
    });

    return this.mapRawTasks(eligible, boardOpts);
  }

  async fetchTaskById(taskId: string, options?: FetchTasksOptions): Promise<Task | null> {
    interface TaskDetailsResponse extends ClickUpRawTask {}

    try {
      const t = await this.request<TaskDetailsResponse>(
        `/task/${taskId}?include_markdown_description=true&include_dependencies=true`,
      );
      const mapped = await this.mapRawTasks([t], options);
      return mapped[0] ?? null;
    } catch {
      return null;
    }
  }

  async fetchTasks(options?: FetchTasksOptions): Promise<Task[]> {
    logger.debug(`Fetching tasks with tag "${this.tag}" from team ${this.teamId}`);

    const pendingStatus = this.pendingStatus.toLowerCase();
    const openStatus = this.openStatus.toLowerCase();
    const all = await this.fetchTaggedTeamTasks(
      options?.updatedAfter,
      options?.includeClosed === true,
      options?.omitDescription !== true,
    );
    const eligibleTasks = all.filter((t) => {
      const status = t.status.status.toLowerCase();
      return status === openStatus || status === pendingStatus;
    });

    return this.mapRawTasks(eligibleTasks, options);
  }

  async fetchTasksByStatus(statuses: string[], options?: FetchTasksOptions): Promise<Task[]> {
    const normalized = statuses.map((s) => s.toLowerCase());
    const all = await this.fetchTaggedTeamTasks(
      options?.updatedAfter,
      options?.includeClosed === true,
      options?.omitDescription !== true,
    );
    const eligibleTasks = all.filter((t) =>
      normalized.includes(t.status.status.toLowerCase()),
    );
    return this.mapRawTasks(eligibleTasks, options);
  }

  async postComment(taskId: string, text: string): Promise<void> {
    logger.debug(`Posting comment to task ${taskId}`);
    const blocks = markdownToClickupBlocks(text);
    await this.request(`/task/${taskId}/comment`, {
      method: 'POST',
      body: JSON.stringify({ comment: blocks }),
    });
  }

  async getComments(taskId: string): Promise<Comment[]> {
    logger.debug(`Fetching comments for task ${taskId}`);

    interface RawComment {
      id: string;
      comment_text: string | ClickUpBlock[];
      comment?: ClickUpBlock[];
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
        text = clickupBlocksToMarkdown(c.comment_text);
      } else if (Array.isArray(c.comment) && c.comment.length > 0) {
        text = clickupBlocksToMarkdown(c.comment);
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

  async fetchAvailableStatuses(): Promise<string[]> {
    interface RawTask {
      status: { status: string };
      list?: { id?: string };
    }
    interface TasksResponse {
      tasks: RawTask[];
    }
    interface ListResponse {
      statuses?: Array<{ status: string }>;
    }

    const seen = new Set<string>();

    if (this.listId) {
      try {
        const list = await this.request<ListResponse>(`/list/${this.listId}`);
        for (const s of list.statuses || []) {
          if (s.status) seen.add(s.status);
        }
      } catch {
        // fall through to task-based discovery
      }
    }

    if (seen.size === 0) {
      const tagFilter = this.tag === '*' ? '' : `tags[]=${encodeURIComponent(this.tag)}&`;
      const data = await this.request<TasksResponse>(
        `/team/${this.teamId}/task?${tagFilter}subtasks=true&include_closed=true`
      );
      for (const t of data.tasks) {
        if (t.status?.status) seen.add(t.status.status);
      }
    }

    return [...seen];
  }

  async updateStatus(taskId: string, status: string): Promise<void> {
    logger.debug(`Updating task ${taskId} status to "${status}"`);
    await this.request(`/task/${taskId}`, {
      method: 'PUT',
      body: JSON.stringify({ status }),
    });
  }

  async removeTag(taskId: string, tag: string): Promise<void> {
    logger.debug(`Removing tag "${tag}" from task ${taskId}`);
    await this.request(`/task/${taskId}/tag/${encodeURIComponent(tag)}`, {
      method: 'DELETE',
    });
  }

  async addTag(taskId: string, tag: string): Promise<void> {
    logger.debug(`Adding tag "${tag}" to task ${taskId}`);
    await this.request(`/task/${taskId}/tag/${encodeURIComponent(tag)}`, {
      method: 'POST',
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
      markdown_description: params.description,
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

  async setBlockedBy(taskId: string, blockedByIds: string[]): Promise<void> {
    if (blockedByIds.length === 0) return;
    for (const blockerId of blockedByIds) {
      try {
        await this.request(`/task/${taskId}/dependency`, {
          method: 'POST',
          body: JSON.stringify({ depends_on: blockerId }),
        });
      } catch (err) {
        logger.warn(
          `Failed to set blocker ${blockerId} on task ${taskId}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }
}

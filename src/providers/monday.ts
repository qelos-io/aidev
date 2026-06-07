import { Task, Comment, Config, CreateTaskParams, CreateTaskResult } from '../types';
import { TaskProvider } from './base';
import { logger } from '../logger';

const MONDAY_API_URL = 'https://api.monday.com/v2';

interface MondayGraphQLResponse<T> {
  data?: T;
  errors?: Array< { message: string } >;
  account_id?: number;
}

interface MondayColumnValue {
  id: string;
  type?: string;
  value: string | null;
  text?: string;
  linked_item_ids?: Array<string | number>;
}

const MONDAY_COLUMN_VALUES_FIELDS = `
  id
  type
  value
  text
  ... on DependencyValue {
    linked_item_ids
  }
`;

/** Monday dependency columns list predecessor item ids in linked_item_ids. */
export function getBlockedByFromMondayColumnValues(
  columnValues: MondayColumnValue[] | undefined,
): string[] {
  if (!columnValues) return [];
  const ids: string[] = [];
  for (const col of columnValues) {
    if (col.type !== 'dependency') continue;
    if (Array.isArray(col.linked_item_ids) && col.linked_item_ids.length > 0) {
      ids.push(...col.linked_item_ids.map(String));
      continue;
    }
    try {
      const parsed = JSON.parse(col.value || '{}') as { linkedPulseIds?: Array<{ linkedPulseId: number }> };
      for (const link of parsed.linkedPulseIds ?? []) {
        ids.push(String(link.linkedPulseId));
      }
    } catch {
      // malformed value — skip
    }
  }
  return ids;
}

interface MondayItem {
  id: string;
  name: string;
  url: string;
  description?: { description?: string };
  column_values?: MondayColumnValue[];
}

interface MondayUpdate {
  id: string;
  body?: string;
  text_body?: string;
  created_at?: string;
  creator?: { id: string; name?: string };
}

interface BoardsItemsResponse {
  boards: Array<{
    items_page: {
      cursor: string | null;
      items: MondayItem[];
    };
  }>;
}

interface ItemsByIdResponse {
  items: MondayItem[];
}

interface UpdatesResponse {
  items: Array<{
    updates: MondayUpdate[];
  }>;
}

interface CreateItemResponse {
  create_item: { id: string };
}

interface CreateUpdateResponse {
  create_update: { id: string };
}

interface ChangeColumnValueResponse {
  change_column_value: { id: string };
}

function getBlockedByFromColumnValues(columnValues: MondayColumnValue[] | undefined): string[] {
  return getBlockedByFromMondayColumnValues(columnValues);
}

function getStatusFromColumnValues(columnValues: MondayColumnValue[] | undefined, statusColumnId: string): string {
  if (!columnValues) return '';
  const col = columnValues.find((c) => c.id === statusColumnId);
  if (!col) return '';
  if (col.text) return col.text;
  try {
    const parsed = JSON.parse(col.value || '{}') as { label?: string };
    return parsed.label || '';
  } catch {
    return col.value || '';
  }
}

export class MondayProvider implements TaskProvider {
  private apiToken: string;
  private boardId: string;
  private statusColumnId: string;
  private groupId: string | null;
  private pendingStatus: string;
  private inReviewStatus: string;

  constructor(config: Config) {
    this.apiToken = config.mondayApiToken;
    this.boardId = config.mondayBoardId;
    this.statusColumnId = config.mondayStatusColumnId;
    this.groupId = config.mondayGroupId || null;
    this.pendingStatus = config.clickupPendingStatus || 'pending';
    this.inReviewStatus = config.clickupInReviewStatus || 'review';
  }

  private async graphql<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
    const res = await fetch(MONDAY_API_URL, {
      method: 'POST',
      headers: {
        Authorization: this.apiToken,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query, variables }),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Monday API HTTP ${res.status}: ${body}`);
    }

    const json = (await res.json()) as MondayGraphQLResponse<T>;
    if (json.errors && json.errors.length > 0) {
      const msg = json.errors.map((e) => e.message).join('; ');
      throw new Error(`Monday API GraphQL error: ${msg}`);
    }

    if (json.data === undefined) {
      throw new Error('Monday API returned no data');
    }

    return json.data;
  }

  async fetchTasks(_options?: import('../types').FetchTasksOptions): Promise<Task[]> {
    logger.debug(`Fetching items from Monday board ${this.boardId}`);

    const query = `
      query ($boardId: ID!, $limit: Int!) {
        boards(ids: [$boardId]) {
          items_page(limit: $limit) {
            cursor
            items {
              id
              name
              url
              description { description }
              column_values { ${MONDAY_COLUMN_VALUES_FIELDS} }
            }
          }
        }
      }
    `;

    const data = await this.graphql<BoardsItemsResponse>(query, {
      boardId: this.boardId,
      limit: 100,
    });

    const page = data.boards?.[0]?.items_page;
    if (!page?.items) return [];

    const pending = this.pendingStatus.toLowerCase();
    const inReview = this.inReviewStatus.toLowerCase();

    const tasks: Task[] = [];
    for (const item of page.items) {
      const statusText = getStatusFromColumnValues(item.column_values, this.statusColumnId);
      const statusNorm = statusText.toLowerCase();
      if (statusNorm !== pending && statusNorm !== inReview) continue;

      const blockedBy = getBlockedByFromColumnValues(item.column_values);
      tasks.push({
        id: String(item.id),
        name: item.name,
        description: item.description?.description ?? '',
        status: statusText,
        url: item.url || `https://${this.boardId}.monday.com`,
        tags: [],
        sourceListId: this.boardId,
        ...(blockedBy.length > 0 && { blockedBy }),
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
    logger.debug(`Posting update to Monday item ${taskId}`);
    const mutation = `
      mutation ($itemId: ID!, $body: String!) {
        create_update(item_id: $itemId, body: $body) { id }
      }
    `;
    await this.graphql<CreateUpdateResponse>(mutation, {
      itemId: taskId,
      body: text,
    });
  }

  async getComments(taskId: string): Promise<Comment[]> {
    logger.debug(`Fetching updates for Monday item ${taskId}`);

    const query = `
      query ($itemId: ID!) {
        items(ids: [$itemId]) {
          updates(limit: 100) {
            id
            text_body
            body
            created_at
            creator { id name }
          }
        }
      }
    `;

    const data = await this.graphql<UpdatesResponse>(query, { itemId: taskId });
    const item = data.items?.[0];
    const updates = item?.updates ?? [];

    const comments: Comment[] = updates.map((u) => ({
      id: u.id,
      text: u.text_body || stripHtml(u.body || ''),
      author: u.creator?.name || 'Unknown',
      authorId: u.creator?.id || '',
      date: u.created_at ? new Date(u.created_at).getTime() : 0,
    }));

    comments.sort((a, b) => a.date - b.date);
    return comments;
  }

  async fetchAvailableStatuses(): Promise<string[]> {
    interface ColumnsResponse {
      boards: Array<{
        columns: Array<{ id: string; settings_str?: string }>;
      }>;
    }

    const query = `
      query ($boardId: ID!) {
        boards(ids: [$boardId]) {
          columns { id settings_str }
        }
      }
    `;
    const data = await this.graphql<ColumnsResponse>(query, { boardId: this.boardId });
    const col = data.boards?.[0]?.columns?.find((c) => c.id === this.statusColumnId);
    if (!col?.settings_str) return [];
    try {
      const parsed = JSON.parse(col.settings_str) as { labels?: Record<string, string> };
      return Object.values(parsed.labels || {});
    } catch {
      return [];
    }
  }

  async updateStatus(taskId: string, status: string): Promise<void> {
    logger.debug(`Updating Monday item ${taskId} status to "${status}"`);
    const mutation = `
      mutation ($boardId: ID!, $itemId: ID!, $columnId: String!, $value: String!) {
        change_column_value(board_id: $boardId, item_id: $itemId, column_id: $columnId, value: $value) { id }
      }
    `;
    const value = JSON.stringify({ label: status });
    await this.graphql<ChangeColumnValueResponse>(mutation, {
      boardId: this.boardId,
      itemId: taskId,
      columnId: this.statusColumnId,
      value,
    });
  }

  async fetchTaskById(itemId: string): Promise<Task | null> {
    logger.debug(`Fetching Monday item by id ${itemId}`);
    const query = `
      query ($itemId: ID!) {
        items(ids: [$itemId]) {
          id
          name
          url
          column_values { ${MONDAY_COLUMN_VALUES_FIELDS} }
        }
      }
    `;
    try {
      const data = await this.graphql<ItemsByIdResponse>(query, { itemId });
      const item = data.items?.[0];
      if (!item) return null;
      const statusText = getStatusFromColumnValues(item.column_values, this.statusColumnId);
      const blockedBy = getBlockedByFromColumnValues(item.column_values);
      return {
        id: String(item.id),
        name: item.name,
        description: '',
        status: statusText,
        url: item.url || `https://monday.com/boards/${this.boardId}/pulses/${item.id}`,
        tags: [],
        sourceListId: this.boardId,
        ...(blockedBy.length > 0 && { blockedBy }),
      };
    } catch {
      return null;
    }
  }

  async createTask(params: CreateTaskParams): Promise<CreateTaskResult> {
    const groupId = this.groupId || 'topics';
    const mutation = `
      mutation ($boardId: ID!, $groupId: String!, $itemName: String!, $columnValues: JSON) {
        create_item(board_id: $boardId, group_id: $groupId, item_name: $itemName, column_values: $columnValues) { id }
      }
    `;

    const columnValues: Record<string, unknown> = {};
    if (this.statusColumnId) {
      columnValues[this.statusColumnId] = { label: this.pendingStatus };
    }

    const data = await this.graphql<CreateItemResponse>(mutation, {
      boardId: this.boardId,
      groupId,
      itemName: params.title,
      columnValues: Object.keys(columnValues).length > 0 ? JSON.stringify(columnValues) : undefined,
    });

    const id = String(data.create_item.id);
    return { id, url: `https://monday.com/boards/${this.boardId}/pulses/${id}` };
  }
}

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

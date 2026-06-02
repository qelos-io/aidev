import { Task, Comment, Config, CreateTaskParams, CreateTaskResult, FetchTasksOptions } from '../types';
import { TaskProvider } from './base';
import { logger } from '../logger';
import {
  appendAttachmentPaths,
  downloadAttachments,
  DownloadedAttachment,
  NativeAttachment,
} from './assets';

const TRELLO_API = 'https://api.trello.com/1';

interface TrelloList {
  id: string;
  name: string;
}

interface TrelloLabel {
  id: string;
  name: string;
}

interface TrelloCard {
  id: string;
  name: string;
  desc?: string;
  url: string;
  idList: string;
  idMembers: string[];
  labels: TrelloLabel[];
}

interface TrelloMember {
  id: string;
}

interface TrelloAction {
  id: string;
  type: string;
  date: string;
  data: { text?: string };
  idMemberCreator: string;
  memberCreator?: { id: string; fullName?: string; username?: string };
}

export class TrelloProvider implements TaskProvider {
  private readonly apiKey: string;
  private readonly token: string;
  private readonly boardId: string;
  private readonly labelName: string;
  private readonly openSemantic: string;
  private readonly pendingSemantic: string;
  private readonly inReviewSemantic: string;
  private readonly openListName: string;
  private readonly pendingListName: string;
  private readonly inProgressListName: string;
  private readonly inReviewListName: string;

  constructor(config: Config) {
    this.apiKey = config.trelloApiKey;
    this.token = config.trelloToken;
    this.boardId = config.trelloBoardId;
    this.labelName = config.trelloLabel;
    this.openSemantic = config.trelloOpenStatus || 'open';
    this.pendingSemantic = config.trelloPendingStatus || 'pending';
    this.inReviewSemantic = config.trelloInReviewStatus || 'review';
    this.openListName = config.trelloOpenList || 'To Do';
    this.pendingListName = config.trelloPendingList || 'Blocked';
    this.inProgressListName = config.trelloInProgressList || 'Doing';
    this.inReviewListName = config.trelloInReviewList || 'In Review';
  }

  private authUrl(path: string): string {
    const url = new URL(path.startsWith('http') ? path : `${TRELLO_API}${path.startsWith('/') ? path : `/${path}`}`);
    url.searchParams.set('key', this.apiKey || this.token);
    url.searchParams.set('token', this.token);
    return url.toString();
  }

  private async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const url = this.authUrl(path);
    const maxAttempts = 3;
    let lastError: Error | undefined;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const res = await fetch(url, options);

        if (!res.ok) {
          const body = await res.text();
          throw new Error(`Trello API error ${res.status}: ${body}`);
        }

        const text = await res.text();
        if (!text) return undefined as T;
        try {
          return JSON.parse(text) as T;
        } catch {
          throw new Error(`Trello API: expected JSON, got: ${text.slice(0, 200)}`);
        }
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        const isNetworkError =
          lastError.message.includes('fetch failed')
          || lastError.message.includes('ECONNRESET')
          || lastError.message.includes('ETIMEDOUT')
          || lastError.message.includes('UND_ERR_SOCKET');

        if (!isNetworkError || attempt === maxAttempts) {
          const cause = (err as Record<string, unknown>)?.cause;
          const detail = cause instanceof Error
            ? `: ${cause.message}`
            : lastError?.message
              ? `: ${lastError.message}`
              : '';
          throw new Error(`Trello API request failed (${options.method || 'GET'} ${path})${detail}`);
        }

        const delay = attempt * 1000;
        logger.debug(`Fetch attempt ${attempt}/${maxAttempts} failed, retrying in ${delay}ms...`);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }

    throw lastError;
  }

  private async fetchLists(): Promise<TrelloList[]> {
    return this.request<TrelloList[]>(
      `/boards/${encodeURIComponent(this.boardId)}/lists?fields=id,name`
    );
  }

  private findListId(lists: TrelloList[], displayName: string): string {
    const want = displayName.trim().toLowerCase();
    const found = lists.find((l) => l.name.trim().toLowerCase() === want);
    if (!found) {
      const names = lists.map((l) => `"${l.name}"`).join(', ');
      throw new Error(
        `Trello board ${this.boardId}: no list named "${displayName}". Available lists: ${names || '(none)'}`,
      );
    }
    return found.id;
  }

  private listIdToSemantic(listId: string, openListId: string, pendingListId: string): string | null {
    if (listId === openListId) return this.openSemantic.toLowerCase();
    if (listId === pendingListId) return this.pendingSemantic.toLowerCase();
    return null;
  }

  private cardHasLabel(card: TrelloCard): boolean {
    if (this.labelName === '*') return true;
    const want = this.labelName.trim().toLowerCase();
    return card.labels.some((l) => l.name.trim().toLowerCase() === want);
  }

  private async fetchMyMemberId(): Promise<string> {
    const me = await this.request<TrelloMember>('/members/me?fields=id');
    return me.id;
  }

  private async fetchCardAttachments(cardId: string): Promise<DownloadedAttachment[]> {
    interface RawAtt {
      id: string;
      name?: string;
      url?: string;
    }

    const attachments = await this.request<RawAtt[]>(
      `/cards/${encodeURIComponent(cardId)}/attachments?fields=id,name,url`
    );

    const native: NativeAttachment[] = attachments
      .filter((a) => Boolean(a.url))
      .map((a) => ({
        id: a.id,
        name: a.name,
        url: this.attachDownloadUrl(a.url!),
      }));

    return downloadAttachments(cardId, native, {});
  }

  /** Trello attachment URLs may require key/token when the board is private. */
  private attachDownloadUrl(url: string): string {
    try {
      const u = new URL(url);
      if (u.hostname.includes('trello.com')) {
        u.searchParams.set('key', this.apiKey || this.token);
        u.searchParams.set('token', this.token);
      }
      return u.toString();
    } catch {
      return url;
    }
  }

  async fetchTasks(options?: FetchTasksOptions): Promise<Task[]> {
    logger.debug(
      `Fetching Trello cards on board ${this.boardId} with label "${this.labelName}" (assigned to token user)`,
    );
    const skipAttachments = options?.skipAttachments === true;
    const omitDescription = options?.omitDescription === true;

    const [lists, myId] = await Promise.all([this.fetchLists(), this.fetchMyMemberId()]);
    const openListId = this.findListId(lists, this.openListName);
    const pendingListId = this.findListId(lists, this.pendingListName);

    const cards = await this.request<TrelloCard[]>(
      `/boards/${encodeURIComponent(this.boardId)}/cards?fields=id,name,desc,url,idList,idMembers,labels&labels=true`,
    );

    const eligible = cards.filter((c) => {
      if (!c.idMembers.includes(myId)) return false;
      if (!this.cardHasLabel(c)) return false;
      const sem = this.listIdToSemantic(c.idList, openListId, pendingListId);
      return sem !== null;
    });

    return Promise.all(
      eligible.map(async (c) => {
        const sem = this.listIdToSemantic(c.idList, openListId, pendingListId)!;
        let description = omitDescription ? '' : (c.desc || '');
        if (!skipAttachments && !omitDescription) {
          try {
            const attachments = await this.fetchCardAttachments(c.id);
            description = appendAttachmentPaths(description, attachments);
          } catch (err) {
            logger.warn(
              `[${c.id}] Failed to fetch Trello attachments: ${err instanceof Error ? err.message : String(err)}`,
            );
          }
        }

        return {
          id: c.id,
          name: c.name,
          description,
          status: sem,
          url: c.url,
          tags: c.labels.map((l) => l.name),
          sourceListId: c.idList,
        };
      }),
    );
  }

  async fetchTasksByStatus(statuses: string[], _options?: FetchTasksOptions): Promise<Task[]> {
    const normalized = statuses.map((s) => s.toLowerCase());

    const [lists, myId] = await Promise.all([this.fetchLists(), this.fetchMyMemberId()]);

    // Build a map from list ID to semantic status for the requested statuses
    const listIdToStatus = new Map<string, string>();
    for (const status of normalized) {
      let listName: string | null = null;
      if (status === this.openSemantic.toLowerCase()) listName = this.openListName;
      else if (status === this.pendingSemantic.toLowerCase()) listName = this.pendingListName;
      else if (status === this.inReviewSemantic.toLowerCase()) listName = this.inReviewListName;
      else if (status === 'in progress') listName = this.inProgressListName;
      if (listName) {
        try {
          const listId = this.findListId(lists, listName);
          listIdToStatus.set(listId, status);
        } catch {
          // List not found — skip this status
        }
      }
    }

    const cards = await this.request<TrelloCard[]>(
      `/boards/${encodeURIComponent(this.boardId)}/cards?fields=id,name,desc,url,idList,idMembers,labels&labels=true`,
    );

    const eligible = cards.filter((c) => {
      if (!c.idMembers.includes(myId)) return false;
      if (!this.cardHasLabel(c)) return false;
      return listIdToStatus.has(c.idList);
    });

    return eligible.map((c) => ({
      id: c.id,
      name: c.name,
      description: c.desc || '',
      status: listIdToStatus.get(c.idList)!,
      url: c.url,
      tags: c.labels.map((l) => l.name),
      sourceListId: c.idList,
    }));
  }

  async postComment(taskId: string, text: string): Promise<void> {
    logger.debug(`Posting comment to Trello card ${taskId}`);
    const path =
      `/cards/${encodeURIComponent(taskId)}/actions/comments?text=${encodeURIComponent(text)}`;
    await this.request(path, { method: 'POST' });
  }

  async getComments(taskId: string): Promise<Comment[]> {
    logger.debug(`Fetching comments for Trello card ${taskId}`);

    const actions = await this.request<TrelloAction[]>(
      `/cards/${encodeURIComponent(taskId)}/actions?filter=commentCard&fields=id,type,date,data,idMemberCreator&memberCreator=true&memberCreator_fields=fullName,username`,
    );

    const sorted = [...actions].sort(
      (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
    );

    return sorted.map((a) => ({
      id: a.id,
      text: a.data?.text || '',
      author:
        a.memberCreator?.fullName
        || a.memberCreator?.username
        || a.idMemberCreator,
      authorId: a.memberCreator?.id || a.idMemberCreator,
      date: new Date(a.date).getTime(),
    }));
  }

  async fetchAvailableStatuses(): Promise<string[]> {
    const lists = await this.fetchLists();
    return lists.map((l) => l.name);
  }

  async updateStatus(taskId: string, status: string): Promise<void> {
    logger.debug(`Moving Trello card ${taskId} for status "${status}"`);
    const lists = await this.fetchLists();
    const s = status.trim().toLowerCase();

    let targetListName: string;
    if (s === this.pendingSemantic.toLowerCase()) {
      targetListName = this.pendingListName;
    } else if (s === this.openSemantic.toLowerCase()) {
      targetListName = this.openListName;
    } else if (s === 'in progress') {
      targetListName = this.inProgressListName;
    } else if (s === this.inReviewSemantic.toLowerCase()) {
      targetListName = this.inReviewListName;
    } else {
      throw new Error(
        `Trello: unsupported status "${status}". Expected ${this.pendingSemantic}, ${this.openSemantic}, in progress, or ${this.inReviewSemantic}.`,
      );
    }

    const listId = this.findListId(lists, targetListName);
    await this.request(`/cards/${encodeURIComponent(taskId)}?idList=${encodeURIComponent(listId)}`, {
      method: 'PUT',
    });
  }

  async removeTag(taskId: string, tag: string): Promise<void> {
    logger.debug(`Removing label "${tag}" from Trello card ${taskId}`);

    const card = await this.request<{ labels: TrelloLabel[] }>(
      `/cards/${encodeURIComponent(taskId)}?fields=labels`,
    );

    const want = tag.trim().toLowerCase();
    const label = card.labels.find((l) => l.name.trim().toLowerCase() === want);
    if (!label) return;

    await this.request(
      `/cards/${encodeURIComponent(taskId)}/idLabels/${encodeURIComponent(label.id)}`,
      { method: 'DELETE' },
    );
  }

  async fetchBoardTasks(options?: FetchTasksOptions): Promise<Task[]> {
    const boardOpts: FetchTasksOptions = { skipAttachments: true, omitDescription: true, ...options };
    const [lists, myId] = await Promise.all([this.fetchLists(), this.fetchMyMemberId()]);
    const cards = await this.request<TrelloCard[]>(
      `/boards/${encodeURIComponent(this.boardId)}/cards?fields=id,name,desc,url,idList,idMembers,labels&labels=true`,
    );

    const openListId = this.findListId(lists, this.openListName);
    const pendingListId = this.findListId(lists, this.pendingListName);
    let inProgressListId: string | null = null;
    try { inProgressListId = this.findListId(lists, this.inProgressListName); } catch { /* optional */ }
    let reviewListId: string | null = null;
    try { reviewListId = this.findListId(lists, this.inReviewListName); } catch { /* optional */ }

    const byId = new Map<string, Task>();

    // Open/pending/in-progress: apply label filter
    for (const c of cards) {
      if (!c.idMembers.includes(myId)) continue;
      if (!this.cardHasLabel(c)) continue;
      let status: string | null = null;
      if (c.idList === openListId) status = this.openSemantic;
      else if (c.idList === pendingListId) status = this.pendingSemantic;
      else if (inProgressListId && c.idList === inProgressListId) status = 'in progress';
      if (!status) continue;
      byId.set(c.id, {
        id: c.id, name: c.name,
        description: boardOpts.omitDescription ? '' : (c.desc || ''),
        status, url: c.url,
        tags: c.labels.map((l) => l.name),
        sourceListId: c.idList,
      });
    }

    // Review: apply same label filter as other columns
    if (reviewListId) {
      for (const c of cards) {
        if (c.idList !== reviewListId) continue;
        if (!c.idMembers.includes(myId)) continue;
        if (!this.cardHasLabel(c)) continue;
        if (byId.has(c.id)) continue;
        byId.set(c.id, {
          id: c.id, name: c.name,
          description: boardOpts.omitDescription ? '' : (c.desc || ''),
          status: this.inReviewSemantic, url: c.url,
          tags: c.labels.map((l) => l.name),
          sourceListId: c.idList,
        });
      }
    }

    return [...byId.values()];
  }

  async addTag(taskId: string, tag: string): Promise<void> {
    logger.debug(`Adding label "${tag}" to Trello card ${taskId}`);

    const boardLabels = await this.request<TrelloLabel[]>(
      `/boards/${encodeURIComponent(this.boardId)}/labels?fields=id,name`,
    );
    const want = tag.trim().toLowerCase();
    let label = boardLabels.find((l) => l.name.trim().toLowerCase() === want);
    if (!label) {
      label = await this.request<TrelloLabel>(
        `/boards/${encodeURIComponent(this.boardId)}/labels?name=${encodeURIComponent(tag)}&color=null`,
        { method: 'POST' },
      );
    }

    const card = await this.request<{ labels: TrelloLabel[] }>(
      `/cards/${encodeURIComponent(taskId)}?fields=labels`,
    );
    if (card.labels.some((l) => l.id === label!.id)) return;

    await this.request(
      `/cards/${encodeURIComponent(taskId)}/idLabels?value=${encodeURIComponent(label.id)}`,
      { method: 'POST' },
    );
  }

  async createTask(params: CreateTaskParams): Promise<CreateTaskResult> {
    const lists = await this.fetchLists();
    const listId =
      params.listId && /^[a-f0-9]{24}$/i.test(params.listId)
        ? params.listId
        : this.findListId(lists, this.openListName);

    const boardLabels = await this.request<TrelloLabel[]>(
      `/boards/${encodeURIComponent(this.boardId)}/labels?fields=id,name`,
    );

    const labelIds: string[] = [];
    if (this.labelName && this.labelName !== '*') {
      const match = boardLabels.find(
        (l) => l.name.trim().toLowerCase() === this.labelName.trim().toLowerCase(),
      );
      if (match) labelIds.push(match.id);
    }
    for (const tag of params.tags || []) {
      const match = boardLabels.find((l) => l.name.trim().toLowerCase() === tag.trim().toLowerCase());
      if (match && !labelIds.includes(match.id)) labelIds.push(match.id);
    }

    const q = new URLSearchParams({
      name: params.title,
      desc: params.description || '',
      idList: listId,
    });
    if (labelIds.length) {
      q.set('idLabels', labelIds.join(','));
    }

    interface CreateCardResponse {
      id: string;
      url: string;
    }

    const result = await this.request<CreateCardResponse>(`/cards?${q.toString()}`, { method: 'POST' });
    return { id: result.id, url: result.url };
  }
}

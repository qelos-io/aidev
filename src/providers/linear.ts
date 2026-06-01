import { Task, Comment, Config, CreateTaskParams, CreateTaskResult } from '../types';
import { TaskProvider } from './base';
import { logger } from '../logger';

const LINEAR_GRAPHQL = 'https://api.linear.app/graphql';
const SKIP_STATE_TYPES = new Set(['completed', 'canceled']);
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const STATE_TYPE_BY_GENERIC: Record<string, string> = {
  pending: 'backlog',
  backlog: 'backlog',
  todo: 'unstarted',
  open: 'unstarted',
  unstarted: 'unstarted',
  'in progress': 'started',
  started: 'started',
  done: 'completed',
  closed: 'completed',
  completed: 'completed',
  cancelled: 'cancelled',
  canceled: 'cancelled',
};

interface LinearWorkflowState {
  id: string;
  name: string;
  type: string;
}

interface LinearGraphQLError {
  message: string;
  extensions?: {
    userPresentableMessage?: string;
    code?: string;
  };
  path?: Array<string | number>;
}

interface LinearGraphQLResponse<T> {
  data?: T;
  errors?: LinearGraphQLError[];
}

function formatLinearError(e: LinearGraphQLError): string {
  const detail = e.extensions?.userPresentableMessage;
  return detail ? `${e.message} (${detail})` : e.message;
}

export class LinearProvider implements TaskProvider {
  private apiKey: string;
  private teamIdInput: string;
  private resolvedTeamId: string | null = null;
  private label: string;
  private assigneeTag: string;
  private pendingStatus: string;
  private inReviewStatus: string;

  constructor(config: Config) {
    this.apiKey = config.linearApiKey;
    this.teamIdInput = config.linearTeamId;
    this.label = config.linearLabel;
    this.assigneeTag = config.assigneeTag;
    this.pendingStatus = config.linearPendingStatus || 'Pending';
    this.inReviewStatus = config.linearInReviewStatus || 'In Review';
  }

  private async resolveTeamId(): Promise<string> {
    if (this.resolvedTeamId) return this.resolvedTeamId;
    if (!this.teamIdInput) {
      throw new Error('Linear: LINEAR_TEAM_ID is not set');
    }
    if (UUID_REGEX.test(this.teamIdInput)) {
      this.resolvedTeamId = this.teamIdInput;
      return this.resolvedTeamId;
    }
    const query = `
      query Team($id: String!) {
        team(id: $id) { id }
      }
    `;
    const data = await this.graphql<{ team: { id: string } | null }>(query, { id: this.teamIdInput });
    if (!data.team?.id) {
      throw new Error(
        `Linear: could not resolve LINEAR_TEAM_ID "${this.teamIdInput}". Set it to the team UUID or team key.`,
      );
    }
    this.resolvedTeamId = data.team.id;
    return this.resolvedTeamId;
  }

  private async graphql<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
    const res = await fetch(LINEAR_GRAPHQL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: this.apiKey.startsWith('lin_api_') ? this.apiKey : `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({ query, variables }),
    });

    const raw = (await res.json()) as LinearGraphQLResponse<T>;
    if (!res.ok) {
      const msg = raw.errors?.map(formatLinearError).join('; ') || res.statusText;
      throw new Error(`Linear API error ${res.status}: ${msg}`);
    }
    if (raw.errors?.length) {
      throw new Error(`Linear GraphQL errors: ${raw.errors.map(formatLinearError).join('; ')}`);
    }
    if (raw.data === undefined) {
      throw new Error('Linear API returned no data');
    }
    return raw.data;
  }

  private async fetchWorkflowStates(): Promise<LinearWorkflowState[]> {
    const query = `
      query WorkflowStates($filter: WorkflowStateFilter) {
        workflowStates(filter: $filter) {
          nodes {
            id
            name
            type
          }
        }
      }
    `;
    const teamId = await this.resolveTeamId();
    const data = await this.graphql<{
      workflowStates: { nodes: LinearWorkflowState[] };
    }>(query, { filter: { team: { id: { eq: teamId } } } });
    return data.workflowStates.nodes;
  }

  async fetchTasks(_options?: import('../types').FetchTasksOptions): Promise<Task[]> {
    const teamId = await this.resolveTeamId();
    logger.debug(`Fetching Linear issues for team ${teamId} with label "${this.label}"`);

    const query = `
      query Issues($filter: IssueFilter) {
        issues(filter: $filter, first: 100) {
          nodes {
            id
            identifier
            title
            description
            url
            state { id name type }
            priority
            labels { nodes { name } }
          }
        }
      }
    `;
    const filter: Record<string, unknown> = {
      team: { id: { eq: teamId } },
      state: { type: { nin: ['completed', 'canceled'] } },
    };
    if (this.label && this.label !== '*') {
      filter.labels = { some: { name: { eq: this.label } } };
    }

    const data = await this.graphql<{
      issues: {
        nodes: Array<{
          id: string;
          identifier: string;
          title: string;
          description: string | null;
          url: string;
          state: { id: string; name: string; type: string };
          priority: number | null;
          labels: { nodes: Array<{ name: string }> };
        }>;
      };
    }>(query, { filter });

    const skipTypes = new Set(SKIP_STATE_TYPES);
    return data.issues.nodes
      .filter((n) => !skipTypes.has(n.state.type))
      .map((n) => ({
        id: n.identifier,
        name: n.title,
        description: n.description || '',
        status: n.state.name,
        url: n.url,
        tags: n.labels.nodes.map((l) => l.name),
        priority: n.priority ?? undefined,
        sourceListId: teamId,
      }));
  }

  async fetchTasksByStatus(statuses: string[], _options?: import('../types').FetchTasksOptions): Promise<Task[]> {
    const normalized = statuses.map((s) => s.toLowerCase());
    const all = await this.fetchTasks();
    return all.filter((t) => normalized.includes(t.status.toLowerCase()));
  }

  async postComment(taskId: string, text: string): Promise<void> {
    logger.debug(`Posting comment to Linear issue ${taskId}`);

    const issueId = await this.resolveIssueId(taskId);
    const mutation = `
      mutation CreateComment($input: CommentCreateInput!) {
        commentCreate(input: $input) {
          success
          comment { id }
        }
      }
    `;
    await this.graphql<{ commentCreate: { success: boolean } }>(mutation, {
      input: { issueId, body: text },
    });
  }

  async getComments(taskId: string): Promise<Comment[]> {
    logger.debug(`Fetching comments for Linear issue ${taskId}`);

    const issueId = await this.resolveIssueId(taskId);
    const query = `
      query IssueComments($issueId: ID!, $after: String) {
        comments(
          filter: { issue: { id: { eq: $issueId } } }
          first: 250
          after: $after
        ) {
          nodes {
            id
            body
            parentId
            user { name id }
            botActor { name userDisplayName id }
            externalUser { id }
            createdAt
          }
          pageInfo { hasNextPage endCursor }
        }
      }
    `;
    type CommentNode = {
      id: string;
      body: string | null;
      parentId: string | null;
      user: { name: string; id: string } | null;
      botActor: { name: string | null; userDisplayName: string | null; id: string | null } | null;
      externalUser: { id: string } | null;
      createdAt: string;
    };
    type CommentsPage = {
      comments: {
        nodes: CommentNode[];
        pageInfo: { hasNextPage: boolean; endCursor: string | null };
      };
    };

    const authorFromLinearNode = (c: CommentNode): { author: string; authorId: string } => {
      if (c.user?.name) {
        return { author: c.user.name, authorId: c.user.id };
      }
      if (c.externalUser) {
        return { author: 'External user', authorId: c.externalUser.id };
      }
      if (c.botActor?.userDisplayName?.trim()) {
        return {
          author: c.botActor.userDisplayName.trim(),
          authorId: c.botActor.id ?? '',
        };
      }
      if (c.botActor?.name?.trim()) {
        return { author: c.botActor.name.trim(), authorId: c.botActor.id ?? '' };
      }
      return { author: 'Unknown', authorId: '' };
    };

    const all: CommentNode[] = [];
    let after: string | null = null;
    for (;;) {
      const data: CommentsPage = await this.graphql<CommentsPage>(query, { issueId, after });
      const conn = data.comments;
      all.push(...conn.nodes);
      if (!conn.pageInfo.hasNextPage || !conn.pageInfo.endCursor) break;
      after = conn.pageInfo.endCursor;
    }

    const sorted = [...all].sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    );
    return sorted.map((c) => {
      const { author, authorId } = authorFromLinearNode(c);
      return {
        id: c.id,
        text: c.body || '',
        author,
        authorId,
        date: new Date(c.createdAt).getTime(),
      };
    });
  }

  private async resolveIssueId(identifier: string): Promise<string> {
    const match = identifier.match(/^([A-Za-z]+)-(\d+)$/);
    if (match) {
      const teamKey = match[1].toUpperCase();
      const number = Number(match[2]);
      const query = `
        query IssueByIdentifier($filter: IssueFilter) {
          issues(filter: $filter, first: 1) {
            nodes { id }
          }
        }
      `;
      const data = await this.graphql<{ issues: { nodes: Array<{ id: string }> } }>(query, {
        filter: { team: { key: { eq: teamKey } }, number: { eq: number } },
      });
      const id = data.issues?.nodes?.[0]?.id;
      if (id) return id;
    }
    const byIdQuery = `
      query Issue($id: String!) {
        issue(id: $id) {
          id
        }
      }
    `;
    const byId = await this.graphql<{ issue: { id: string } | null }>(byIdQuery, { id: identifier });
    if (byId.issue?.id) return byId.issue.id;
    throw new Error(`Linear: could not resolve issue "${identifier}"`);
  }

  async fetchAvailableStatuses(): Promise<string[]> {
    const states = await this.fetchWorkflowStates();
    const names = states.map((s) => s.name);
    const hasCompleted = states.some((s) => s.type === 'completed');
    if (hasCompleted && !names.some((n) => n.toLowerCase() === 'done')) {
      names.push('done');
    }
    return names;
  }

  async updateStatus(taskId: string, status: string): Promise<void> {
    logger.debug(`Updating Linear issue ${taskId} status to "${status}"`);

    const states = await this.fetchWorkflowStates();
    const key = status.toLowerCase();
    let stateId = states.find((s) => s.name.toLowerCase() === key)?.id;
    if (!stateId) {
      stateId = states.find((s) => s.name.toLowerCase().includes(key))?.id;
    }
    if (!stateId) {
      const targetType = STATE_TYPE_BY_GENERIC[key];
      if (targetType) {
        stateId = states.find((s) => s.type === targetType)?.id;
      }
    }
    if (!stateId) {
      const names = states.map((s) => s.name).join(', ');
      const types = [...new Set(states.map((s) => s.type))].join(', ');
      throw new Error(
        `Linear: no workflow state matching "${status}". Available names: ${names}. Available types: ${types}`,
      );
    }

    const issueId = await this.resolveIssueId(taskId);
    const mutation = `
      mutation IssueUpdate($id: String!, $input: IssueUpdateInput!) {
        issueUpdate(id: $id, input: $input) {
          success
        }
      }
    `;
    await this.graphql<{ issueUpdate: { success: boolean } }>(mutation, {
      id: issueId,
      input: { stateId },
    });
  }

  async removeTag(taskId: string, tag: string): Promise<void> {
    logger.debug(`Removing label "${tag}" from Linear issue ${taskId}`);

    const issueId = await this.resolveIssueId(taskId);
    const query = `
      query IssueLabels($id: String!) {
        issue(id: $id) {
          labels { nodes { id name } }
        }
      }
    `;
    const data = await this.graphql<{
      issue: { labels: { nodes: Array<{ id: string; name: string }> } } | null;
    }>(query, { id: issueId });

    const want = tag.toLowerCase();
    const label = data.issue?.labels.nodes.find((l) => l.name.toLowerCase() === want);
    if (!label) return;

    const mutation = `
      mutation IssueRemoveLabel($id: String!, $labelId: String!) {
        issueRemoveLabel(id: $id, labelId: $labelId) {
          success
        }
      }
    `;
    await this.graphql<{ issueRemoveLabel: { success: boolean } }>(mutation, {
      id: issueId,
      labelId: label.id,
    });
  }

  async fetchBoardTasks(_options?: import('../types').FetchTasksOptions): Promise<Task[]> {
    const teamId = await this.resolveTeamId();
    // Labeled tasks (open/pending/in-progress) — same query as fetchTasks
    const labeled = await this.fetchTasks({ skipAttachments: true, omitDescription: true });
    // Review tasks without label filter
    const reviewName = this.inReviewStatus;
    const query = `
      query ReviewIssues($filter: IssueFilter) {
        issues(filter: $filter, first: 100) {
          nodes {
            id identifier title url
            state { id name type }
            priority
            labels { nodes { name } }
          }
        }
      }
    `;
    let reviewTasks: Task[] = [];
    try {
      const filter: Record<string, unknown> = {
        team: { id: { eq: teamId } },
        state: { name: { eq: reviewName } },
        ...(this.label && this.label !== '*' ? { labels: { some: { name: { eq: this.label } } } } : {}),
      };
      const data = await this.graphql<{
        issues: { nodes: Array<{ id: string; identifier: string; title: string; url: string; state: { name: string; type: string }; priority: number | null; labels: { nodes: Array<{ name: string }> } }> };
      }>(query, { filter });
      reviewTasks = data.issues.nodes.map((n) => ({
        id: n.identifier,
        name: n.title,
        description: '',
        status: n.state.name,
        url: n.url,
        tags: n.labels.nodes.map((l) => l.name),
        priority: n.priority ?? undefined,
        sourceListId: teamId,
      }));
    } catch (err) {
      logger.warn(`Failed to fetch Linear review tasks: ${err instanceof Error ? err.message : err}`);
    }
    const byId = new Map<string, Task>();
    for (const t of labeled) byId.set(t.id, t);
    for (const t of reviewTasks) byId.set(t.id, t);
    return [...byId.values()];
  }

  async addTag(taskId: string, tag: string): Promise<void> {
    logger.debug(`Adding label "${tag}" to Linear issue ${taskId}`);
    const issueId = await this.resolveIssueId(taskId);
    const [labelId] = await this.resolveLabelIds([tag]);
    if (!labelId) return;
    const mutation = `
      mutation IssueAddLabel($id: String!, $labelId: String!) {
        issueAddLabel(id: $id, labelId: $labelId) { success }
      }
    `;
    await this.graphql<{ issueAddLabel: { success: boolean } }>(mutation, { id: issueId, labelId });
  }

  private async fetchTeamLabels(): Promise<Array<{ id: string; name: string }>> {
    const query = `
      query IssueLabels($filter: IssueLabelFilter, $after: String) {
        issueLabels(filter: $filter, first: 250, after: $after) {
          nodes { id name }
          pageInfo { hasNextPage endCursor }
        }
      }
    `;
    type LabelsPage = {
      issueLabels: {
        nodes: Array<{ id: string; name: string }>;
        pageInfo: { hasNextPage: boolean; endCursor: string | null };
      };
    };
    const teamId = await this.resolveTeamId();
    const all: Array<{ id: string; name: string }> = [];
    let after: string | null = null;
    for (;;) {
      const data: LabelsPage = await this.graphql<LabelsPage>(query, {
        filter: { team: { id: { eq: teamId } } },
        after,
      });
      all.push(...data.issueLabels.nodes);
      if (!data.issueLabels.pageInfo.hasNextPage || !data.issueLabels.pageInfo.endCursor) break;
      after = data.issueLabels.pageInfo.endCursor;
    }
    return all;
  }

  private async resolveLabelIds(names: string[]): Promise<string[]> {
    const seen = new Set<string>();
    const wanted: string[] = [];
    for (const name of names) {
      const trimmed = name.trim();
      if (!trimmed) continue;
      const key = trimmed.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      wanted.push(trimmed);
    }
    if (wanted.length === 0) return [];

    const teamId = await this.resolveTeamId();
    let existing = await this.fetchTeamLabels();
    const indexByName = (labels: Array<{ id: string; name: string }>): Map<string, string> => {
      const sorted = [...labels].sort((a, b) => a.name.localeCompare(b.name));
      const map = new Map<string, string>();
      for (const l of sorted) {
        const key = l.name.toLowerCase();
        if (!map.has(key)) map.set(key, l.id);
      }
      return map;
    };
    let byName = indexByName(existing);

    const createMutation = `
      mutation IssueLabelCreate($input: IssueLabelCreateInput!) {
        issueLabelCreate(input: $input) {
          success
          issueLabel { id name }
        }
      }
    `;

    const ids: string[] = [];
    for (const name of wanted) {
      const key = name.toLowerCase();
      const existingId = byName.get(key);
      if (existingId) {
        ids.push(existingId);
        continue;
      }
      try {
        const data = await this.graphql<{
          issueLabelCreate: { success: boolean; issueLabel: { id: string; name: string } | null };
        }>(createMutation, { input: { name, teamId } });
        const created = data.issueLabelCreate?.issueLabel;
        if (!created) {
          throw new Error(`Linear: issueLabelCreate did not return a label for "${name}"`);
        }
        ids.push(created.id);
        existing.push(created);
        byName = indexByName(existing);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (!/already exists/i.test(msg)) throw err;
        existing = await this.fetchTeamLabels();
        byName = indexByName(existing);
        const refetchedId = byName.get(key);
        if (!refetchedId) throw err;
        ids.push(refetchedId);
      }
    }
    return ids;
  }

  private async resolveAssigneeId(): Promise<string | null> {
    const value = this.assigneeTag.trim();
    if (!value) return null;

    const angleMatch = value.match(/<([^>]+)>/);
    const emailCandidate = angleMatch
      ? angleMatch[1].trim()
      : value.includes('@') ? value : '';
    const displayNameCandidate = angleMatch
      ? value.slice(0, angleMatch.index).trim()
      : value.includes('@') ? '' : value;

    const query = `
      query Users($filter: UserFilter) {
        users(filter: $filter, first: 2) {
          nodes { id email displayName }
        }
      }
    `;
    type UsersResponse = {
      users: { nodes: Array<{ id: string; email: string | null; displayName: string | null }> };
    };

    try {
      if (emailCandidate) {
        const data = await this.graphql<UsersResponse>(query, {
          filter: { email: { eq: emailCandidate } },
        });
        const id = data.users.nodes[0]?.id;
        if (id) return id;
      }
      if (displayNameCandidate) {
        const data = await this.graphql<UsersResponse>(query, {
          filter: { displayName: { eq: displayNameCandidate } },
        });
        const id = data.users.nodes[0]?.id;
        if (id) return id;
      }
      logger.warn(`Linear: no user matched assignee "${value}"; creating issue without assignee`);
      return null;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn(`Linear: failed to resolve assignee "${value}" (${msg}); creating issue without assignee`);
      return null;
    }
  }

  async createTask(params: CreateTaskParams): Promise<CreateTaskResult> {
    const teamId = await this.resolveTeamId();
    const mutation = `
      mutation IssueCreate($input: IssueCreateInput!) {
        issueCreate(input: $input) {
          success
          issue { id identifier url }
        }
      }
    `;
    const input: Record<string, unknown> = {
      teamId,
      title: params.title,
      description: params.description || undefined,
    };
    if (params.priority !== undefined) {
      input.priority = params.priority;
    }
    if (params.tags?.length) {
      const labelIds = await this.resolveLabelIds(params.tags);
      if (labelIds.length) {
        input.labelIds = labelIds;
      }
    }
    const assigneeId = await this.resolveAssigneeId();
    if (assigneeId) {
      input.assigneeId = assigneeId;
    }

    const data = await this.graphql<{
      issueCreate: { success: boolean; issue: { id: string; identifier: string; url: string } | null };
    }>(mutation, { input });

    const issue = data.issueCreate?.issue;
    if (!issue) {
      throw new Error('Linear: issueCreate did not return an issue');
    }
    return { id: issue.identifier, url: issue.url };
  }
}

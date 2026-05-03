import { Task, Comment, Config, CreateTaskParams, CreateTaskResult } from '../types';
import { TaskProvider } from './base';
import { logger } from '../logger';

const LINEAR_GRAPHQL = 'https://api.linear.app/graphql';
const SKIP_STATE_TYPES = new Set(['completed', 'canceled']);

interface LinearGraphQLResponse<T> {
  data?: T;
  errors?: Array<{ message: string }>;
}

export class LinearProvider implements TaskProvider {
  private apiKey: string;
  private teamId: string;
  private label: string;
  private assigneeTag: string;
  private pendingStatus: string;
  private inReviewStatus: string;

  constructor(config: Config) {
    this.apiKey = config.linearApiKey;
    this.teamId = config.linearTeamId;
    this.label = config.linearLabel;
    this.assigneeTag = config.assigneeTag;
    this.pendingStatus = config.linearPendingStatus || 'Backlog';
    this.inReviewStatus = config.linearInReviewStatus || 'In Review';
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
      const msg = raw.errors?.map((e) => e.message).join('; ') || res.statusText;
      throw new Error(`Linear API error ${res.status}: ${msg}`);
    }
    if (raw.errors?.length) {
      throw new Error(`Linear GraphQL errors: ${raw.errors.map((e) => e.message).join('; ')}`);
    }
    if (raw.data === undefined) {
      throw new Error('Linear API returned no data');
    }
    return raw.data;
  }

  private async fetchWorkflowStateIds(): Promise<Map<string, string>> {
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
    const data = await this.graphql<{
      workflowStates: { nodes: Array<{ id: string; name: string; type: string }> };
    }>(query, { filter: { team: { id: { eq: this.teamId } } } });

    const byName = new Map<string, string>();
    for (const node of data.workflowStates.nodes) {
      byName.set(node.name.toLowerCase(), node.id);
    }
    return byName;
  }

  async fetchTasks(): Promise<Task[]> {
    logger.debug(`Fetching Linear issues for team ${this.teamId} with label "${this.label}"`);

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
      team: { id: { eq: this.teamId } },
      state: { type: { nin: ['completed', 'canceled'] } },
    };
    if (this.label && this.label !== '*') {
      (filter as Record<string, unknown>).labels = { name: { eq: this.label } };
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
      }));
  }

  async fetchTasksByStatus(statuses: string[]): Promise<Task[]> {
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
      query IssueComments($id: String!) {
        issue(id: $id) {
          comments {
            nodes {
              id
              body
              user { name id }
              createdAt
            }
          }
        }
      }
    `;
    const data = await this.graphql<{
      issue: {
        comments: {
          nodes: Array<{
            id: string;
            body: string | null;
            user: { name: string; id: string } | null;
            createdAt: string;
          }>;
        };
      };
    }>(query, { id: issueId });

    const nodes = data.issue?.comments?.nodes ?? [];
    const sorted = [...nodes].sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    );
    return sorted.map((c) => ({
      id: c.id,
      text: c.body || '',
      author: c.user?.name ?? 'Unknown',
      authorId: c.user?.id ?? '',
      date: new Date(c.createdAt).getTime(),
    }));
  }

  private async resolveIssueId(identifier: string): Promise<string> {
    if (/^[A-Z]+-\d+$/i.test(identifier)) {
      const query = `
        query IssueByIdentifier($filter: IssueFilter) {
          issues(filter: $filter, first: 1) {
            nodes { id }
          }
        }
      `;
      const data = await this.graphql<{ issues: { nodes: Array<{ id: string }> } }>(query, {
        filter: { identifier: { eq: identifier } },
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
    const query = `
      query WorkflowStates($filter: WorkflowStateFilter) {
        workflowStates(filter: $filter) {
          nodes { name }
        }
      }
    `;
    const data = await this.graphql<{
      workflowStates: { nodes: Array<{ name: string }> };
    }>(query, { filter: { team: { id: { eq: this.teamId } } } });
    return data.workflowStates.nodes.map((n) => n.name);
  }

  async updateStatus(taskId: string, status: string): Promise<void> {
    logger.debug(`Updating Linear issue ${taskId} status to "${status}"`);

    const stateIds = await this.fetchWorkflowStateIds();
    const key = status.toLowerCase();
    const stateId = stateIds.get(key) ?? [...stateIds.entries()].find(([name]) => name.includes(key))?.[1];
    if (!stateId) {
      const names = [...stateIds.keys()].join(', ');
      throw new Error(`Linear: no workflow state matching "${status}". Available: ${names}`);
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

  private async fetchTeamLabels(): Promise<Array<{ id: string; name: string }>> {
    const query = `
      query IssueLabels($filter: IssueLabelFilter) {
        issueLabels(filter: $filter, first: 250) {
          nodes { id name }
        }
      }
    `;
    const data = await this.graphql<{
      issueLabels: { nodes: Array<{ id: string; name: string }> };
    }>(query, { filter: { team: { id: { eq: this.teamId } } } });
    return data.issueLabels.nodes;
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
        }>(createMutation, { input: { name, teamId: this.teamId } });
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
      if (value.includes('@')) {
        const data = await this.graphql<UsersResponse>(query, {
          filter: { email: { eq: value } },
        });
        const id = data.users.nodes[0]?.id;
        if (id) return id;
      }
      const data = await this.graphql<UsersResponse>(query, {
        filter: { displayName: { eq: value } },
      });
      const id = data.users.nodes[0]?.id;
      if (id) return id;
      logger.warn(`Linear: no user matched assignee "${value}"; creating issue without assignee`);
      return null;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn(`Linear: failed to resolve assignee "${value}" (${msg}); creating issue without assignee`);
      return null;
    }
  }

  async createTask(params: CreateTaskParams): Promise<CreateTaskResult> {
    const mutation = `
      mutation IssueCreate($input: IssueCreateInput!) {
        issueCreate(input: $input) {
          success
          issue { id identifier url }
        }
      }
    `;
    const input: Record<string, unknown> = {
      teamId: this.teamId,
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

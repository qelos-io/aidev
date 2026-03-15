import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mock } from 'node:test';
import type { Config } from '../types';
import { ClickUpProvider } from '../providers/clickup';
import { JiraProvider } from '../providers/jira';
import { LinearProvider } from '../providers/linear';
import { MondayProvider } from '../providers/monday';

const baseClickUpConfig = {
  clickupApiKey: 'test-key',
  clickupTeamId: 'team1',
  clickupTag: 'aidev',
  assigneeTag: '',
} as unknown as Config;

const baseJiraConfig = {
  jiraBaseUrl: 'https://example.atlassian.net',
  jiraEmail: 'test@example.com',
  jiraApiToken: 'token',
  jiraProject: 'PROJ',
  jiraLabel: 'aidev',
  assigneeTag: '',
} as unknown as Config;

const baseLinearConfig = {
  linearApiKey: 'lin_api_test',
  linearTeamId: 'team-uuid-123',
  linearLabel: 'aidev',
  linearPendingStatus: 'Backlog',
  linearInReviewStatus: 'In Review',
  assigneeTag: '',
} as unknown as Config;

const baseMondayConfig = {
  mondayApiToken: 'test-token',
  mondayBoardId: '12345',
  mondayStatusColumnId: 'status',
  mondayGroupId: 'topics',
  clickupPendingStatus: 'Working on it',
  clickupInReviewStatus: 'Done',
} as unknown as Config;

function jsonResponse(body: unknown) {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    text: async () => JSON.stringify(body),
    json: async () => body,
    arrayBuffer: async () => Buffer.from(JSON.stringify(body)),
  };
}

function binaryResponse(text: string) {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    text: async () => text,
    json: async () => ({ text }),
    arrayBuffer: async () => Buffer.from(text),
  };
}

function mockFetch(body: unknown) {
  mock.method(globalThis, 'fetch', async () => jsonResponse(body));
}

function withTempCwd(fn: (cwd: string) => Promise<void>): Promise<void> {
  const previous = process.cwd();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aidev-provider-test-'));
  process.chdir(tmpDir);

  return fn(tmpDir).finally(() => {
    process.chdir(previous);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
}

function mockJiraCommentsFetch(comments: unknown, attachments: unknown[] = []) {
  mock.method(globalThis, 'fetch', async (input: string | URL | Request) => {
    const url = String(input);
    if (url.includes('?fields=attachment')) {
      return jsonResponse({ fields: { attachment: attachments } });
    }
    return jsonResponse({ comments });
  });
}

// ─── ClickUpProvider.getComments ─────────────────────────────────────────────

describe('ClickUpProvider.fetchTasks', () => {
  afterEach(() => mock.restoreAll());

  it('downloads task attachments and appends local asset paths to the description', async () => {
    await withTempCwd(async (cwd) => {
      mock.method(globalThis, 'fetch', async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        if (url.includes('/team/team1/task')) {
          return jsonResponse({
            tasks: [
              {
                id: 'task1',
                name: 'Task with file',
                description: 'Handle the attached screenshot.',
                status: { status: 'open' },
                priority: { id: '1' },
                url: 'https://app.clickup.com/t/task1',
                tags: [{ name: 'aidev' }],
              },
            ],
          });
        }
        if (url.endsWith('/task/task1')) {
          return jsonResponse({
            attachments: [
              {
                id: 'att1',
                title: 'Screenshot 1.png',
                url: 'https://files.example/screenshot.png',
              },
            ],
          });
        }
        assert.equal(init?.headers instanceof Object ? (init.headers as Record<string, string>).Authorization : undefined, 'test-key');
        return binaryResponse('image-bytes');
      });

      const provider = new ClickUpProvider(baseClickUpConfig);
      const tasks = await provider.fetchTasks();

      assert.equal(tasks.length, 1);
      assert.match(tasks[0].description, /Local asset files/);
      assert.match(tasks[0].description, /\.aidev\/assets\/task1\/att1-Screenshot-1\.png/);
      assert.ok(fs.existsSync(path.join(cwd, '.aidev', 'assets', 'task1', 'att1-Screenshot-1.png')));
    });
  });
});

describe('ClickUpProvider.getComments', () => {
  afterEach(() => mock.restoreAll());

  it('sorts newest-first API response into oldest-first (ascending by date)', async () => {
    mockFetch({
      comments: [
        // ClickUp returns newest first
        { id: '3', comment_text: 'aidev-continue', comment: [], user: { username: 'user', id: 1 }, date: '3000' },
        { id: '2', comment_text: 'Some answer', comment: [], user: { username: 'user', id: 1 }, date: '2000' },
        { id: '1', comment_text: '[aidev] Clarification question', comment: [], user: { username: 'bot', id: 2 }, date: '1000' },
      ],
    });
    const provider = new ClickUpProvider(baseClickUpConfig);
    const comments = await provider.getComments('task1');
    assert.equal(comments[0].text, '[aidev] Clarification question'); // oldest first
    assert.equal(comments[2].text, 'aidev-continue');                  // newest last
  });

  it('uses comment_text when it is a plain string', async () => {
    mockFetch({
      comments: [
        { id: '1', comment_text: 'hello world', comment: [], user: { username: 'user', id: 1 }, date: '1000' },
      ],
    });
    const provider = new ClickUpProvider(baseClickUpConfig);
    const comments = await provider.getComments('task1');
    assert.equal(comments[0].text, 'hello world');
  });

  it('falls back to comment array when comment_text is empty (rich-text editor)', async () => {
    mockFetch({
      comments: [
        {
          id: '1',
          comment_text: '',
          comment: [
            { text: 'aidev-continue', attributes: {} },
            { text: '\n', attributes: { 'block-id': 'abc' } },
          ],
          user: { username: 'user', id: 1 },
          date: '1000',
        },
      ],
    });
    const provider = new ClickUpProvider(baseClickUpConfig);
    const comments = await provider.getComments('task1');
    assert.ok(comments[0].text.includes('aidev-continue'));
  });

  it('returns empty text when both comment_text and comment array are empty', async () => {
    mockFetch({
      comments: [
        { id: '1', comment_text: '', comment: [], user: { username: 'user', id: 1 }, date: '1000' },
      ],
    });
    const provider = new ClickUpProvider(baseClickUpConfig);
    const comments = await provider.getComments('task1');
    assert.equal(comments[0].text, '');
  });

  it('trigger word is detected when newest comment contains it (real-world ordering)', async () => {
    // Simulate ClickUp newest-first response: aidev-continue is newest (highest date)
    // but sits at index 0 in the API response. After sorting it must be last.
    mockFetch({
      comments: [
        { id: '5', comment_text: 'aidev-continue', comment: [], user: { username: 'david', id: 1 }, date: '5000' },
        { id: '4', comment_text: 'User answer here', comment: [], user: { username: 'david', id: 1 }, date: '4000' },
        { id: '3', comment_text: '[aidev] All AI runners failed.', comment: [], user: { username: 'bot', id: 2 }, date: '3000' },
        { id: '2', comment_text: '[aidev] Starting implementation', comment: [], user: { username: 'bot', id: 2 }, date: '2000' },
        { id: '1', comment_text: '[aidev] Clarification question', comment: [], user: { username: 'bot', id: 2 }, date: '1000' },
      ],
    });
    const provider = new ClickUpProvider(baseClickUpConfig);
    const comments = await provider.getComments('task1');
    const last = comments[comments.length - 1];
    assert.ok(last.text.toLowerCase().includes('aidev-continue'));
  });
});

// ─── JiraProvider.getComments ─────────────────────────────────────────────────

describe('JiraProvider.getComments', () => {
  afterEach(() => mock.restoreAll());

  function adfComment(text: string) {
    return {
      type: 'doc',
      version: 1,
      content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
    };
  }

  it('extracts plain text from ADF body', async () => {
    mockJiraCommentsFetch([
      { id: '1', body: adfComment('hello world'), author: { displayName: 'Alice', accountId: 'a1' }, created: '2024-01-01T10:00:00.000Z' },
    ]);
    const provider = new JiraProvider(baseJiraConfig);
    const comments = await provider.getComments('PROJ-1');
    assert.equal(comments[0].text, 'hello world');
  });

  it('sorts out-of-order API response into ascending date order', async () => {
    mockJiraCommentsFetch([
      { id: '3', body: adfComment('aidev-continue'), author: { displayName: 'Alice', accountId: 'a1' }, created: '2024-01-01T12:00:00.000Z' },
      { id: '1', body: adfComment('[aidev] Starting'), author: { displayName: 'bot', accountId: 'b1' }, created: '2024-01-01T10:00:00.000Z' },
      { id: '2', body: adfComment('User reply'), author: { displayName: 'Alice', accountId: 'a1' }, created: '2024-01-01T11:00:00.000Z' },
    ]);
    const provider = new JiraProvider(baseJiraConfig);
    const comments = await provider.getComments('PROJ-1');
    assert.equal(comments[0].text, '[aidev] Starting');  // oldest first
    assert.equal(comments[2].text, 'aidev-continue');     // newest last
  });

  it('trigger word is detected when newest comment contains it', async () => {
    mockJiraCommentsFetch([
      { id: '1', body: adfComment('[aidev] Clarification needed'), author: { displayName: 'bot', accountId: 'b1' }, created: '2024-01-01T10:00:00.000Z' },
      { id: '2', body: adfComment('aidev-continue'), author: { displayName: 'Alice', accountId: 'a1' }, created: '2024-01-01T11:00:00.000Z' },
    ]);
    const provider = new JiraProvider(baseJiraConfig);
    const comments = await provider.getComments('PROJ-1');
    const last = comments[comments.length - 1];
    assert.ok(last.text.toLowerCase().includes('aidev-continue'));
  });

  it('appends local asset paths when a comment links a native Jira attachment', async () => {
    await withTempCwd(async (cwd) => {
      mock.method(globalThis, 'fetch', async (input: string | URL | Request) => {
        const url = String(input);
        if (url.includes('?fields=attachment')) {
          return jsonResponse({
            fields: {
              attachment: [
                {
                  id: '101',
                  filename: 'trace.json',
                  content: 'https://example.atlassian.net/rest/api/3/attachment/content/101',
                },
              ],
            },
          });
        }
        if (url.endsWith('/comment')) {
          return jsonResponse({
            comments: [
              {
                id: '1',
                body: {
                  type: 'doc',
                  version: 1,
                  content: [
                    {
                      type: 'paragraph',
                      content: [
                        { type: 'text', text: 'Please inspect ' },
                        {
                          type: 'text',
                          text: 'the trace',
                          marks: [
                            {
                              type: 'link',
                              attrs: {
                                href: 'https://example.atlassian.net/rest/api/3/attachment/content/101',
                              },
                            },
                          ],
                        },
                      ],
                    },
                  ],
                },
                author: { displayName: 'Alice', accountId: 'a1' },
                created: '2024-01-01T10:00:00.000Z',
              },
            ],
          });
        }
        return binaryResponse('{"trace":true}');
      });

      const provider = new JiraProvider(baseJiraConfig);
      const comments = await provider.getComments('PROJ-1');

      assert.match(comments[0].text, /Local asset files referenced by this comment/);
      assert.match(comments[0].text, /\.aidev\/assets\/PROJ-1\/101-trace\.json/);
      assert.ok(fs.existsSync(path.join(cwd, '.aidev', 'assets', 'PROJ-1', '101-trace.json')));
    });
  });
});

describe('JiraProvider.fetchTasks', () => {
  afterEach(() => mock.restoreAll());

  it('downloads issue attachments and appends local asset paths to the description', async () => {
    await withTempCwd(async (cwd) => {
      mock.method(globalThis, 'fetch', async (input: string | URL | Request) => {
        const url = String(input);
        if (url.includes('/search/jql')) {
          return jsonResponse({
            issues: [
              {
                id: '1001',
                key: 'PROJ-1',
                fields: {
                  summary: 'Handle uploaded trace',
                  description: {
                    type: 'doc',
                    version: 1,
                    content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Review the trace file.' }] }],
                  },
                  status: { name: 'Open' },
                  priority: { id: '2' },
                  labels: ['aidev'],
                  self: 'https://example.atlassian.net/rest/api/3/issue/1001',
                  attachment: [
                    {
                      id: '101',
                      filename: 'trace.json',
                      content: 'https://example.atlassian.net/rest/api/3/attachment/content/101',
                    },
                  ],
                },
              },
            ],
          });
        }
        return binaryResponse('{"trace":true}');
      });

      const provider = new JiraProvider(baseJiraConfig);
      const tasks = await provider.fetchTasks();

      assert.equal(tasks.length, 1);
      assert.match(tasks[0].description, /Local asset files/);
      assert.match(tasks[0].description, /\.aidev\/assets\/PROJ-1\/101-trace\.json/);
      assert.ok(fs.existsSync(path.join(cwd, '.aidev', 'assets', 'PROJ-1', '101-trace.json')));
    });
  });
});

// ─── LinearProvider ─────────────────────────────────────────────────────────

describe('LinearProvider.fetchTasks', () => {
  afterEach(() => mock.restoreAll());

  it('returns issues with identifier as id and state name as status', async () => {
    mock.method(globalThis, 'fetch', async (_url: string | URL | Request, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(init.body as string) : {};
      if (body.query?.includes('workflowStates')) {
        return jsonResponse({
          data: { workflowStates: { nodes: [{ id: 's1', name: 'Backlog', type: 'unstarted' }, { id: 's2', name: 'In Review', type: 'started' }] } },
        });
      }
      if (body.query?.includes('issues')) {
        return jsonResponse({
          data: {
            issues: {
              nodes: [
                {
                  id: 'issue-uuid-1',
                  identifier: 'ENG-42',
                  title: 'Fix login',
                  description: 'Fix the login flow.',
                  url: 'https://linear.app/org/issue/ENG-42',
                  state: { id: 's1', name: 'Backlog', type: 'unstarted' },
                  priority: 2,
                  labels: { nodes: [{ name: 'aidev' }] },
                },
              ],
            },
          },
        });
      }
      return jsonResponse({ data: {} });
    });

    const provider = new LinearProvider(baseLinearConfig);
    const tasks = await provider.fetchTasks();

    assert.equal(tasks.length, 1);
    assert.equal(tasks[0].id, 'ENG-42');
    assert.equal(tasks[0].name, 'Fix login');
    assert.equal(tasks[0].description, 'Fix the login flow.');
    assert.equal(tasks[0].status, 'Backlog');
    assert.equal(tasks[0].url, 'https://linear.app/org/issue/ENG-42');
    assert.deepEqual(tasks[0].tags, ['aidev']);
    assert.equal(tasks[0].priority, 2);
  });
});

describe('LinearProvider.getComments', () => {
  afterEach(() => mock.restoreAll());

  it('returns comments sorted ascending by date', async () => {
    mock.method(globalThis, 'fetch', async (_url: string | URL | Request, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(init.body as string) : {};
      if (body.query?.includes('issues') && body.variables?.filter?.identifier) {
        return jsonResponse({ data: { issues: { nodes: [{ id: 'issue-uuid-1' }] } } });
      }
      if (body.query?.includes('issue(id:')) {
        return jsonResponse({
          data: {
            issue: {
              comments: {
                nodes: [
                  { id: 'c1', body: '[aidev] Starting', user: { name: 'Bot', id: 'u1' }, createdAt: '2024-01-01T10:00:00.000Z' },
                  { id: 'c2', body: 'aidev-continue', user: { name: 'Alice', id: 'u2' }, createdAt: '2024-01-01T11:00:00.000Z' },
                ],
              },
            },
          },
        });
      }
      return jsonResponse({ data: {} });
    });

    const provider = new LinearProvider(baseLinearConfig);
    const comments = await provider.getComments('ENG-42');

    assert.equal(comments.length, 2);
    assert.equal(comments[0].text, '[aidev] Starting');
    assert.equal(comments[1].text, 'aidev-continue');
    assert.equal(comments[1].author, 'Alice');
  });
});

// ─── MondayProvider ───────────────────────────────────────────────────────────

describe('MondayProvider.fetchTasks', () => {
  afterEach(() => mock.restoreAll());

  it('returns items whose status matches pending or in-review', async () => {
    mock.method(globalThis, 'fetch', async (_input: string | URL | Request, init?: RequestInit) => {
      const body = typeof (init?.body) === 'string' ? JSON.parse(init.body) : {};
      const query = body.query as string;
      if (query.includes('boards') && query.includes('items_page')) {
        return jsonResponse({
          data: {
            boards: [
              {
                items_page: {
                  cursor: null,
                  items: [
                    {
                      id: '1001',
                      name: 'Task one',
                      url: 'https://example.monday.com/boards/12345/pulses/1001',
                      description: { description: 'Do something' },
                      column_values: [
                        { id: 'status', value: '{"label":"Working on it"}', text: 'Working on it' },
                      ],
                    },
                    {
                      id: '1002',
                      name: 'Task two',
                      url: 'https://example.monday.com/boards/12345/pulses/1002',
                      description: { description: '' },
                      column_values: [
                        { id: 'status', value: '{"label":"Done"}', text: 'Done' },
                      ],
                    },
                    {
                      id: '1003',
                      name: 'Task three',
                      url: '',
                      description: {},
                      column_values: [
                        { id: 'status', value: '{}', text: 'Stuck' },
                      ],
                    },
                  ],
                },
              },
            ],
          },
        });
      }
      return jsonResponse({});
    });

    const provider = new MondayProvider(baseMondayConfig);
    const tasks = await provider.fetchTasks();

    assert.equal(tasks.length, 2);
    assert.equal(tasks[0].id, '1001');
    assert.equal(tasks[0].name, 'Task one');
    assert.equal(tasks[0].status, 'Working on it');
    assert.equal(tasks[1].id, '1002');
    assert.equal(tasks[1].status, 'Done');
  });
});

describe('MondayProvider.getComments', () => {
  afterEach(() => mock.restoreAll());

  it('returns updates sorted ascending by date', async () => {
    mock.method(globalThis, 'fetch', async () =>
      jsonResponse({
        data: {
          items: [
            {
              updates: [
                { id: 'u2', text_body: 'Newest', body: '<p>Newest</p>', created_at: '2024-01-02T12:00:00Z', creator: { id: 'u1', name: 'Alice' } },
                { id: 'u1', text_body: 'Oldest', body: '<p>Oldest</p>', created_at: '2024-01-01T10:00:00Z', creator: { id: 'u1', name: 'Alice' } },
              ],
            },
          ],
        },
      })
    );

    const provider = new MondayProvider(baseMondayConfig);
    const comments = await provider.getComments('1001');

    assert.equal(comments.length, 2);
    assert.equal(comments[0].text, 'Oldest');
    assert.equal(comments[1].text, 'Newest');
  });
});

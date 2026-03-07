import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mock } from 'node:test';
import type { Config } from '../types';
import { ClickUpProvider } from '../providers/clickup';
import { JiraProvider } from '../providers/jira';

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

function mockFetch(body: unknown) {
  mock.method(globalThis, 'fetch', async () => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify(body),
    json: async () => body,
  }));
}

// ─── ClickUpProvider.getComments ─────────────────────────────────────────────

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
    mockFetch({
      comments: [
        { id: '1', body: adfComment('hello world'), author: { displayName: 'Alice', accountId: 'a1' }, created: '2024-01-01T10:00:00.000Z' },
      ],
    });
    const provider = new JiraProvider(baseJiraConfig);
    const comments = await provider.getComments('PROJ-1');
    assert.equal(comments[0].text, 'hello world');
  });

  it('sorts out-of-order API response into ascending date order', async () => {
    mockFetch({
      comments: [
        { id: '3', body: adfComment('aidev-continue'), author: { displayName: 'Alice', accountId: 'a1' }, created: '2024-01-01T12:00:00.000Z' },
        { id: '1', body: adfComment('[aidev] Starting'), author: { displayName: 'bot', accountId: 'b1' }, created: '2024-01-01T10:00:00.000Z' },
        { id: '2', body: adfComment('User reply'), author: { displayName: 'Alice', accountId: 'a1' }, created: '2024-01-01T11:00:00.000Z' },
      ],
    });
    const provider = new JiraProvider(baseJiraConfig);
    const comments = await provider.getComments('PROJ-1');
    assert.equal(comments[0].text, '[aidev] Starting');  // oldest first
    assert.equal(comments[2].text, 'aidev-continue');     // newest last
  });

  it('trigger word is detected when newest comment contains it', async () => {
    mockFetch({
      comments: [
        { id: '1', body: adfComment('[aidev] Clarification needed'), author: { displayName: 'bot', accountId: 'b1' }, created: '2024-01-01T10:00:00.000Z' },
        { id: '2', body: adfComment('aidev-continue'), author: { displayName: 'Alice', accountId: 'a1' }, created: '2024-01-01T11:00:00.000Z' },
      ],
    });
    const provider = new JiraProvider(baseJiraConfig);
    const comments = await provider.getComments('PROJ-1');
    const last = comments[comments.length - 1];
    assert.ok(last.text.toLowerCase().includes('aidev-continue'));
  });
});

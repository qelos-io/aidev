import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  LocalProvider,
  ensureTaskFolders,
  tasksRoot,
  parseFrontmatter,
  renderFrontmatter,
  parseSession,
  renderSessionEntry,
} from '../providers/local';

function withTmpDir(fn: (dir: string) => void): void {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aidev-local-test-'));
  try {
    fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function writeTask(baseDir: string, folder: string, filename: string, content: string): void {
  const dir = path.join(tasksRoot(baseDir), folder);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, filename), content, 'utf8');
}

function writeSession(baseDir: string, folder: string, filename: string, content: string): void {
  const dir = path.join(tasksRoot(baseDir), folder);
  fs.writeFileSync(path.join(dir, filename), content, 'utf8');
}

const sampleTask = `---
title: Fix login bug
priority: 2
assignee: david
tags: frontend, auth
created: 2026-03-12T10:00:00.000Z
---

The login form should redirect to the dashboard after authentication.
`;

const sampleSession = `<!-- aidev session log -->

---

## aidev — 2026-03-12T10:05:00.000Z

[aidev] Starting implementation on branch \`a1b2c3d4/fix-login-bug\`

---

## david — 2026-03-12T10:10:00.000Z

Please use the new auth API endpoint.
`;

// ─── ensureTaskFolders ───────────────────────────────────────────────────────

describe('ensureTaskFolders', () => {
  it('creates all status folders under .aidev/tasks/', () => {
    withTmpDir((dir) => {
      ensureTaskFolders(dir);
      for (const folder of ['open', 'pending', 'progress', 'review', 'done']) {
        const p = path.join(dir, '.aidev', 'tasks', folder);
        assert.ok(fs.existsSync(p), `Missing folder: ${folder}`);
        assert.ok(fs.statSync(p).isDirectory());
      }
    });
  });

  it('is idempotent — does not fail if folders already exist', () => {
    withTmpDir((dir) => {
      ensureTaskFolders(dir);
      assert.doesNotThrow(() => ensureTaskFolders(dir));
    });
  });
});

// ─── parseFrontmatter ────────────────────────────────────────────────────────

describe('parseFrontmatter', () => {
  it('parses YAML frontmatter and body from task content', () => {
    const { meta, body } = parseFrontmatter(sampleTask);
    assert.equal(meta.title, 'Fix login bug');
    assert.equal(meta.priority, '2');
    assert.equal(meta.assignee, 'david');
    assert.equal(meta.tags, 'frontend, auth');
    assert.ok(body.includes('login form'));
  });

  it('returns empty meta and full body when no frontmatter present', () => {
    const { meta, body } = parseFrontmatter('Just a plain description.');
    assert.deepEqual(meta, {});
    assert.equal(body, 'Just a plain description.');
  });

  it('handles frontmatter with no body', () => {
    const { meta, body } = parseFrontmatter('---\ntitle: Test\n---\n');
    assert.equal(meta.title, 'Test');
    assert.equal(body, '');
  });

  it('handles values containing colons', () => {
    const { meta } = parseFrontmatter('---\nurl: https://example.com\n---\n');
    assert.equal(meta.url, 'https://example.com');
  });
});

// ─── renderFrontmatter ──────────────────────────────────────────────────────

describe('renderFrontmatter', () => {
  it('renders frontmatter and body', () => {
    const result = renderFrontmatter({ title: 'Test', priority: '1' }, 'Description here.');
    assert.ok(result.startsWith('---\n'));
    assert.ok(result.includes('title: Test'));
    assert.ok(result.includes('priority: 1'));
    assert.ok(result.includes('Description here.'));
  });

  it('omits empty-value keys', () => {
    const result = renderFrontmatter({ title: 'Test', empty: '' }, 'Body');
    assert.ok(!result.includes('empty'));
  });

  it('round-trips through parseFrontmatter', () => {
    const original = { title: 'Round trip', priority: '3' };
    const body = 'Some body text.';
    const rendered = renderFrontmatter(original, body);
    const { meta, body: parsedBody } = parseFrontmatter(rendered);
    assert.equal(meta.title, 'Round trip');
    assert.equal(meta.priority, '3');
    assert.equal(parsedBody, body);
  });
});

// ─── parseSession ────────────────────────────────────────────────────────────

describe('parseSession', () => {
  it('parses session entries with author and timestamp', () => {
    const comments = parseSession(sampleSession);
    assert.equal(comments.length, 2);
    assert.equal(comments[0].author, 'aidev');
    assert.ok(comments[0].text.includes('[aidev] Starting implementation'));
    assert.equal(comments[1].author, 'david');
    assert.ok(comments[1].text.includes('new auth API'));
  });

  it('returns empty array for empty content', () => {
    assert.deepEqual(parseSession(''), []);
    assert.deepEqual(parseSession('   '), []);
  });

  it('parses entries without timestamp', () => {
    const content = '---\n\n## david\n\nSome comment text.\n';
    const comments = parseSession(content);
    assert.equal(comments.length, 1);
    assert.equal(comments[0].author, 'david');
    assert.equal(comments[0].text, 'Some comment text.');
  });

  it('parses entries with ISO timestamp', () => {
    const content = '---\n\n## bot — 2026-01-15T08:30:00.000Z\n\nHello world\n';
    const comments = parseSession(content);
    assert.equal(comments.length, 1);
    assert.equal(comments[0].author, 'bot');
    assert.equal(comments[0].date, new Date('2026-01-15T08:30:00.000Z').getTime());
  });

  it('handles multiple entries separated by ---', () => {
    const content = [
      '---',
      '',
      '## alice — 2026-01-01T00:00:00.000Z',
      '',
      'First comment.',
      '',
      '---',
      '',
      '## bob — 2026-01-02T00:00:00.000Z',
      '',
      'Second comment.',
    ].join('\n');
    const comments = parseSession(content);
    assert.equal(comments.length, 2);
    assert.equal(comments[0].author, 'alice');
    assert.equal(comments[1].author, 'bob');
  });
});

// ─── renderSessionEntry ─────────────────────────────────────────────────────

describe('renderSessionEntry', () => {
  it('produces a parseable session entry', () => {
    const entry = renderSessionEntry('aidev', '[aidev] Test comment');
    assert.ok(entry.includes('## aidev —'));
    assert.ok(entry.includes('[aidev] Test comment'));

    const comments = parseSession(entry);
    assert.equal(comments.length, 1);
    assert.equal(comments[0].author, 'aidev');
    assert.equal(comments[0].text, '[aidev] Test comment');
  });
});

// ─── LocalProvider.fetchTasks ────────────────────────────────────────────────

describe('LocalProvider.fetchTasks', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aidev-local-fetch-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns empty array when no tasks exist', async () => {
    const provider = new LocalProvider(tmpDir);
    const tasks = await provider.fetchTasks();
    assert.equal(tasks.length, 0);
  });

  it('reads a task from the open folder', async () => {
    writeTask(tmpDir, 'open', 'a1b2c3d4-fix-login-bug.md', sampleTask);
    const provider = new LocalProvider(tmpDir);
    const tasks = await provider.fetchTasks();
    assert.equal(tasks.length, 1);
    assert.equal(tasks[0].id, 'a1b2c3d4');
    assert.equal(tasks[0].name, 'Fix login bug');
    assert.equal(tasks[0].status, 'open');
    assert.deepEqual(tasks[0].tags, ['frontend', 'auth']);
    assert.ok(tasks[0].description.includes('login form'));
  });

  it('maps folder names to correct status strings', async () => {
    writeTask(tmpDir, 'open', 'aaaa0001-t1.md', '---\ntitle: T1\n---\n');
    writeTask(tmpDir, 'pending', 'aaaa0002-t2.md', '---\ntitle: T2\n---\n');
    writeTask(tmpDir, 'progress', 'aaaa0003-t3.md', '---\ntitle: T3\n---\n');
    writeTask(tmpDir, 'review', 'aaaa0004-t4.md', '---\ntitle: T4\n---\n');
    writeTask(tmpDir, 'done', 'aaaa0005-t5.md', '---\ntitle: T5\n---\n');

    const provider = new LocalProvider(tmpDir);
    const tasks = await provider.fetchTasks();
    const statusMap = new Map(tasks.map((t) => [t.id, t.status]));

    assert.equal(statusMap.get('aaaa0001'), 'open');
    assert.equal(statusMap.get('aaaa0002'), 'pending');
    assert.equal(statusMap.get('aaaa0003'), 'in progress');
    assert.equal(statusMap.get('aaaa0004'), 'review');
    assert.equal(statusMap.get('aaaa0005'), 'done');
  });

  it('ignores session files when listing tasks', async () => {
    writeTask(tmpDir, 'open', 'a1b2c3d4-task.md', '---\ntitle: Task\n---\n');
    writeSession(tmpDir, 'open', 'a1b2c3d4-task.session.md', sampleSession);

    const provider = new LocalProvider(tmpDir);
    const tasks = await provider.fetchTasks();
    assert.equal(tasks.length, 1);
  });

  it('uses filename as fallback name when title is missing', async () => {
    writeTask(tmpDir, 'open', 'a1b2c3d4-some-task.md', 'No frontmatter here.');

    const provider = new LocalProvider(tmpDir);
    const tasks = await provider.fetchTasks();
    assert.equal(tasks[0].name, 'a1b2c3d4-some-task');
  });
});

// ─── LocalProvider.postComment ───────────────────────────────────────────────

describe('LocalProvider.postComment', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aidev-local-comment-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates a session file when none exists', async () => {
    writeTask(tmpDir, 'open', 'a1b2c3d4-task.md', '---\ntitle: Task\n---\n');
    const provider = new LocalProvider(tmpDir);

    await provider.postComment('a1b2c3d4', '[aidev] Starting');

    const sessionPath = path.join(tasksRoot(tmpDir), 'open', 'a1b2c3d4-task.session.md');
    assert.ok(fs.existsSync(sessionPath));
    const content = fs.readFileSync(sessionPath, 'utf8');
    assert.ok(content.includes('[aidev] Starting'));
    assert.ok(content.includes('## aidev'));
  });

  it('appends to an existing session file', async () => {
    writeTask(tmpDir, 'open', 'a1b2c3d4-task.md', '---\ntitle: Task\n---\n');
    writeSession(tmpDir, 'open', 'a1b2c3d4-task.session.md', sampleSession);

    const provider = new LocalProvider(tmpDir);
    await provider.postComment('a1b2c3d4', '[aidev] Done!');

    const content = fs.readFileSync(
      path.join(tasksRoot(tmpDir), 'open', 'a1b2c3d4-task.session.md'),
      'utf8'
    );
    assert.ok(content.includes('[aidev] Done!'));
    assert.ok(content.includes('new auth API')); // original content preserved
  });

  it('throws when task ID is not found', async () => {
    const provider = new LocalProvider(tmpDir);
    await assert.rejects(
      () => provider.postComment('nonexistent', 'Hello'),
      /Local task not found/
    );
  });
});

// ─── LocalProvider.getComments ───────────────────────────────────────────────

describe('LocalProvider.getComments', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aidev-local-getcomments-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns empty array when no session file exists', async () => {
    writeTask(tmpDir, 'open', 'a1b2c3d4-task.md', '---\ntitle: Task\n---\n');
    const provider = new LocalProvider(tmpDir);
    const comments = await provider.getComments('a1b2c3d4');
    assert.deepEqual(comments, []);
  });

  it('parses comments from session file', async () => {
    writeTask(tmpDir, 'open', 'a1b2c3d4-task.md', '---\ntitle: Task\n---\n');
    writeSession(tmpDir, 'open', 'a1b2c3d4-task.session.md', sampleSession);

    const provider = new LocalProvider(tmpDir);
    const comments = await provider.getComments('a1b2c3d4');
    assert.equal(comments.length, 2);
    assert.equal(comments[0].author, 'aidev');
    assert.equal(comments[1].author, 'david');
  });

  it('returns empty array when task ID is not found', async () => {
    const provider = new LocalProvider(tmpDir);
    const comments = await provider.getComments('nonexistent');
    assert.deepEqual(comments, []);
  });
});

// ─── LocalProvider.updateStatus ──────────────────────────────────────────────

describe('LocalProvider.updateStatus', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aidev-local-status-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('moves task file to the target status folder', async () => {
    writeTask(tmpDir, 'open', 'a1b2c3d4-task.md', '---\ntitle: Task\n---\n');
    const provider = new LocalProvider(tmpDir);

    await provider.updateStatus('a1b2c3d4', 'in progress');

    assert.ok(!fs.existsSync(path.join(tasksRoot(tmpDir), 'open', 'a1b2c3d4-task.md')));
    assert.ok(fs.existsSync(path.join(tasksRoot(tmpDir), 'progress', 'a1b2c3d4-task.md')));
  });

  it('also moves the session file', async () => {
    writeTask(tmpDir, 'open', 'a1b2c3d4-task.md', '---\ntitle: Task\n---\n');
    writeSession(tmpDir, 'open', 'a1b2c3d4-task.session.md', sampleSession);
    const provider = new LocalProvider(tmpDir);

    await provider.updateStatus('a1b2c3d4', 'review');

    assert.ok(!fs.existsSync(path.join(tasksRoot(tmpDir), 'open', 'a1b2c3d4-task.session.md')));
    assert.ok(fs.existsSync(path.join(tasksRoot(tmpDir), 'review', 'a1b2c3d4-task.session.md')));
  });

  it('is a no-op when task is already in the target folder', async () => {
    writeTask(tmpDir, 'review', 'a1b2c3d4-task.md', '---\ntitle: Task\n---\n');
    const provider = new LocalProvider(tmpDir);

    await provider.updateStatus('a1b2c3d4', 'review');

    assert.ok(fs.existsSync(path.join(tasksRoot(tmpDir), 'review', 'a1b2c3d4-task.md')));
  });

  it('maps "done", "closed", "cancelled", "complete" to done folder', async () => {
    for (const status of ['done', 'closed', 'cancelled', 'complete']) {
      const id = `aa00${status.slice(0, 4)}`;
      writeTask(tmpDir, 'open', `${id}-task.md`, `---\ntitle: ${status} test\n---\n`);
      const provider = new LocalProvider(tmpDir);
      await provider.updateStatus(id, status);
      assert.ok(
        fs.existsSync(path.join(tasksRoot(tmpDir), 'done', `${id}-task.md`)),
        `Status "${status}" should map to done folder`
      );
    }
  });

  it('throws when task ID is not found', async () => {
    const provider = new LocalProvider(tmpDir);
    await assert.rejects(
      () => provider.updateStatus('nonexistent', 'done'),
      /Local task not found/
    );
  });
});

// ─── LocalProvider.createTask ────────────────────────────────────────────────

describe('LocalProvider.createTask', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aidev-local-create-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates a task file in the open folder', async () => {
    const provider = new LocalProvider(tmpDir);
    const result = await provider.createTask({
      title: 'New feature',
      description: 'Build the new feature.',
      tags: ['backend'],
    });

    assert.ok(result.id);
    assert.ok(result.url.includes('.aidev'));
    assert.ok(fs.existsSync(result.url));

    const content = fs.readFileSync(result.url, 'utf8');
    const { meta, body } = parseFrontmatter(content);
    assert.equal(meta.title, 'New feature');
    assert.equal(meta.tags, 'backend');
    assert.ok(meta.created);
    assert.ok(body.includes('Build the new feature.'));
  });

  it('slugifies the title for the filename', async () => {
    const provider = new LocalProvider(tmpDir);
    const result = await provider.createTask({
      title: 'Fix Bug #123: Login Page',
      description: '',
      tags: [],
    });

    assert.ok(result.url.includes('fix-bug-123-login-page'));
  });

  it('includes priority and due_date when provided', async () => {
    const provider = new LocalProvider(tmpDir);
    const result = await provider.createTask({
      title: 'Urgent task',
      description: '',
      tags: [],
      priority: 1,
      dueDate: new Date('2026-04-01').getTime(),
    });

    const content = fs.readFileSync(result.url, 'utf8');
    const { meta } = parseFrontmatter(content);
    assert.equal(meta.priority, '1');
    assert.equal(meta.due_date, '2026-04-01');
  });

  it('new task is discoverable via fetchTasks', async () => {
    const provider = new LocalProvider(tmpDir);
    await provider.createTask({
      title: 'Discoverable task',
      description: 'Test discovery.',
      tags: ['test'],
    });

    const tasks = await provider.fetchTasks();
    assert.equal(tasks.length, 1);
    assert.equal(tasks[0].name, 'Discoverable task');
    assert.equal(tasks[0].status, 'open');
  });
});

// ─── Full lifecycle ──────────────────────────────────────────────────────────

describe('LocalProvider full lifecycle', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aidev-local-lifecycle-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('create → comment → updateStatus → getComments round-trip', async () => {
    const provider = new LocalProvider(tmpDir);

    const { id } = await provider.createTask({
      title: 'Lifecycle test',
      description: 'Test the full lifecycle.',
      tags: ['test'],
    });

    await provider.postComment(id, '[aidev] Starting implementation');
    await provider.updateStatus(id, 'in progress');

    let tasks = await provider.fetchTasks();
    const task = tasks.find((t) => t.id === id);
    assert.ok(task);
    assert.equal(task!.status, 'in progress');

    const comments = await provider.getComments(id);
    assert.equal(comments.length, 1);
    assert.ok(comments[0].text.includes('[aidev] Starting'));

    await provider.postComment(id, '[aidev] Implementation complete!');
    await provider.updateStatus(id, 'review');

    tasks = await provider.fetchTasks();
    const updated = tasks.find((t) => t.id === id);
    assert.equal(updated!.status, 'review');

    const allComments = await provider.getComments(id);
    assert.equal(allComments.length, 2);
  });
});

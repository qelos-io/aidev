import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { Task, Comment, CreateTaskParams, CreateTaskResult } from '../types';
import { TaskProvider } from './base';
import { logger } from '../logger';

const TASK_FOLDERS = ['open', 'pending', 'progress', 'review', 'done'] as const;
type TaskFolder = typeof TASK_FOLDERS[number];

const STATUS_TO_FOLDER: Record<string, TaskFolder> = {
  'open': 'open',
  'pending': 'pending',
  'in progress': 'progress',
  'review': 'review',
  'done': 'done',
  'closed': 'done',
  'cancelled': 'done',
  'complete': 'done',
};

const FOLDER_TO_STATUS: Record<TaskFolder, string> = {
  'open': 'open',
  'pending': 'pending',
  'progress': 'in progress',
  'review': 'review',
  'done': 'done',
};

export function tasksRoot(baseDir = process.cwd()): string {
  return path.join(baseDir, '.aidev', 'tasks');
}

export function ensureTaskFolders(baseDir = process.cwd()): void {
  for (const folder of TASK_FOLDERS) {
    fs.mkdirSync(path.join(tasksRoot(baseDir), folder), { recursive: true });
  }
}

// ─── Frontmatter parser ────────────────────────────────────────────────────────

interface FrontmatterResult {
  meta: Record<string, string>;
  body: string;
}

export function parseFrontmatter(content: string): FrontmatterResult {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return { meta: {}, body: content.trim() };

  const meta: Record<string, string> = {};
  for (const line of match[1].split(/\r?\n/)) {
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const val = line.slice(idx + 1).trim();
    if (key) meta[key] = val;
  }

  return { meta, body: match[2].trim() };
}

export function renderFrontmatter(meta: Record<string, string>, body: string): string {
  const lines = Object.entries(meta)
    .filter(([, v]) => v !== '')
    .map(([k, v]) => `${k}: ${v}`);
  return `---\n${lines.join('\n')}\n---\n\n${body}\n`;
}

// ─── Session file parser ───────────────────────────────────────────────────────

export function parseSession(content: string): Comment[] {
  if (!content.trim()) return [];

  // Normalize CRLF to LF so regexes work on Windows-edited files
  const normalized = content.replace(/\r\n/g, '\n');

  const comments: Comment[] = [];
  const blocks = normalized.split(/(?:^|\n)---\n/);

  for (const block of blocks) {
    const trimmed = block.trim();
    if (!trimmed) continue;

    // Match: ## author — timestamp  OR  ## author
    const headerMatch = trimmed.match(
      /^##\s+(.+?)\s+—\s+(\d{4}-\d{2}-\d{2}T[\d:.]+Z)\s*\n([\s\S]*)/
    );
    const headerNoDate = trimmed.match(/^##\s+(.+?)\s*\n([\s\S]*)/);

    let author: string;
    let date: number;
    let text: string;

    if (headerMatch) {
      author = headerMatch[1].trim();
      date = new Date(headerMatch[2]).getTime();
      text = headerMatch[3].trim();
    } else if (headerNoDate) {
      author = headerNoDate[1].trim();
      date = Date.now();
      text = headerNoDate[2].trim();
    } else {
      continue;
    }

    comments.push({
      id: `${date}-${author}`,
      text,
      author,
      authorId: author,
      date,
    });
  }

  return comments;
}

export function renderSessionEntry(author: string, text: string): string {
  const ts = new Date().toISOString();
  return `\n---\n\n## ${author} — ${ts}\n\n${text}\n`;
}

// ─── File helpers ──────────────────────────────────────────────────────────────

function findTaskFile(
  baseDir: string,
  taskId: string
): { folder: TaskFolder; filename: string; dir: string } | null {
  for (const folder of TASK_FOLDERS) {
    const dir = path.join(tasksRoot(baseDir), folder);
    if (!fs.existsSync(dir)) continue;
    const files = fs.readdirSync(dir);
    const match = files.find(
      (f) => f.startsWith(`${taskId}-`) && f.endsWith('.md') && !f.endsWith('.session.md')
    );
    if (match) return { folder, filename: match, dir };
  }
  return null;
}

function sessionFilename(taskFilename: string): string {
  return taskFilename.replace(/\.md$/, '.session.md');
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
}

function shortId(): string {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 8);
}

// ─── LocalProvider ─────────────────────────────────────────────────────────────

export type TaskMode = 'code' | 'non-code';

export class LocalProvider implements TaskProvider {
  private baseDir: string;
  private mode: TaskMode;

  constructor(baseDir = process.cwd(), mode: TaskMode = 'code') {
    this.baseDir = baseDir;
    this.mode = mode;
    ensureTaskFolders(this.baseDir);
  }

  async fetchTasks(): Promise<Task[]> {
    logger.debug(`Fetching ${this.mode} tasks from local .aidev/tasks folders`);

    const tasks: Task[] = [];
    for (const folder of TASK_FOLDERS) {
      const dir = path.join(tasksRoot(this.baseDir), folder);
      if (!fs.existsSync(dir)) continue;

      const files = fs.readdirSync(dir).filter(
        (f) => f.endsWith('.md') && !f.endsWith('.session.md')
      );

      for (const file of files) {
        const content = fs.readFileSync(path.join(dir, file), 'utf8');
        const { meta, body } = parseFrontmatter(content);

        const taskType: TaskMode = meta.type === 'non-code' ? 'non-code' : 'code';
        if (taskType !== this.mode) continue;

        const idMatch = file.match(/^([a-f0-9]+)-/);
        const id = idMatch ? idMatch[1] : file.replace(/\.md$/, '');

        tasks.push({
          id,
          name: meta.title || file.replace(/\.md$/, ''),
          description: body,
          status: FOLDER_TO_STATUS[folder],
          url: path.join(dir, file),
          tags: meta.tags ? meta.tags.split(',').map((t) => t.trim()).filter(Boolean) : [],
          priority: meta.priority ? parseInt(meta.priority, 10) : undefined,
        });
      }
    }

    return tasks;
  }

  async fetchTasksByStatus(statuses: string[]): Promise<Task[]> {
    const normalized = statuses.map((s) => s.toLowerCase());
    const all = await this.fetchTasks();
    return all.filter((t) => normalized.includes(t.status.toLowerCase()));
  }

  async postComment(taskId: string, text: string): Promise<void> {
    logger.debug(`Posting comment to local task ${taskId}`);

    const found = findTaskFile(this.baseDir, taskId);
    if (!found) {
      throw new Error(`Local task not found: ${taskId}`);
    }

    const sessionPath = path.join(found.dir, sessionFilename(found.filename));
    const entry = renderSessionEntry('aidev', text);

    if (fs.existsSync(sessionPath)) {
      fs.appendFileSync(sessionPath, entry, 'utf8');
    } else {
      fs.writeFileSync(
        sessionPath,
        `<!-- aidev session log — append your comments below using "## your-name" as header -->\n${entry}`,
        'utf8'
      );
    }
  }

  async getComments(taskId: string): Promise<Comment[]> {
    logger.debug(`Fetching comments for local task ${taskId}`);

    const found = findTaskFile(this.baseDir, taskId);
    if (!found) return [];

    const sessionPath = path.join(found.dir, sessionFilename(found.filename));
    if (!fs.existsSync(sessionPath)) return [];

    const content = fs.readFileSync(sessionPath, 'utf8');
    return parseSession(content);
  }

  async updateStatus(taskId: string, status: string): Promise<void> {
    const targetFolder = STATUS_TO_FOLDER[status.toLowerCase()];
    if (!targetFolder) {
      logger.warn(`Unknown status "${status}" — mapping to "open"`);
    }
    const folder = targetFolder || 'open';

    logger.debug(`Updating local task ${taskId} status to "${status}" (folder: ${folder})`);

    const found = findTaskFile(this.baseDir, taskId);
    if (!found) {
      throw new Error(`Local task not found: ${taskId}`);
    }

    if (found.folder === folder) return;

    const destDir = path.join(tasksRoot(this.baseDir), folder);
    fs.mkdirSync(destDir, { recursive: true });

    // Move task file
    fs.renameSync(
      path.join(found.dir, found.filename),
      path.join(destDir, found.filename)
    );

    // Move session file if it exists
    const sessName = sessionFilename(found.filename);
    const sessSource = path.join(found.dir, sessName);
    if (fs.existsSync(sessSource)) {
      fs.renameSync(sessSource, path.join(destDir, sessName));
    }
  }

  async createTask(params: CreateTaskParams): Promise<CreateTaskResult> {
    const id = shortId();
    const slug = slugify(params.title);
    const filename = `${id}-${slug}.md`;

    const meta: Record<string, string> = {
      title: params.title,
    };
    if (this.mode === 'non-code') meta.type = 'non-code';
    if (params.priority) meta.priority = String(params.priority);
    if (params.tags.length > 0) meta.tags = params.tags.join(', ');
    if (params.dueDate) meta.due_date = new Date(params.dueDate).toISOString().split('T')[0];
    meta.created = new Date().toISOString();

    const content = renderFrontmatter(meta, params.description || '');
    const destDir = path.join(tasksRoot(this.baseDir), 'open');
    fs.mkdirSync(destDir, { recursive: true });

    const filePath = path.join(destDir, filename);
    fs.writeFileSync(filePath, content, 'utf8');

    logger.debug(`Created local task: ${filePath}`);
    return { id, url: filePath };
  }
}

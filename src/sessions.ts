import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { Comment, Config } from './types';
import { AIRunner } from './ai/base';
import { logger } from './logger';

export interface Session {
  taskId: string;
  updatedAt: number;
  fingerprint: string;
  summary: string;
  lastCommentId: string;
}

export function getSessionsDir(): string {
  return path.join(process.cwd(), '.aidev', 'sessions');
}

export function ensureSessionsDir(): void {
  const dir = getSessionsDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function sanitizeTaskId(taskId: string): string {
  return taskId.replace(/[^a-zA-Z0-9_.-]/g, '_');
}

export function getSessionPath(taskId: string): string {
  return path.join(getSessionsDir(), `${sanitizeTaskId(taskId)}.json`);
}

export function readSession(taskId: string): Session | null {
  const file = getSessionPath(taskId);
  if (!fs.existsSync(file)) return null;
  try {
    const raw = fs.readFileSync(file, 'utf8');
    const parsed = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed.taskId === 'string' &&
      typeof parsed.fingerprint === 'string' &&
      typeof parsed.summary === 'string'
    ) {
      return parsed as Session;
    }
    return null;
  } catch {
    return null;
  }
}

export function writeSession(taskId: string, data: Session): void {
  ensureSessionsDir();
  fs.writeFileSync(getSessionPath(taskId), JSON.stringify(data, null, 2), 'utf8');
}

export function fingerprintComments(comments: Comment[]): string {
  const hash = crypto.createHash('sha256');
  for (const c of comments) {
    hash.update(c.id);
    hash.update('\0');
    hash.update(c.text);
    hash.update('\0');
  }
  return hash.digest('hex');
}

export function shouldCompress(prompt: string, threshold: number): boolean {
  return prompt.length > threshold;
}

function buildRawContext(comments: Comment[]): string {
  if (comments.length === 0) return '';
  return (
    '\n\nConversation context:\n' +
    comments.map((c) => `${c.author}: ${c.text}`).join('\n')
  );
}

export async function summarizeWithRunner(
  comments: Comment[],
  runners: AIRunner[]
): Promise<string | null> {
  const conversation = comments.map((c) => `${c.author}: ${c.text}`).join('\n');
  const prompt =
    'Summarize the following conversation. Preserve any decisions, dev notes, dropped requirements, and open questions. Keep it concise (<1000 words). Output only the summary, no preamble.\n\n' +
    conversation;

  for (const runner of runners) {
    if (!runner.isAvailable()) continue;
    try {
      const result = await runner.run(prompt);
      if (result.success && result.output.trim()) {
        return result.output.trim();
      }
      logger.warn(`Summarization runner ${runner.name} returned no output`);
    } catch (err) {
      logger.warn(`Summarization runner ${runner.name} failed: ${(err as Error).message}`);
    }
  }
  return null;
}

export async function buildCompressedContext(
  comments: Comment[],
  taskId: string,
  runners: AIRunner[],
  config: Config
): Promise<string> {
  if (!config.autoCompress || comments.length <= 1) {
    return buildRawContext(comments);
  }

  const raw = buildRawContext(comments);
  if (!shouldCompress(raw, config.compressThreshold)) {
    return raw;
  }

  const lastComment = comments[comments.length - 1];
  const earlier = comments.slice(0, -1);
  const fingerprint = fingerprintComments(earlier);

  let summary: string | null = null;
  const cached = readSession(taskId);
  if (cached && cached.fingerprint === fingerprint && cached.summary) {
    summary = cached.summary;
  } else {
    summary = await summarizeWithRunner(earlier, runners);
    if (summary) {
      writeSession(taskId, {
        taskId,
        updatedAt: Date.now(),
        fingerprint,
        summary,
        lastCommentId: lastComment.id,
      });
    } else {
      logger.warn('Auto-compress: no runner produced a summary; using raw conversation context');
      return raw;
    }
  }

  return (
    '\n\nSummary of earlier conversation (auto-compressed):\n' +
    summary +
    '\n\nLatest comment:\n' +
    `${lastComment.author}: ${lastComment.text}`
  );
}

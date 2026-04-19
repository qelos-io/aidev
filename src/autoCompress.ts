import * as fs from 'node:fs';
import * as path from 'node:path';
import { AIRunner } from './ai/base';
import { logger } from './logger';
import { Comment, Config } from './types';

const ADDITIONAL_CTX = '\n\nAdditional context:\n';

/** Matches how AIRunner implementations concatenate prompt and notes. */
export function fullPromptCharCount(prompt: string, notes?: string): number {
  if (notes && notes.length > 0) {
    return prompt.length + ADDITIONAL_CTX.length + notes.length;
  }
  return prompt.length;
}

export function formatConversationBlock(comments: Comment[]): string {
  if (comments.length === 0) return '';
  return '\n\nConversation context:\n' + comments.map((c) => `${c.author}: ${c.text}`).join('\n');
}

/** Ticket conversation block plus optional PR review section (same order as run.ts). */
export function buildTaskContextSuffix(humanComments: Comment[], reviewSection: string): string {
  return formatConversationBlock(humanComments) + reviewSection;
}

function sessionsDir(): string {
  return path.join(process.cwd(), '.aidev', 'sessions');
}

function sanitizeTaskIdForFile(taskId: string): string {
  return taskId.replace(/[^a-zA-Z0-9._-]+/g, '_');
}

export interface CompressionSessionPayload {
  taskId: string;
  compressedAt: string;
  earlierCommentCount: number;
  summaryChars: number;
  summary: string;
  relativePath: string;
}

export function writeCompressionSession(taskId: string, payload: Omit<CompressionSessionPayload, 'relativePath'>): string {
  const dir = sessionsDir();
  fs.mkdirSync(dir, { recursive: true });
  const base = sanitizeTaskIdForFile(taskId);
  const filename = `${base}-${Date.now()}.json`;
  const fullPath = path.join(dir, filename);
  const relativePath = path.relative(process.cwd(), fullPath);
  fs.writeFileSync(
    fullPath,
    JSON.stringify({ ...payload, relativePath }, null, 2),
    'utf8'
  );
  return fullPath;
}

function tripwireLimit(config: Config): number {
  return Math.floor(config.autoCompressMaxChars * config.autoCompressThreshold);
}

async function summarizeEarlierComments(
  older: Comment[],
  runners: AIRunner[],
  latestAuthor: string
): Promise<string | null> {
  const body = older.map((c) => `### ${c.author}\n${c.text}`).join('\n\n---\n\n');

  const prompt = `You are helping compress task ticket comments for an automated coding agent.

The following messages are OLDER comments on a task. The LATEST comment from "${latestAuthor}" will be appended separately in full — do not restate it.

Produce a dense summary the agent can use to implement follow-up work. Preserve exactly:
- requirements, constraints, accepted decisions
- file paths, identifiers, URLs, code snippets, error messages
- anything that would change what code to write

Use bullet lists where helpful. Omit greetings and meta chatter. Be as concise as possible without losing technical facts.

--- Older comments ---
${body}
--- End ---

Respond with the summary only — no title line, no markdown fence.`;

  for (const runner of runners) {
    if (!runner.isAvailable()) continue;
    logger.info(`Auto-compress: summarizing ${older.length} earlier comment(s) with ${runner.name}...`);
    const result = await runner.run(prompt);
    if (result.success && result.output.trim()) {
      return result.output.trim();
    }
    logger.warn(`Auto-compress: ${runner.name} failed to summarize earlier comments`);
  }
  return null;
}

/**
 * When the measured total prompt (see measureWithComments) exceeds the configured
 * fraction of AUTO_COMPRESS_MAX_CHARS, replaces all but the last human comment
 * with a single compressed summary comment. The summary is written under
 * `.aidev/sessions/`.
 */
export async function maybeCompressHumanComments(
  taskId: string,
  config: Config,
  humanComments: Comment[],
  runners: AIRunner[],
  measureWithComments: (comments: Comment[]) => number
): Promise<Comment[]> {
  if (!config.autoCompress) {
    return humanComments;
  }
  if (humanComments.length <= 1) {
    return humanComments;
  }

  const rawLen = measureWithComments(humanComments);
  if (rawLen <= tripwireLimit(config)) {
    return humanComments;
  }

  const older = humanComments.slice(0, -1);
  const latest = humanComments[humanComments.length - 1]!;

  const summary = await summarizeEarlierComments(older, runners, latest.author);
  if (!summary) {
    logger.warn('Auto-compress: could not summarize earlier comments — using full conversation');
    return humanComments;
  }

  const summaryComment: Comment = {
    id: `aidev-compressed-${sanitizeTaskIdForFile(taskId)}`,
    author: 'aidev (earlier comments — compressed)',
    text: `${summary}\n\n---\nBelow is the latest comment on this task (shown in full, not compressed):`,
    authorId: 'aidev',
    date: Date.now(),
  };

  const compressed: Comment[] = [summaryComment, latest];
  const newLen = measureWithComments(compressed);
  if (newLen >= rawLen) {
    logger.warn('Auto-compress: compressed text was not shorter than originals — keeping full conversation');
    return humanComments;
  }

  writeCompressionSession(taskId, {
    taskId,
    compressedAt: new Date().toISOString(),
    earlierCommentCount: older.length,
    summaryChars: summary.length,
    summary,
  });

  if (newLen > config.autoCompressMaxChars) {
    logger.warn(
      `Auto-compress: prompt still large (${newLen} chars) after compression — consider raising AUTO_COMPRESS_MAX_CHARS`
    );
  } else {
    logger.info(`Auto-compress: reduced measured prompt from ~${rawLen} to ~${newLen} chars (earlier comments summarized)`);
  }

  return compressed;
}

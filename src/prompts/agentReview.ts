import { Task } from '../types';
import { taskDescription } from './shared';

export interface AgentReviewComment {
  path: string;
  line: number;
  body: string;
}

export function buildAgentReviewExportInstructions(): string {
  return `Respond with valid JSON only — no markdown fences, no extra text.

Output a JSON array of review comments. Each item must have:
  - "path": file path as it appears in the PR diff
  - "line": line number in the new file (RIGHT side of the diff)
  - "body": review comment text explaining the issue and suggested fix

An empty array [] means the review ran successfully and found no issues.`;
}

function buildAgentReviewBody(): string {
  return `You are a senior code reviewer performing a proactive review of a pull request diff.

Review the changes carefully and report actionable issues as inline review comments.

Focus on:
  - Correctness — logic errors, off-by-one mistakes, incorrect assumptions
  - Security — injection, auth gaps, secrets exposure, unsafe defaults
  - Maintainability — clarity, duplication, naming, coupling
  - Tests — missing coverage for new behavior or regressions
  - Edge cases — null/empty inputs, error paths, concurrency, boundary conditions

Only flag issues you are confident about. Prefer fewer, high-signal comments over nitpicks.`;
}

function appendAgentReviewContext(task: Task, prDiff: string, prUrl?: string): string {
  let context = `

Task: ${task.name}

Description:
${taskDescription(task)}`;

  if (prUrl) {
    context += `

Pull Request: ${prUrl}`;
  }

  context += `

## Pull Request Diff

${prDiff}`;

  return context;
}

export function buildAgentReviewPrompt(task: Task, prDiff: string, prUrl?: string): string {
  return (
    buildAgentReviewBody()
    + appendAgentReviewContext(task, prDiff, prUrl)
    + '\n\n'
    + buildAgentReviewExportInstructions()
  );
}

export function composeAgentReviewPrompt(
  task: Task,
  prDiff: string,
  prUrl?: string,
  skillContent?: string | null,
): string {
  const body = skillContent ?? buildAgentReviewBody();
  return (
    body
    + appendAgentReviewContext(task, prDiff, prUrl)
    + '\n\n'
    + buildAgentReviewExportInstructions()
  );
}

function tryParseJson(text: string): unknown | null {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function extractBalancedJsonArraySlice(text: string, start: number): string | null {
  if (text[start] !== '[') return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
    } else if (ch === '[') {
      depth++;
    } else if (ch === ']') {
      depth--;
      if (depth === 0) {
        return text.slice(start, i + 1);
      }
    }
  }

  return null;
}

function extractJsonArraysFromAgentOutput(output: string): unknown[][] {
  const candidates: string[] = [];
  const seen = new Set<string>();

  const addCandidate = (raw: string): void => {
    const trimmed = raw.trim();
    if (!trimmed.startsWith('[') || seen.has(trimmed)) return;
    seen.add(trimmed);
    candidates.push(trimmed);
  };

  const fenceRe = /```(?:json)?\s*\n?([\s\S]*?)```/gi;
  let fenceMatch: RegExpExecArray | null;
  while ((fenceMatch = fenceRe.exec(output)) !== null) {
    addCandidate(fenceMatch[1]);
  }

  for (let i = 0; i < output.length; i++) {
    if (output[i] !== '[') continue;
    const slice = extractBalancedJsonArraySlice(output, i);
    if (slice) addCandidate(slice);
  }

  const arrays: unknown[][] = [];
  for (const candidate of candidates) {
    const parsed = tryParseJson(candidate);
    if (Array.isArray(parsed)) {
      arrays.push(parsed);
    }
  }

  return arrays;
}

function parseAgentReviewArray(items: unknown[]): AgentReviewComment[] | null {
  const comments: AgentReviewComment[] = [];

  for (const item of items) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return null;

    const entry = item as { path?: unknown; line?: unknown; body?: unknown };
    const path = typeof entry.path === 'string' ? entry.path.trim() : '';
    const body = typeof entry.body === 'string' ? entry.body.trim() : '';
    const line = entry.line;

    if (
      !path
      || !body
      || typeof line !== 'number'
      || !Number.isInteger(line)
      || line <= 0
    ) {
      return null;
    }

    comments.push({ path, line, body });
  }

  return comments;
}

export function parseAgentReviewResponse(output: string): AgentReviewComment[] | null {
  const arrays = extractJsonArraysFromAgentOutput(output);
  for (let i = arrays.length - 1; i >= 0; i--) {
    const parsed = parseAgentReviewArray(arrays[i]!);
    if (parsed !== null) return parsed;
  }
  return null;
}

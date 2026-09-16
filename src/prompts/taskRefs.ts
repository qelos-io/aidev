import { Task } from '../types';

/** Escapes regex special characters in a literal string. */
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Permissive charset for a task id captured inside a URL. Covers ClickUp hashes,
 * Jira/Linear keys (`PROJ-123`), Notion UUIDs (with dashes), and Monday numbers.
 */
const ID_CHARSET = '[A-Za-z0-9][A-Za-z0-9_-]*';

/** Annotation appended immediately after a detected task reference. */
function buildAnnotation(taskId: string, useRemote: boolean): string {
  const cmd = useRemote
    ? `aidev tasks get ${taskId} --remote`
    : `aidev tasks get ${taskId}`;
  return ` (run \`${cmd}\`)`;
}

interface RefMatch {
  start: number;
  end: number;
  taskId: string;
}

/**
 * Derives a regex that matches task URLs of the same provider/format as
 * `selfTask.url`, capturing the task id in group 1. The id is located inside
 * the url (last occurrence) and replaced with a permissive capture group.
 * Returns null when the id cannot be located in the url (e.g. local provider
 * where url is a file path that may not contain the id).
 */
function deriveTaskUrlRegex(url: string, id: string): RegExp | null {
  const idx = url.lastIndexOf(id);
  if (idx === -1) return null;
  const prefix = url.slice(0, idx);
  const suffix = url.slice(idx + id.length);
  const pattern = escapeRegex(prefix) + '(' + ID_CHARSET + ')' + escapeRegex(suffix);
  try {
    return new RegExp(pattern, 'g');
  } catch {
    return null;
  }
}

/**
 * Detects bare task-id references (e.g. `PROJ-123`, `LIN-456`) when the self
 * task's own id follows the distinctive `<KEY>-<number>` convention used by
 * Jira and Linear. Returns null for providers whose ids are not distinctive
 * enough to safely match in prose (ClickUp/Trello hashes, Monday numbers).
 */
function deriveBareIdRegex(id: string): RegExp | null {
  if (!/^[A-Z][A-Z0-9]*-\d+$/.test(id)) return null;
  return /\b[A-Z][A-Z0-9]*-\d+\b/g;
}

function collectUrlMatches(text: string, regex: RegExp): RefMatch[] {
  const matches: RefMatch[] = [];
  let m: RegExpExecArray | null;
  regex.lastIndex = 0;
  while ((m = regex.exec(text)) !== null) {
    if (m[1] !== undefined) {
      matches.push({ start: m.index, end: m.index + m[0].length, taskId: m[1] });
    }
  }
  return matches;
}

function collectBareMatches(
  text: string,
  regex: RegExp,
  excludeRanges: Array<[number, number]>,
): RefMatch[] {
  const matches: RefMatch[] = [];
  let m: RegExpExecArray | null;
  regex.lastIndex = 0;
  while ((m = regex.exec(text)) !== null) {
    const start = m.index;
    const end = start + m[0].length;
    const insideExcluded = excludeRanges.some(([s, e]) => start >= s && end <= e);
    if (!insideExcluded) {
      matches.push({ start, end, taskId: m[0] });
    }
  }
  return matches;
}

/** Matches a previously-inserted aidev annotation so we can avoid re-annotating. */
const EXISTING_ANNOTATION = /\(run `aidev tasks get [^`]+`\)/g;

function collectExistingAnnotationRanges(text: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  let m: RegExpExecArray | null;
  EXISTING_ANNOTATION.lastIndex = 0;
  while ((m = EXISTING_ANNOTATION.exec(text)) !== null) {
    ranges.push([m.index, m.index + m[0].length]);
  }
  return ranges;
}

/**
 * Scans `text` for references to other tasks (URLs matching the provider's task
 * URL format, and bare `<KEY>-<number>` ids for Jira/Linear) and appends an
 * inline `(run \`aidev tasks get <id> --remote\`)` hint after each reference so
 * the AI agent can fetch the referenced task directly.
 *
 * Self-references (the same id as `selfTask.id`) and already-annotated
 * references are skipped. For local providers (non-http urls) the `--remote`
 * flag is omitted from the hint.
 */
export function augmentTaskReferences(text: string, selfTask: Task): string {
  if (!text || !selfTask.url) return text;

  const useRemote = /^https?:\/\//i.test(selfTask.url);
  const urlRegex = deriveTaskUrlRegex(selfTask.url, selfTask.id);
  const bareRegex = deriveBareIdRegex(selfTask.id);

  const urlMatches = urlRegex ? collectUrlMatches(text, urlRegex) : [];
  const annotationRanges = collectExistingAnnotationRanges(text);
  const urlRanges: Array<[number, number]> = urlMatches.map((m) => [m.start, m.end]);
  // Bare IDs are excluded from URL spans AND existing annotations (so a
  // previously-inserted `(run `aidev tasks get PROJ-200 --remote`)` is not
  // re-matched on a second pass).
  const bareExcludeRanges = [...urlRanges, ...annotationRanges];
  const bareMatches = bareRegex ? collectBareMatches(text, bareRegex, bareExcludeRanges) : [];

  const all = [...urlMatches, ...bareMatches]
    .filter((m) => m.taskId !== selfTask.id)
    .filter((m) => {
      const after = text.slice(m.end, m.end + 40).trimStart();
      return !after.startsWith('(run `aidev tasks');
    })
    .sort((a, b) => b.start - a.start);

  if (all.length === 0) return text;

  let result = text;
  for (const m of all) {
    const annotation = buildAnnotation(m.taskId, useRemote);
    result = result.slice(0, m.end) + annotation + result.slice(m.end);
  }
  return result;
}

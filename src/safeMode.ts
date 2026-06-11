import * as fs from 'node:fs';
import * as path from 'node:path';
import * as dotenv from 'dotenv';

// Segment patterns for underscore-separated env var names (e.g. CLICKUP_API_KEY).
const SECRET_SEGMENT_PATTERNS = [
  /^key$/i,
  /^token$/i,
  /^secret$/i,
  /^password$/i,
  /^passwd$/i,
  /^pwd$/i,
  /^auth$/i,
  /^credential$/i,
  /^private$/i,
  /^api[_-]?key$/i,
];

const MIN_SECRET_LENGTH = 8;

export function isSecretKey(key: string): boolean {
  const segments = key.split('_');
  return segments.some((seg) => SECRET_SEGMENT_PATTERNS.some((p) => p.test(seg)));
}

export function isSecretValue(key: string, value: string): boolean {
  if (value.length < MIN_SECRET_LENGTH) return false;
  // Skip obviously non-secret values
  if (/^(true|false|yes|no|null|undefined|[0-9]+)$/i.test(value)) return false;
  // Skip bare base URLs (e.g. JIRA_BASE_URL=https://example.atlassian.net)
  if (/^https?:\/\/[a-z0-9._-]+(:\d+)?\/?$/i.test(value)) return false;
  return isSecretKey(key);
}

function addSecretsFromFile(
  secrets: Map<string, string>,
  filePath: string,
  overwrite = false
): void {
  if (!fs.existsSync(filePath)) return;
  const parsed = dotenv.parse(fs.readFileSync(filePath, 'utf8'));
  for (const [key, value] of Object.entries(parsed)) {
    if (!isSecretValue(key, value)) continue;
    if (!overwrite && secrets.has(key)) continue;
    secrets.set(key, value);
  }
}

/** Relative path (from project cwd) to the git-ignored secrets file for a task. */
export function secretsFileRelPath(taskId: string): string {
  return path.join('.aidev', 'assets', 'secrets', `task-${taskId}.secrets`);
}

/** Absolute path to the git-ignored secrets file for a task. */
export function secretsFilePath(taskId: string, cwd = process.cwd()): string {
  return path.join(cwd, secretsFileRelPath(taskId));
}

/**
 * Collect secret key→value pairs from `.env.aidev` (and its extend), `.env`, plus
 * process.env (covers shell-provided values after loadConfig).
 */
export function collectSecrets(cwd = process.cwd()): Map<string, string> {
  const secrets = new Map<string, string>();
  const envAidevPath = path.join(cwd, '.env.aidev');

  addSecretsFromFile(secrets, path.join(cwd, '.env'));
  addSecretsFromFile(secrets, envAidevPath);

  if (fs.existsSync(envAidevPath)) {
    const parsed = dotenv.parse(fs.readFileSync(envAidevPath, 'utf8'));
    const rawExtend = parsed['AIDEV_ENV_EXTEND'];
    if (rawExtend) {
      const extendPath = path.isAbsolute(rawExtend)
        ? rawExtend
        : path.resolve(path.dirname(envAidevPath), rawExtend);
      addSecretsFromFile(secrets, extendPath);
    }
  }

  for (const [key, value] of Object.entries(process.env)) {
    if (value && isSecretValue(key, value) && !secrets.has(key)) {
      secrets.set(key, value);
    }
  }

  return secrets;
}

/** Return the subset of secrets whose values actually appear in `text`. */
export function findSecretsInText(text: string, secrets: Map<string, string>): Map<string, string> {
  const found = new Map<string, string>();
  for (const [key, value] of secrets) {
    if (text.includes(value)) found.set(key, value);
  }
  return found;
}

/** Replace secret values in text with placeholder references to the secrets file. */
export function redactText(
  text: string,
  foundSecrets: Map<string, string>,
  taskId: string
): string {
  if (foundSecrets.size === 0) return text;

  const relPath = secretsFileRelPath(taskId);
  const entries = [...foundSecrets.entries()].sort((a, b) => b[1].length - a[1].length);

  let result = text;
  const seen = new Set<string>();

  for (const [key, value] of entries) {
    if (seen.has(value)) continue;
    seen.add(value);
    const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const placeholder = `[encrypted content at file ${relPath} — ${key}]`;
    result = result.replace(new RegExp(escaped, 'g'), placeholder);
  }

  return result;
}

/** Write secrets to `.aidev/assets/secrets/task-<taskId>.secrets` (under git-ignored assets). */
export function writeSecretsFile(
  foundSecrets: Map<string, string>,
  taskId: string,
  cwd = process.cwd()
): string {
  const filePath = secretsFilePath(taskId, cwd);
  const secretsDir = path.dirname(filePath);
  if (!fs.existsSync(secretsDir)) {
    fs.mkdirSync(secretsDir, { recursive: true });
  }

  const relPath = secretsFileRelPath(taskId);
  const lines = [
    `# Secret values for task ${taskId} (git-ignored under .aidev/assets/)`,
    `# These values appeared in the task prompt and were redacted for security.`,
    `# Prefer terminal pipes over reading this file directly, e.g.:`,
    `#   Get-Content ${relPath} | ForEach-Object { if ($_ -match '^KEY=') { $env:KEY = $_.Split('=',2)[1] } }`,
    `#   export $(grep -v '^#' ${relPath} | xargs) && your-command`,
    ``,
  ];

  for (const [key, value] of foundSecrets) {
    lines.push(`${key}=${value}`);
  }

  fs.writeFileSync(filePath, lines.join('\n') + '\n', 'utf8');
  return relPath;
}

function safeModeNotice(relPath: string): string {
  return (
    `\n\n⚠️ Secret values were redacted from this prompt. ` +
    `They are stored in \`${relPath}\` (git-ignored). ` +
    `Prefer piping values via the terminal instead of reading that file directly.`
  );
}

/**
 * Apply safe mode to a task and its conversation context.
 * Secrets found in the combined text are redacted and stored in a git-ignored file.
 */
export function sanitizeTaskForSafeMode(
  task: { id: string; description: string },
  context: string,
  secrets: Map<string, string>,
  cwd = process.cwd()
): { task: { id: string; description: string }; context: string } {
  const combined = (task.description || '') + '\n' + context;
  const found = findSecretsInText(combined, secrets);

  if (found.size === 0) return { task, context };

  const relPath = writeSecretsFile(found, task.id, cwd);

  return {
    task: { ...task, description: redactText(task.description || '', found, task.id) },
    context: redactText(context, found, task.id) + safeModeNotice(relPath),
  };
}

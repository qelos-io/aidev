import * as fs from 'node:fs';
import * as path from 'node:path';
import { logger } from '../logger';

export interface NativeAttachment {
  id?: string;
  name?: string;
  url?: string;
}

export interface DownloadedAttachment {
  id?: string;
  name: string;
  path: string;
  sourceUrl: string;
}

const INVALID_PATH_CHARS = /[<>:"/\\|?*\x00-\x1f]/g;

export function appendAttachmentPaths(
  text: string,
  attachments: DownloadedAttachment[],
  heading = 'Local asset files (read/use these if relevant):'
): string {
  if (attachments.length === 0) return text;

  const uniquePaths = Array.from(new Set(attachments.map((attachment) => attachment.path)));
  const section = [heading, ...uniquePaths.map((filePath) => `- \`${filePath}\``)].join('\n');
  const trimmed = text.trimEnd();
  return trimmed ? `${trimmed}\n\n${section}` : section;
}

export async function downloadAttachments(
  taskId: string,
  attachments: NativeAttachment[],
  requestInit: RequestInit = {}
): Promise<DownloadedAttachment[]> {
  if (attachments.length === 0) return [];

  const assetDir = path.join(process.cwd(), '.aidev', 'assets', sanitizePathSegment(taskId));
  fs.mkdirSync(assetDir, { recursive: true });

  const usedNames = new Set<string>();
  const downloaded: DownloadedAttachment[] = [];

  for (const attachment of attachments) {
    if (!attachment.url) continue;

    const storedName = buildStoredFileName(attachment, usedNames);
    const destination = path.join(assetDir, storedName);

    if (fs.existsSync(destination)) {
      downloaded.push({
        id: attachment.id,
        name: storedName,
        path: toRelativeAssetPath(destination),
        sourceUrl: attachment.url,
      });
      continue;
    }

    try {
      const response = await fetch(attachment.url, {
        ...requestInit,
        redirect: 'follow',
      });
      if (!response.ok) {
        logger.warn(
          `Failed to download attachment "${storedName}" for task ${taskId}: ${response.status} ${response.statusText}`
        );
        continue;
      }

      const buffer = Buffer.from(await response.arrayBuffer());
      fs.writeFileSync(destination, buffer);

      downloaded.push({
        id: attachment.id,
        name: storedName,
        path: toRelativeAssetPath(destination),
        sourceUrl: attachment.url,
      });
    } catch (err) {
      logger.warn(
        `Failed to download attachment "${storedName}" for task ${taskId}: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  return downloaded;
}

export function normalizeAttachmentUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`.toLowerCase();
  } catch {
    return url.trim().toLowerCase();
  }
}

function buildStoredFileName(attachment: NativeAttachment, usedNames: Set<string>): string {
  const fileName = sanitizeFileName(resolveAttachmentName(attachment));
  const withPrefix = attachment.id
    ? `${sanitizePathSegment(attachment.id)}-${fileName}`
    : fileName;

  let candidate = withPrefix;
  let counter = 2;
  while (usedNames.has(candidate)) {
    const parsed = path.parse(withPrefix);
    candidate = `${parsed.name}-${counter}${parsed.ext}`;
    counter += 1;
  }

  usedNames.add(candidate);
  return candidate;
}

function resolveAttachmentName(attachment: NativeAttachment): string {
  if (attachment.name) return attachment.name;
  if (attachment.url) {
    try {
      const parsed = new URL(attachment.url);
      const base = path.posix.basename(parsed.pathname);
      if (base) return base;
    } catch {
      // Fall through to the default name below.
    }
  }
  return 'attachment';
}

function sanitizeFileName(fileName: string): string {
  const parsed = path.parse(fileName);
  const safeBase = sanitizePathSegment(parsed.name || 'attachment');
  const safeExt = parsed.ext.replace(INVALID_PATH_CHARS, '');
  return `${safeBase}${safeExt}`;
}

function sanitizePathSegment(value: string): string {
  const sanitized = value
    .replace(INVALID_PATH_CHARS, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return sanitized || 'attachment';
}

function toRelativeAssetPath(filePath: string): string {
  return path.relative(process.cwd(), filePath).split(path.sep).join('/');
}

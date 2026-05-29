import { createError, type H3Event } from 'h3';
import { createRequire } from 'node:module';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { readEnvFile } from './envFile';

// Subset of aidev's TaskProvider — declared locally so Nitro doesn't have to
// resolve types out of the CJS dist. Keep in sync with src/providers/base.ts.
export interface UiTask {
  id: string;
  name: string;
  description: string;
  status: string;
  url: string;
  tags: string[];
  priority?: number;
  sourceListId?: string;
}

export interface UiComment {
  id: string;
  text: string;
  author: string;
  authorId: string;
  date: number;
}

export interface FetchTasksOptions {
  skipAttachments?: boolean;
  omitDescription?: boolean;
}

export interface UiProvider {
  fetchTasks(options?: FetchTasksOptions): Promise<UiTask[]>;
  fetchTasksByStatus(statuses: string[], options?: FetchTasksOptions): Promise<UiTask[]>;
  fetchTaskById?(taskId: string, options?: FetchTasksOptions): Promise<UiTask | null>;
  fetchBoardTasks?(options?: FetchTasksOptions): Promise<UiTask[]>;
  postComment(taskId: string, text: string): Promise<void>;
  getComments(taskId: string): Promise<UiComment[]>;
  updateStatus(taskId: string, status: string): Promise<void>;
  fetchAvailableStatuses?(): Promise<string[]>;
  removeTag?(taskId: string, tag: string): Promise<void>;
}

// Mirrors src/types.ts:Config — only the fields the UI status routes actually
// touch. Re-declared here so the Nitro side doesn't import out of dist's d.ts.
export interface UiConfig {
  provider: string;
  clickupPendingStatus: string;
  clickupOpenStatus: string;
  clickupInReviewStatus: string;
  jiraPendingStatus: string;
  jiraInReviewStatus: string;
  linearPendingStatus: string;
  linearInReviewStatus: string;
  notionPendingStatus: string;
  notionInReviewStatus: string;
  trelloOpenStatus: string;
  trelloPendingStatus: string;
  trelloInReviewStatus: string;
  doneStatus: string;
  commentPrefix: string;
  [key: string]: unknown;
}

export interface ProviderBundle {
  config: UiConfig;
  provider: UiProvider;
  envPath: string;
  cwd: string;
  dist: string;
}

// Stash the bundle on the h3 event context so multiple handlers in one request
// don't repeatedly re-read .env.aidev or re-instantiate the provider.
const CACHE_KEY = '__aidevProvider';

function getDistDir(cwd: string): string {
  const dist = path.join(cwd, 'dist');
  if (!fs.existsSync(dist)) {
    throw createError({
      statusCode: 503,
      statusMessage:
        `aidev build artifacts not found at ${dist}. ` +
        `Run \`npm run build\` in the aidev repo before using the dashboard.`,
    });
  }
  return dist;
}

function load(cwd: string, dist: string, rel: string): unknown {
  const req = createRequire(path.join(cwd, 'package.json'));
  return req(path.join(dist, rel));
}

/**
 * Lazy-load and cache (per h3 request) the aidev provider plus its loaded
 * Config. Reads `.env.aidev` fresh on each new request so config edits made via
 * the dashboard take effect on the next API call without restarting Nuxt.
 *
 * Implementation note: `loadConfig` merges `.env.aidev` into `process.env` and
 * never overwrites existing keys — so without clearing them first, a stale
 * value from a previous request would shadow a freshly-edited one. We mirror
 * the same trick used in `config/test.post.ts` and delete the file's keys
 * before calling loadConfig.
 */
export function getProvider(event: H3Event): ProviderBundle {
  const ctx = event.context as Record<string, unknown>;
  const cached = ctx[CACHE_KEY] as ProviderBundle | undefined;
  if (cached) return cached;

  const cwd = process.env.AIDEV_CWD;
  if (!cwd) {
    throw createError({ statusCode: 500, statusMessage: 'AIDEV_CWD not set' });
  }

  const env = readEnvFile(cwd);
  if (!env.exists) {
    throw createError({
      statusCode: 503,
      statusMessage:
        `.env.aidev not found at ${env.path}. Configure the dashboard first via the Config screen.`,
    });
  }
  for (const key of env.keys) delete process.env[key];

  const dist = getDistDir(cwd);
  const configMod = load(cwd, dist, 'config') as {
    loadConfig: (envPath?: string) => UiConfig;
  };
  const providersMod = load(cwd, dist, 'providers') as {
    createProvider: (config: UiConfig) => UiProvider;
  };

  const config = configMod.loadConfig(env.path);
  const provider = providersMod.createProvider(config);
  const bundle: ProviderBundle = { config, provider, envPath: env.path, cwd, dist };
  ctx[CACHE_KEY] = bundle;
  return bundle;
}

/**
 * Maps the UI's status filter vocabulary (open/pending/review/done) to the
 * provider-specific status string(s) configured in `.env.aidev`. Returns an
 * empty array when the mapping is unconfigured so the caller can fall back to
 * a full task fetch instead of querying with a missing status.
 */
export function statusesForFilter(
  config: UiConfig,
  filter: 'open' | 'pending' | 'review' | 'all' | string,
): string[] | null {
  if (filter === 'all' || filter === '') return null;

  const p = (config.provider || '').toLowerCase();
  switch (filter) {
    case 'open':
      if (p === 'local') return ['open'];
      if (p === 'jira' || p === 'linear') return ['open'];
      if (p === 'trello') return [config.trelloOpenStatus || 'open'];
      return [config.clickupOpenStatus || 'open'];
    case 'pending':
      if (p === 'local') return ['pending'];
      if (p === 'jira') return config.jiraPendingStatus ? [config.jiraPendingStatus] : [];
      if (p === 'linear') return config.linearPendingStatus ? [config.linearPendingStatus] : [];
      if (p === 'notion') return config.notionPendingStatus ? [config.notionPendingStatus] : [];
      if (p === 'trello') return config.trelloPendingStatus ? [config.trelloPendingStatus] : [];
      return config.clickupPendingStatus ? [config.clickupPendingStatus] : [];
    case 'review':
      if (p === 'local') return ['review'];
      if (p === 'jira') return config.jiraInReviewStatus ? [config.jiraInReviewStatus] : [];
      if (p === 'linear') return config.linearInReviewStatus ? [config.linearInReviewStatus] : [];
      if (p === 'notion') return config.notionInReviewStatus ? [config.notionInReviewStatus] : [];
      if (p === 'trello') return config.trelloInReviewStatus ? [config.trelloInReviewStatus] : [];
      return config.clickupInReviewStatus ? [config.clickupInReviewStatus] : [];
    case 'inprogress':
    case 'in_progress':
      return ['in progress'];
    default:
      return [];
  }
}

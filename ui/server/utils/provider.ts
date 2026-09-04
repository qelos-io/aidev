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
  /** Only return tasks updated at or after this epoch-ms timestamp. */
  updatedAfter?: number;
  /** Include closed/completed tasks (ClickUp: `include_closed=true`). Default false. */
  includeClosed?: boolean;
}

export interface UiDashboardStatsParams {
  openStatuses: string[];
  pendingStatuses: string[];
  reviewStatuses: string[];
  inProgressStatuses: string[];
  doneStatuses: string[];
  currentPeriodStart: number;
  previousPeriodStart: number;
}

export interface UiDashboardCounts {
  open: number;
  pending: number;
  inReview: number;
  allTimeDone: number;
  executedCurrent: number;
  executedPrevious: number;
}

export interface UiProvider {
  fetchTasks(options?: FetchTasksOptions): Promise<UiTask[]>;
  fetchTasksByStatus(statuses: string[], options?: FetchTasksOptions): Promise<UiTask[]>;
  fetchTaskById?(taskId: string, options?: FetchTasksOptions): Promise<UiTask | null>;
  fetchBoardTasks?(options?: FetchTasksOptions): Promise<UiTask[]>;
  fetchDashboardCounts?(params: UiDashboardStatsParams): Promise<UiDashboardCounts>;
  postComment(taskId: string, text: string): Promise<void>;
  getComments(taskId: string): Promise<UiComment[]>;
  updateStatus(taskId: string, status: string): Promise<void>;
  fetchAvailableStatuses?(): Promise<string[]>;
  removeTag?(taskId: string, tag: string): Promise<void>;
  addTag?(taskId: string, tag: string): Promise<void>;
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
  nonCodeProvider?: UiProvider;
  consultProvider?: UiProvider;
  envPath: string;
  cwd: string;
  dist: string;
}

// Stash the bundle on the h3 event context so multiple handlers in one request
// don't repeatedly re-read .env.aidev or re-instantiate the provider.
const CACHE_KEY = '__aidevProvider';

function getDistDir(): string {
  const pkgDir = process.env.AIDEV_PACKAGE_DIR;
  if (!pkgDir) {
    throw createError({ statusCode: 500, statusMessage: 'AIDEV_PACKAGE_DIR not set' });
  }
  const dist = path.join(pkgDir, 'dist');
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

function load(pkgDir: string, dist: string, rel: string): unknown {
  const req = createRequire(path.join(pkgDir, 'package.json'));
  return req(path.join(dist, rel));
}

/**
 * Lazy-load and cache (per h3 request) the aidev provider plus its loaded
 * Config. Reads `.env.aidev` fresh on each new request so config edits made via
 * the dashboard take effect on the next API call without restarting Nuxt.
 *
 * Implementation note: `loadConfig` merges `.env.aidev` and its
 * `AIDEV_ENV_EXTEND` file into `process.env` and never overwrites existing
 * keys — so without clearing them first, a stale value from a previous
 * request or inherited shell env would shadow freshly-loaded file values. We
 * call `clearEnvFiles()` (local + extend keys) before `loadConfig`.
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

  const pkgDir = process.env.AIDEV_PACKAGE_DIR ?? cwd;
  const dist = getDistDir();
  const configMod = load(pkgDir, dist, 'config') as {
    loadConfig: (envPath?: string) => UiConfig;
    clearEnvFiles: (localPath: string) => void;
  };
  const providersMod = load(pkgDir, dist, 'providers') as {
    createProvider: (config: UiConfig, mode?: string) => UiProvider;
  };
  const providerViewsMod = load(pkgDir, dist, 'providerViews') as {
    buildNonCodeProviderConfig: (config: UiConfig) => UiConfig;
    buildConsultProviderConfig: (config: UiConfig) => UiConfig;
  };

  // Clear keys from local .env.aidev AND its AIDEV_ENV_EXTEND file so loadConfig
  // can re-apply the merged file values even when the Nitro process inherited
  // stale or empty shell overrides (e.g. CLICKUP_API_KEY only in ~/.aidev.global).
  configMod.clearEnvFiles(env.path);

  const config = configMod.loadConfig(env.path);
  const provider = providersMod.createProvider(config);

  // Mirror the CLI's non-code provider: same config but with nonCodeTag as the
  // tag filter (and optionally a different team/project). Only created when
  // nonCodeTag is set — without it there's nothing to filter on.
  let nonCodeProvider: UiProvider | undefined;
  const nonCodeTag = (config.nonCodeTag as string | undefined) || '';
  if (nonCodeTag) {
    nonCodeProvider = providersMod.createProvider(
      providerViewsMod.buildNonCodeProviderConfig(config),
      'non-code',
    );
  }

  let consultProvider: UiProvider | undefined;
  const consultTag = (config.consultTag as string | undefined) || '';
  if (consultTag) {
    consultProvider = providersMod.createProvider(
      providerViewsMod.buildConsultProviderConfig(config),
      'consult',
    );
  }

  const bundle: ProviderBundle = { config, provider, nonCodeProvider, consultProvider, envPath: env.path, cwd, dist };
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
      if (p === 'jira') return [config.jiraPendingStatus || 'To Do'];
      if (p === 'linear') return [config.linearPendingStatus || 'Todo'];
      if (p === 'notion') return [config.notionPendingStatus || 'pending'];
      if (p === 'trello') return [config.trelloPendingStatus || 'pending'];
      return [config.clickupPendingStatus || 'pending'];
    case 'review':
      if (p === 'local') return ['review'];
      if (p === 'jira') return [config.jiraInReviewStatus || 'In Review'];
      if (p === 'linear') return [config.linearInReviewStatus || 'In Review'];
      if (p === 'notion') return [config.notionInReviewStatus || 'review'];
      if (p === 'trello') return [config.trelloInReviewStatus || 'review'];
      return [config.clickupInReviewStatus || 'review'];
    case 'inprogress':
    case 'in_progress':
      return ['in progress'];
    case 'done':
      return [config.doneStatus || 'done'];
    default:
      return [];
  }
}

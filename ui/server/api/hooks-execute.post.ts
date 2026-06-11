import { defineEventHandler, readBody, createError } from 'h3';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { HOOK_NAMES } from '../../../src/hooksTemplate';

interface PostBody {
  hookName?: unknown;
  mockData?: unknown;
}

export default defineEventHandler(async (event) => {
  const hooksPath = process.env.AIDEV_HOOKS_PATH;
  if (!hooksPath) {
    throw createError({ statusCode: 400, statusMessage: 'AIDEV_HOOKS_PATH not configured' });
  }

  const body = await readBody<PostBody>(event);
  if (!body || typeof body.hookName !== 'string') {
    throw createError({ statusCode: 400, statusMessage: 'Body must be { hookName: string, mockData?: object }' });
  }

  const { hookName, mockData = {} } = body;

  if (!HOOK_NAMES.includes(hookName)) {
    throw createError({ statusCode: 400, statusMessage: `Unknown hook: ${hookName}` });
  }

  if (!fs.existsSync(hooksPath)) {
    return { ok: false, logs: [], error: 'Hooks file does not exist' };
  }

  const logs: string[] = [];
  const mockVm = {
    async runAI(prompt: string) {
      logs.push(`[runAI] ${prompt.slice(0, 100)}${prompt.length > 100 ? '…' : ''}`);
      return { success: true, output: '(mock AI response)', error: '' };
    },
    async postComment(taskId: string, text: string) {
      logs.push(`[postComment] taskId=${taskId} text=${text}`);
    },
    async updateStatus(taskId: string, status: string) {
      logs.push(`[updateStatus] taskId=${taskId} status=${status}`);
    },
    async getComments(taskId: string) {
      logs.push(`[getComments] taskId=${taskId}`);
      return [];
    },
    log: {
      info: (msg: string) => logs.push(`[info] ${msg}`),
      warn: (msg: string) => logs.push(`[warn] ${msg}`),
      error: (msg: string) => logs.push(`[error] ${msg}`),
    },
  };

  try {
    let mod: Record<string, unknown>;
    const resolved = path.isAbsolute(hooksPath)
      ? hooksPath
      : path.resolve(process.cwd(), hooksPath);

    if (resolved.endsWith('.ts')) {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { createJiti } = require('jiti') as typeof import('jiti');
      const jiti = createJiti(__filename, { interopDefault: true });
      mod = jiti(resolved) as Record<string, unknown>;
    } else {
      // Bust require cache so edits to the hooks file take effect each execution
      delete require.cache[require.resolve(resolved)];
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      mod = require(resolved);
    }

    const hooks = (mod.default || mod) as Record<string, unknown>;
    const fn = hooks[hookName];

    if (typeof fn !== 'function') {
      return { ok: false, logs, error: `Hook "${hookName}" is not exported or is not a function` };
    }

    await (fn as (ctx: unknown, vm: unknown) => Promise<unknown>)(mockData, mockVm);
    return { ok: true, logs };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logs.push(`[error] ${message}`);
    return { ok: false, logs, error: message };
  }
});

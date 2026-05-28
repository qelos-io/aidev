import { defineEventHandler, readBody, createError } from 'h3';
import { readEnvFile, writeEnvFile } from '../utils/envFile';

interface PutBody {
  values?: Record<string, unknown>;
}

const KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

export default defineEventHandler(async (event) => {
  const cwd = process.env.AIDEV_CWD;
  if (!cwd) {
    throw createError({ statusCode: 500, statusMessage: 'AIDEV_CWD not set' });
  }

  const body = await readBody<PutBody>(event);
  if (!body || typeof body.values !== 'object' || body.values === null) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Body must be { values: Record<string, string> }',
    });
  }

  const kv: Record<string, string> = {};
  for (const [k, v] of Object.entries(body.values)) {
    if (!KEY_PATTERN.test(k)) {
      throw createError({ statusCode: 400, statusMessage: `Invalid key: ${k}` });
    }
    // Form inputs may submit null/undefined for cleared optional fields. Skip
    // them — writeEnvFile treats omission as deletion, which is what we want.
    if (v == null) continue;
    kv[k] = String(v);
  }

  writeEnvFile(cwd, kv);
  return readEnvFile(cwd);
});

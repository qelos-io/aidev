import { defineEventHandler, readBody, createError } from 'h3';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { readEnvFile } from '../../utils/envFile';

interface TestBody {
  provider?: boolean;
  ai?: string;
}

interface TestResult {
  ok: boolean;
  message: string;
}

// Each entry: [binary name, args]. anthropic-sdk has no CLI — it's driven by
// @anthropic-ai/claude-agent-sdk in-process, so we report it separately.
const AGENT_CLI: Record<string, [string, string[]]> = {
  claude: ['claude', ['--version']],
  cursor: ['agent', ['--version']],
  codex: ['codex', ['--version']],
  antigravity: ['agy', ['--version']],
  windsurf: ['windsurf', ['--version']],
};

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

function loadAidev(rel: string): unknown {
  const pkgDir = process.env.AIDEV_PACKAGE_DIR as string;
  const dist = getDistDir();
  const req = createRequire(path.join(pkgDir, 'package.json'));
  return req(path.join(dist, rel));
}

async function testProvider(): Promise<TestResult> {
  const cwd = process.env.AIDEV_CWD as string;
  const env = readEnvFile(cwd);
  if (!env.exists) {
    return { ok: false, message: `.env.aidev not found at ${env.path}` };
  }

  // loadConfig() copies values from .env.aidev (+ AIDEV_ENV_EXTEND) into
  // process.env but never overwrites already-set keys. Clear all managed keys
  // before delegating so loadConfig sees a clean slate each call.
  const configMod = loadAidev('config') as {
    loadConfig: (envPath?: string) => { provider: string };
    clearEnvFiles: (localPath: string) => void;
  };
  configMod.clearEnvFiles(env.path);

  const providersMod = loadAidev('providers') as {
    createProvider: (
      config: unknown,
    ) => {
      fetchTasks: () => Promise<unknown[]>;
      fetchAvailableStatuses?: () => Promise<string[]>;
    };
  };

  const config = configMod.loadConfig(env.path);
  const provider = providersMod.createProvider(config);

  // Prefer fetchAvailableStatuses — it's a single board/list read on most
  // providers, lighter than a full task fetch. Fall back when not implemented.
  if (typeof provider.fetchAvailableStatuses === 'function') {
    const statuses = await provider.fetchAvailableStatuses();
    return {
      ok: true,
      message: `${config.provider}: ${statuses.length} status(es) reachable`,
    };
  }

  const tasks = await provider.fetchTasks();
  return {
    ok: true,
    message: `${config.provider}: fetched ${tasks.length} task(s)`,
  };
}

function testAnthropicSdk(): TestResult {
  const cwd = process.env.AIDEV_CWD as string;
  const env = readEnvFile(cwd);
  if (!env.exists) {
    return { ok: false, message: `.env.aidev not found at ${env.path}` };
  }

  // Match testProvider: clear managed env keys so loadConfig() sees the on-disk state.
  const configMod = loadAidev('config') as {
    loadConfig: (envPath?: string) => unknown;
    clearEnvFiles: (localPath: string) => void;
    parseAnthropicTokens: (raw: string) => string[];
  };
  configMod.clearEnvFiles(env.path);
  configMod.loadConfig(env.path);

  const tokens = configMod.parseAnthropicTokens(process.env.ANTHROPIC_API_KEY ?? '');
  return tokens.length > 0
    ? {
        ok: true,
        message: `anthropic-sdk: ${tokens.length} API key(s) configured (validated at run time)`,
      }
    : { ok: false, message: 'anthropic-sdk: ANTHROPIC_API_KEY is not set' };
}

function testAi(name: string): TestResult {
  if (name === 'anthropic-sdk') {
    try {
      return testAnthropicSdk();
    } catch (err) {
      if (err && typeof err === 'object' && 'statusCode' in err) throw err;
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, message };
    }
  }

  const cmd = AGENT_CLI[name];
  if (!cmd) {
    return { ok: false, message: `Unknown AI runner: ${name}` };
  }

  const result = spawnSync(cmd[0], cmd[1], {
    encoding: 'utf8',
    timeout: 8000,
    // Don't inherit the UI's stdio — we want to capture the version string.
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  if (result.error) {
    const code = (result.error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      return { ok: false, message: `${cmd[0]} not found on PATH` };
    }
    return { ok: false, message: `${cmd[0]}: ${result.error.message}` };
  }

  if (result.status !== 0) {
    const msg = (result.stderr || result.stdout || '').trim();
    return { ok: false, message: `${cmd[0]} exited ${result.status}${msg ? `: ${msg}` : ''}` };
  }

  const out = (result.stdout || '').trim() || '(no output)';
  return { ok: true, message: `${cmd[0]}: ${out}` };
}

export default defineEventHandler(async (event): Promise<TestResult> => {
  const body = (await readBody<TestBody>(event)) ?? {};

  if (body.provider) {
    try {
      return await testProvider();
    } catch (err) {
      if (err && typeof err === 'object' && 'statusCode' in err) throw err;
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, message };
    }
  }

  if (typeof body.ai === 'string' && body.ai.length > 0) {
    return testAi(body.ai);
  }

  throw createError({
    statusCode: 400,
    statusMessage: 'Specify `provider: true` or `ai: <runner-name>`',
  });
});

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, it, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveMcpJsonPath,
  readMcpServers,
  buildBetterMcpConfig,
  toDockerMountPath,
  betterMcpProxyServers,
  toStandardJson,
  toDevinJson,
  toOpencodeJson,
  toCodexToml,
  materializeMcp,
  getMcpState,
  MCP_GITIGNORE_RULES,
} from '../mcp';
import { logger } from '../logger';
import type { Config } from '../types';

// commandExists() -> findBin() -> fs.accessSync(). Mocking commandExists
// itself doesn't work here: tsx/esbuild compiles named exports as
// non-configurable getters, which node:test's mock.method can't redefine.
// node:fs is a real builtin (not esbuild-compiled), so mocking accessSync on
// the require()'d module object propagates through platform.ts's own import.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const fsModule = require('node:fs');

function mockDockerOnPath(present: boolean) {
  return mock.method(fsModule, 'accessSync', (target: string) => {
    if (!present) throw new Error('ENOENT');
    if (path.basename(target).startsWith('docker')) return undefined;
    throw new Error('ENOENT');
  });
}

function withTmpDir(fn: (dir: string) => void): void {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aidev-mcp-test-'));
  try {
    fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function baseConfig(overrides: Partial<Config> = {}): Config {
  return {
    agents: ['claude', 'cursor'],
    mcpJsonPath: '',
    betterMcp: false,
    betterMcpConfigPath: '',
    ...overrides,
  } as Config;
}

function writeMcpJson(dir: string, relPath: string, servers: Record<string, unknown>): void {
  const abs = path.join(dir, relPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, JSON.stringify({ mcpServers: servers }, null, 2), 'utf8');
}

// ─── resolveMcpJsonPath ─────────────────────────────────────────────────────

describe('resolveMcpJsonPath', () => {
  it('returns null when nothing is configured or discoverable', () => {
    withTmpDir((dir) => {
      assert.equal(resolveMcpJsonPath(baseConfig(), dir), null);
    });
  });

  it('MCP_JSON_PATH wins over auto-discovery', () => {
    withTmpDir((dir) => {
      writeMcpJson(dir, '.agents/mcp.json', { a: { command: 'npx' } });
      writeMcpJson(dir, 'custom/mcp.json', { b: { command: 'npx' } });
      const resolved = resolveMcpJsonPath(baseConfig({ mcpJsonPath: 'custom/mcp.json' }), dir);
      assert.equal(resolved, path.join(dir, 'custom', 'mcp.json'));
    });
  });

  it('falls back to .agents/mcp.json before .aidev/mcp.json', () => {
    withTmpDir((dir) => {
      writeMcpJson(dir, '.agents/mcp.json', { a: { command: 'npx' } });
      writeMcpJson(dir, '.aidev/mcp.json', { b: { command: 'npx' } });
      const resolved = resolveMcpJsonPath(baseConfig(), dir);
      assert.equal(resolved, path.join(dir, '.agents', 'mcp.json'));
    });
  });

  it('falls back to .aidev/mcp.json when .agents/mcp.json is absent', () => {
    withTmpDir((dir) => {
      writeMcpJson(dir, '.aidev/mcp.json', { b: { command: 'npx' } });
      const resolved = resolveMcpJsonPath(baseConfig(), dir);
      assert.equal(resolved, path.join(dir, '.aidev', 'mcp.json'));
    });
  });

  it('resolves ~/-relative MCP_JSON_PATH against the home directory', () => {
    withTmpDir((dir) => {
      const resolved = resolveMcpJsonPath(baseConfig({ mcpJsonPath: '~/mcp.json' }), dir);
      assert.equal(resolved, path.join(os.homedir(), 'mcp.json'));
    });
  });

  it('uses an absolute MCP_JSON_PATH as-is', () => {
    withTmpDir((dir) => {
      const abs = path.join(dir, 'elsewhere', 'mcp.json');
      const resolved = resolveMcpJsonPath(baseConfig({ mcpJsonPath: abs }), dir);
      assert.equal(resolved, abs);
    });
  });

  it('returns an explicit MCP_JSON_PATH even when the file does not exist yet', () => {
    withTmpDir((dir) => {
      const resolved = resolveMcpJsonPath(baseConfig({ mcpJsonPath: 'not-there/mcp.json' }), dir);
      assert.equal(resolved, path.join(dir, 'not-there', 'mcp.json'));
    });
  });

  it('never resolves to one of its own gitignore-managed output paths', () => {
    // Regression guard: the source discovery paths (.agents/mcp.json,
    // .aidev/mcp.json) must never collide with an MCP_GITIGNORE_RULES pattern —
    // otherwise aidev could gitignore, or worse overwrite, the user's own input.
    for (const [pattern, regex] of MCP_GITIGNORE_RULES) {
      assert.ok(!regex.test('.agents/mcp.json'), `pattern "${pattern}" must not match the source .agents/mcp.json`);
      assert.ok(!regex.test('.aidev/mcp.json'), `pattern "${pattern}" must not match the source .aidev/mcp.json`);
    }
  });
});

// ─── readMcpServers ─────────────────────────────────────────────────────────

describe('readMcpServers', () => {
  it('parses a valid mcp.json', () => {
    withTmpDir((dir) => {
      writeMcpJson(dir, 'mcp.json', { fs: { command: 'npx', args: ['-y', 'x'] } });
      const servers = readMcpServers(path.join(dir, 'mcp.json'));
      assert.deepEqual(servers, { fs: { command: 'npx', args: ['-y', 'x'] } });
    });
  });

  it('throws naming the file when it does not exist', () => {
    withTmpDir((dir) => {
      assert.throws(() => readMcpServers(path.join(dir, 'missing.json')), /missing\.json/);
    });
  });

  it('throws a parse error naming the file on malformed JSON', () => {
    withTmpDir((dir) => {
      const p = path.join(dir, 'bad.json');
      fs.writeFileSync(p, '{ not json', 'utf8');
      assert.throws(() => readMcpServers(p), /bad\.json/);
    });
  });

  it('throws when the file has no mcpServers object', () => {
    withTmpDir((dir) => {
      const p = path.join(dir, 'no-servers.json');
      fs.writeFileSync(p, JSON.stringify({ foo: 'bar' }), 'utf8');
      assert.throws(() => readMcpServers(p), /mcpServers/);
    });
  });

  it('throws when mcpServers is an array rather than an object', () => {
    withTmpDir((dir) => {
      const p = path.join(dir, 'array-servers.json');
      fs.writeFileSync(p, JSON.stringify({ mcpServers: [] }), 'utf8');
      assert.throws(() => readMcpServers(p), /mcpServers/);
    });
  });

  it('parses an mcp.json with zero servers', () => {
    withTmpDir((dir) => {
      writeMcpJson(dir, 'empty.json', {});
      assert.deepEqual(readMcpServers(path.join(dir, 'empty.json')), {});
    });
  });
});

// ─── buildBetterMcpConfig / betterMcpProxyServers / toDockerMountPath ──────

describe('buildBetterMcpConfig', () => {
  it('forces namespace:true and injects mcpServers with no base', () => {
    const out = buildBetterMcpConfig(undefined, { fs: { command: 'npx' } });
    assert.deepEqual(out, { mcpServers: { fs: { command: 'npx' } }, namespace: true });
  });

  it('preserves an existing middleware block and overrides namespace:false', () => {
    const base = { namespace: false, middleware: { log: { level: 'info' } } };
    const out = buildBetterMcpConfig(base, { fs: { command: 'npx' } });
    assert.deepEqual(out.middleware, { log: { level: 'info' } });
    assert.equal(out.namespace, true);
  });

  it('replaces mcpServers wholesale rather than merging', () => {
    const base = { mcpServers: { old: { command: 'old' } } };
    const out = buildBetterMcpConfig(base, { fs: { command: 'npx' } });
    assert.deepEqual(out.mcpServers, { fs: { command: 'npx' } });
  });
});

describe('toDockerMountPath', () => {
  it('leaves posix paths unchanged', () => {
    assert.equal(toDockerMountPath('/abs/path/mcp.json'), '/abs/path/mcp.json');
  });

  it('converts a Windows drive path to a Docker-mountable posix path when windows=true', () => {
    assert.equal(toDockerMountPath('C:\\Users\\me\\project\\mcp.json', true), '/c/Users/me/project/mcp.json');
  });

  it('leaves a posix path unchanged even when windows=true', () => {
    assert.equal(toDockerMountPath('/abs/path/mcp.json', true), '/abs/path/mcp.json');
  });

  it('lowercases the drive letter', () => {
    assert.equal(toDockerMountPath('D:\\data\\mcp.json', true), '/d/data/mcp.json');
  });
});

describe('betterMcpProxyServers', () => {
  it('produces exactly one better-mcp docker entry', () => {
    const servers = betterMcpProxyServers('/abs/path/better-mcp.json');
    assert.deepEqual(Object.keys(servers), ['better-mcp']);
    assert.equal(servers['better-mcp'].command, 'docker');
    assert.deepEqual(servers['better-mcp'].args, [
      'run', '--rm', '-i', '-v', '/abs/path/better-mcp.json:/app/mcp.json:ro', 'ghcr.io/qelos/better-mcp:latest',
    ]);
  });
});

// ─── pure per-agent converters ──────────────────────────────────────────────

describe('toStandardJson', () => {
  it('wraps servers under mcpServers with a trailing newline', () => {
    const out = toStandardJson({ fs: { command: 'npx' } });
    assert.deepEqual(JSON.parse(out), { mcpServers: { fs: { command: 'npx' } } });
    assert.ok(out.endsWith('\n'));
  });

  it('produces an empty mcpServers object for zero servers', () => {
    const out = toStandardJson({});
    assert.deepEqual(JSON.parse(out), { mcpServers: {} });
  });
});

describe('toDevinJson', () => {
  it('adds a default permissions block when there is no existing file', () => {
    const out = JSON.parse(toDevinJson({ fs: { command: 'npx' } }));
    assert.deepEqual(out.permissions, { allow: [], deny: [], ask: [] });
    assert.deepEqual(out.mcpServers, { fs: { command: 'npx' } });
  });

  it('preserves an existing permissions block', () => {
    const existing = { permissions: { allow: ['Bash'], deny: [], ask: [] } };
    const out = JSON.parse(toDevinJson({ fs: { command: 'npx' } }, existing));
    assert.deepEqual(out.permissions, { allow: ['Bash'], deny: [], ask: [] });
  });

  it('preserves unrelated existing top-level keys', () => {
    const existing = { permissions: { allow: [], deny: [], ask: [] }, someOtherSetting: 'kept' };
    const out = JSON.parse(toDevinJson({ fs: { command: 'npx' } }, existing));
    assert.equal(out.someOtherSetting, 'kept');
  });

  it('replaces a stale mcpServers block from an existing file', () => {
    const existing = { mcpServers: { stale: { command: 'old' } } };
    const out = JSON.parse(toDevinJson({ fs: { command: 'npx' } }, existing));
    assert.deepEqual(Object.keys(out.mcpServers), ['fs']);
  });
});

describe('toOpencodeJson', () => {
  it('renames mcpServers to mcp and collapses command+args into one array', () => {
    const out = JSON.parse(toOpencodeJson({ fs: { command: 'npx', args: ['-y', 'x'] } }));
    assert.deepEqual(out.mcp.fs, { type: 'local', command: ['npx', '-y', 'x'], enabled: true });
    assert.equal(out.$schema, 'https://opencode.ai/config.json');
  });

  it('marks a url server as remote', () => {
    const out = JSON.parse(toOpencodeJson({ jira: { url: 'https://mcp.example.com' } }));
    assert.deepEqual(out.mcp.jira, { type: 'remote', url: 'https://mcp.example.com', enabled: true });
  });

  it('preserves unrelated top-level keys from an existing opencode.json', () => {
    const existing = { theme: 'dark', mcp: { stale: { type: 'local', command: ['old'] } } };
    const out = JSON.parse(toOpencodeJson({ fs: { command: 'npx' } }, existing));
    assert.equal(out.theme, 'dark');
    assert.deepEqual(Object.keys(out.mcp), ['fs']);
  });

  it('preserves enabled:false rather than defaulting it to true', () => {
    const out = JSON.parse(toOpencodeJson({ fs: { command: 'npx', enabled: false } }));
    assert.equal(out.mcp.fs.enabled, false);
  });

  it('omits environment when the server has no env', () => {
    const out = JSON.parse(toOpencodeJson({ fs: { command: 'npx' } }));
    assert.ok(!('environment' in out.mcp.fs));
  });

  it('includes environment when the server has env', () => {
    const out = JSON.parse(toOpencodeJson({ fs: { command: 'npx', env: { TOKEN: 'x' } } }));
    assert.deepEqual(out.mcp.fs.environment, { TOKEN: 'x' });
  });
});

describe('toCodexToml', () => {
  it('emits a quoted [mcp_servers.<name>] table with command, args, and env', () => {
    const out = toCodexToml({
      fs: { command: 'npx', args: ['-y', 'server'], env: { TOKEN: 'secret' } },
    });
    assert.ok(out.includes('[mcp_servers."fs"]'));
    assert.ok(out.includes('command = "npx"'));
    assert.ok(out.includes('args = ["-y", "server"]'));
    assert.ok(out.includes('env = { "TOKEN" = "secret" }'));
  });

  it('emits url for a remote server instead of command', () => {
    const out = toCodexToml({ remote: { url: 'https://mcp.example.com' } });
    assert.ok(out.includes('url = "https://mcp.example.com"'));
    assert.ok(!out.includes('command ='));
  });

  it('escapes quotes and backslashes in string values', () => {
    const out = toCodexToml({ 'weird name': { command: 'C:\\bin\\tool.exe', args: ['say "hi"'] } });
    assert.ok(out.includes('[mcp_servers."weird name"]'));
    assert.ok(out.includes('command = "C:\\\\bin\\\\tool.exe"'));
    assert.ok(out.includes('args = ["say \\"hi\\""]'));
  });

  it('produces an empty string for zero servers', () => {
    assert.equal(toCodexToml({}), '');
  });

  it('omits the env line when the server has no env', () => {
    const out = toCodexToml({ fs: { command: 'npx' } });
    assert.ok(!out.includes('env ='));
  });

  it('separates multiple server tables with a blank line', () => {
    const out = toCodexToml({ a: { command: 'npx' }, b: { command: 'npx' } });
    assert.ok(out.includes('[mcp_servers."a"]\ncommand = "npx"\n\n[mcp_servers."b"]'));
  });
});

// ─── materializeMcp ─────────────────────────────────────────────────────────

describe('materializeMcp', () => {
  beforeEach(() => mock.restoreAll());
  afterEach(() => mock.restoreAll());

  it('returns null and writes nothing when no mcp.json applies', () => {
    withTmpDir((dir) => {
      const state = materializeMcp(baseConfig(), dir);
      assert.equal(state, null);
      assert.equal(getMcpState(), null);
      assert.ok(!fs.existsSync(path.join(dir, '.cursor', 'mcp.json')));
    });
  });

  it('writes only the files for agents present in config.agents', () => {
    withTmpDir((dir) => {
      writeMcpJson(dir, '.aidev/mcp.json', { fs: { command: 'npx' } });
      materializeMcp(baseConfig({ agents: ['claude'] }), dir);
      assert.ok(fs.existsSync(path.join(dir, '.aidev', 'mcp', 'claude.json')));
      assert.ok(!fs.existsSync(path.join(dir, '.cursor', 'mcp.json')));
      assert.ok(!fs.existsSync(path.join(dir, '.devin', 'config.json')));
    });
  });

  it('writes the right file per agent', () => {
    withTmpDir((dir) => {
      writeMcpJson(dir, '.aidev/mcp.json', { fs: { command: 'npx' } });
      materializeMcp(baseConfig({ agents: ['claude', 'cursor', 'antigravity', 'devin', 'opencode', 'codex'] }), dir);
      assert.ok(fs.existsSync(path.join(dir, '.aidev', 'mcp', 'claude.json')));
      assert.ok(fs.existsSync(path.join(dir, '.cursor', 'mcp.json')));
      assert.ok(fs.existsSync(path.join(dir, '.agents', 'mcp_config.json')));
      assert.ok(fs.existsSync(path.join(dir, '.devin', 'config.json')));
      assert.ok(fs.existsSync(path.join(dir, 'opencode.json')));
      assert.ok(fs.existsSync(path.join(dir, '.codex', 'config.toml')));
    });
  });

  it('is idempotent — a second run produces byte-identical files', () => {
    withTmpDir((dir) => {
      writeMcpJson(dir, '.aidev/mcp.json', { fs: { command: 'npx', args: ['-y', 'x'] } });
      materializeMcp(baseConfig({ agents: ['claude', 'cursor'] }), dir);
      const first = fs.readFileSync(path.join(dir, '.cursor', 'mcp.json'), 'utf8');
      materializeMcp(baseConfig({ agents: ['claude', 'cursor'] }), dir);
      const second = fs.readFileSync(path.join(dir, '.cursor', 'mcp.json'), 'utf8');
      assert.equal(second, first);
    });
  });

  it('ensures .gitignore covers every MCP pattern, without duplicating on a second run', () => {
    withTmpDir((dir) => {
      writeMcpJson(dir, '.aidev/mcp.json', { fs: { command: 'npx' } });
      materializeMcp(baseConfig({ agents: ['claude', 'cursor'] }), dir);
      materializeMcp(baseConfig({ agents: ['claude', 'cursor'] }), dir);
      const gitignore = fs.readFileSync(path.join(dir, '.gitignore'), 'utf8');
      for (const [pattern] of MCP_GITIGNORE_RULES) {
        const count = gitignore.split('\n').filter((l) => l === pattern).length;
        assert.equal(count, 1, `expected exactly one "${pattern}" line, found ${count}`);
      }
    });
  });

  it('throws on malformed mcp.json (surfacing the file path)', () => {
    withTmpDir((dir) => {
      fs.mkdirSync(path.join(dir, '.aidev'), { recursive: true });
      fs.writeFileSync(path.join(dir, '.aidev', 'mcp.json'), '{ bad', 'utf8');
      assert.throws(() => materializeMcp(baseConfig(), dir), /mcp\.json/);
    });
  });

  it('throws when an explicit MCP_JSON_PATH does not point at a real file', () => {
    withTmpDir((dir) => {
      assert.throws(
        () => materializeMcp(baseConfig({ mcpJsonPath: 'missing/mcp.json' }), dir),
        /MCP config not found/,
      );
    });
  });

  it('writes no agent config files when only aider is configured', () => {
    withTmpDir((dir) => {
      writeMcpJson(dir, '.aidev/mcp.json', { fs: { command: 'npx' } });
      const state = materializeMcp(baseConfig({ agents: ['aider'] }), dir);
      assert.ok(state);
      assert.deepEqual(state!.written, []);
      // The manifest itself is always written (bookkeeping), but no per-agent file is.
      assert.deepEqual(fs.readdirSync(path.join(dir, '.aidev', 'mcp')), ['manifest.json']);
      assert.ok(!fs.existsSync(path.join(dir, '.cursor')));
      assert.ok(!fs.existsSync(path.join(dir, '.devin')));
      assert.ok(!fs.existsSync(path.join(dir, 'opencode.json')));
      assert.ok(!fs.existsSync(path.join(dir, '.codex')));
    });
  });

  it('creates a manifest tracking what it wrote', () => {
    withTmpDir((dir) => {
      writeMcpJson(dir, '.aidev/mcp.json', { fs: { command: 'npx' } });
      materializeMcp(baseConfig({ agents: ['cursor'] }), dir);
      const manifestPath = path.join(dir, '.aidev', 'mcp', 'manifest.json');
      assert.ok(fs.existsSync(manifestPath));
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      assert.ok(path.join('.cursor', 'mcp.json') in manifest);
    });
  });

  it('backs up a hand-authored convention file once before overwriting it', () => {
    withTmpDir((dir) => {
      writeMcpJson(dir, '.aidev/mcp.json', { fs: { command: 'npx' } });
      fs.mkdirSync(path.join(dir, '.cursor'), { recursive: true });
      fs.writeFileSync(path.join(dir, '.cursor', 'mcp.json'), JSON.stringify({ mcpServers: { hand: {} } }), 'utf8');

      materializeMcp(baseConfig({ agents: ['cursor'] }), dir);

      const backupPath = path.join(dir, '.cursor', 'mcp.json.aidev-backup');
      assert.ok(fs.existsSync(backupPath));
      assert.ok(fs.readFileSync(backupPath, 'utf8').includes('hand'));
    });
  });

  it('does not re-backup its own previously-written output on a later run', () => {
    withTmpDir((dir) => {
      writeMcpJson(dir, '.aidev/mcp.json', { fs: { command: 'npx' } });
      materializeMcp(baseConfig({ agents: ['cursor'] }), dir);
      // First run touched a fresh file — no hand-authored content existed, so no backup yet.
      const backupPath = path.join(dir, '.cursor', 'mcp.json.aidev-backup');
      assert.ok(!fs.existsSync(backupPath));

      materializeMcp(baseConfig({ agents: ['cursor'] }), dir);
      assert.ok(!fs.existsSync(backupPath), 'aidev should never back up its own generated content');
    });
  });

  describe('better-mcp mode', () => {
    it('wraps every agent file down to a single better-mcp proxy server', () => {
      withTmpDir((dir) => {
        writeMcpJson(dir, '.aidev/mcp.json', { fs: { command: 'npx' }, gh: { command: 'npx' } });
        mockDockerOnPath(true);

        const state = materializeMcp(baseConfig({ agents: ['claude', 'cursor'], betterMcp: true }), dir);

        assert.ok(state);
        assert.deepEqual(Object.keys(state!.servers), ['better-mcp']);
        const claudeFile = JSON.parse(fs.readFileSync(path.join(dir, '.aidev', 'mcp', 'claude.json'), 'utf8'));
        assert.deepEqual(Object.keys(claudeFile.mcpServers), ['better-mcp']);
      });
    });

    it('preserves a user middleware block in the better-mcp config and forces namespace:true', () => {
      withTmpDir((dir) => {
        writeMcpJson(dir, '.aidev/mcp.json', { fs: { command: 'npx' } });
        fs.mkdirSync(path.join(dir, '.aidev'), { recursive: true });
        fs.writeFileSync(
          path.join(dir, '.aidev', 'better-mcp.json'),
          JSON.stringify({ namespace: false, middleware: { log: { level: 'debug' } } }),
          'utf8',
        );
        mockDockerOnPath(true);

        materializeMcp(baseConfig({ agents: ['claude'], betterMcp: true }), dir);

        const betterMcpConfig = JSON.parse(fs.readFileSync(path.join(dir, '.aidev', 'better-mcp.json'), 'utf8'));
        assert.equal(betterMcpConfig.namespace, true);
        assert.deepEqual(betterMcpConfig.middleware, { log: { level: 'debug' } });
        assert.deepEqual(betterMcpConfig.mcpServers, { fs: { command: 'npx' } });
      });
    });

    it('falls back to raw servers and warns when docker is not on PATH', () => {
      withTmpDir((dir) => {
        writeMcpJson(dir, '.aidev/mcp.json', { fs: { command: 'npx' } });
        mockDockerOnPath(false);
        const warn = mock.method(logger, 'warn', () => {});

        const state = materializeMcp(baseConfig({ agents: ['claude'], betterMcp: true }), dir);

        assert.ok(state);
        assert.deepEqual(state!.servers, { fs: { command: 'npx' } });
        assert.ok(warn.mock.calls.some((c) => String(c.arguments[0]).includes('docker')));
      });
    });

    it('warns per server when a command is not guaranteed to exist inside the container', () => {
      withTmpDir((dir) => {
        writeMcpJson(dir, '.aidev/mcp.json', {
          fs: { command: 'npx' },
          shellScript: { command: './scripts/run.sh' },
        });
        mockDockerOnPath(true);
        const warn = mock.method(logger, 'warn', () => {});

        materializeMcp(baseConfig({ agents: ['claude'], betterMcp: true }), dir);

        const warnings = warn.mock.calls.map((c) => String(c.arguments[0]));
        assert.ok(warnings.some((m) => m.includes('shellScript') && m.includes('./scripts/run.sh')));
        assert.ok(!warnings.some((m) => m.includes('"fs"') || m.includes('server "fs"')));
      });
    });
  });
});

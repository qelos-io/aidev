import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { sourceShellProfile, mergeNullDelimited, applyEnvFiles, resolveEnvPath, loadConfig, parseAnthropicTokens, pickNextToken, envFileKeys, clearEnvFiles } from '../config';

// ─── mergeNullDelimited ────────────────────────────────────────────────────────

describe('mergeNullDelimited', () => {
  beforeEach(() => {
    delete process.env['__TEST_MERGE_A'];
    delete process.env['__TEST_MERGE_B'];
    delete process.env['__TEST_MERGE_EXISTING'];
  });

  afterEach(() => {
    delete process.env['__TEST_MERGE_A'];
    delete process.env['__TEST_MERGE_B'];
    delete process.env['__TEST_MERGE_EXISTING'];
  });

  it('sets new variables from null-delimited env output', () => {
    mergeNullDelimited('__TEST_MERGE_A=hello\0__TEST_MERGE_B=world\0');
    assert.equal(process.env['__TEST_MERGE_A'], 'hello');
    assert.equal(process.env['__TEST_MERGE_B'], 'world');
  });

  it('does not overwrite variables already in process.env', () => {
    process.env['__TEST_MERGE_EXISTING'] = 'original';
    mergeNullDelimited('__TEST_MERGE_EXISTING=overwritten\0');
    assert.equal(process.env['__TEST_MERGE_EXISTING'], 'original');
  });

  it('handles values containing = signs', () => {
    mergeNullDelimited('__TEST_MERGE_A=a=b=c\0');
    assert.equal(process.env['__TEST_MERGE_A'], 'a=b=c');
  });

  it('skips entries with no = sign', () => {
    mergeNullDelimited('NOEQUALS\0__TEST_MERGE_A=ok\0');
    assert.equal(process.env['__TEST_MERGE_A'], 'ok');
  });

  it('handles empty string without throwing', () => {
    assert.doesNotThrow(() => mergeNullDelimited(''));
  });
});

// ─── sourceShellProfile ────────────────────────────────────────────────────────

// These tests only run on POSIX (macOS / Linux) since Windows uses PowerShell + registry.
const itPosix = process.platform === 'win32' ? it.skip : it;

describe('sourceShellProfile', () => {
  let tmpDir: string;
  const testKey = '__AIDEV_PROFILE_TEST';
  const testKey2 = '__AIDEV_PROFILE_TEST2';

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aidev-profile-test-'));
    delete process.env[testKey];
    delete process.env[testKey2];
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    delete process.env[testKey];
    delete process.env[testKey2];
  });

  itPosix('picks up an exported variable from the profile', () => {
    const rc = path.join(tmpDir, '.testrc');
    fs.writeFileSync(rc, `export ${testKey}=from_profile\n`);

    sourceShellProfile([rc]);

    assert.equal(process.env[testKey], 'from_profile');
  });

  itPosix('profile with alias definitions does not break env sourcing', () => {
    // Aliases are shell-internal and won't appear in process.env, but their
    // presence must not prevent exported variables from being captured.
    const rc = path.join(tmpDir, '.testrc');
    fs.writeFileSync(rc, `alias gst='git status'\nexport ${testKey}=alongside_alias\n`);

    sourceShellProfile([rc]);

    assert.equal(process.env[testKey], 'alongside_alias');
    // Aliases are not environment variables — they must not leak into process.env
    assert.equal(process.env['gst'], undefined);
  });

  itPosix('does not overwrite an already-set variable', () => {
    process.env[testKey] = 'existing';
    const rc = path.join(tmpDir, '.testrc');
    fs.writeFileSync(rc, `export ${testKey}=from_profile\n`);

    sourceShellProfile([rc]);

    assert.equal(process.env[testKey], 'existing');
  });

  itPosix('sources multiple profile files in order', () => {
    const rc1 = path.join(tmpDir, '.rc1');
    const rc2 = path.join(tmpDir, '.rc2');
    fs.writeFileSync(rc1, `export ${testKey}=from_rc1\n`);
    fs.writeFileSync(rc2, `export ${testKey2}=from_rc2\n`);

    sourceShellProfile([rc1, rc2]);

    assert.equal(process.env[testKey], 'from_rc1');
    assert.equal(process.env[testKey2], 'from_rc2');
  });

  itPosix('silently ignores non-existent profile files', () => {
    const missing = path.join(tmpDir, 'does_not_exist');
    const rc = path.join(tmpDir, '.testrc');
    fs.writeFileSync(rc, `export ${testKey}=still_works\n`);

    assert.doesNotThrow(() => sourceShellProfile([missing, rc]));
    assert.equal(process.env[testKey], 'still_works');
  });

  itPosix('exported variable propagates to child processes after sourcing', () => {
    const rc = path.join(tmpDir, '.testrc');
    fs.writeFileSync(rc, `export ${testKey}=child_test_value\n`);
    sourceShellProfile([rc]);

    assert.equal(process.env[testKey], 'child_test_value');

    // Simulate how aidev spawns AI runners (claude, cursor, etc.) — they inherit process.env
    const child = spawnSync(
      process.execPath, // node
      ['-e', `process.stdout.write(process.env['${testKey}'] || 'NOT_FOUND')`],
      { encoding: 'utf8', env: process.env }
    );
    assert.equal(child.stdout, 'child_test_value');
  });

  itPosix('variable with special characters in value is captured correctly', () => {
    const rc = path.join(tmpDir, '.testrc');
    fs.writeFileSync(rc, `export ${testKey}="hello=world:path/to/thing"\n`);

    sourceShellProfile([rc]);

    assert.equal(process.env[testKey], 'hello=world:path/to/thing');
  });
});

// ─── applyEnvFiles (AIDEV_ENV_EXTEND) ─────────────────────────────────────────

const EXT_A = '__AIDEV_EXT_A';
const EXT_B = '__AIDEV_EXT_B';
const EXT_C = '__AIDEV_EXT_C';
const EXT_ALL = [EXT_A, EXT_B, EXT_C, 'AIDEV_ENV_EXTEND'];

describe('applyEnvFiles', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aidev-envfiles-'));
    EXT_ALL.forEach((k) => delete process.env[k]);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    EXT_ALL.forEach((k) => delete process.env[k]);
  });

  it('loads variables from a local env file', () => {
    const local = path.join(tmpDir, '.env.aidev');
    fs.writeFileSync(local, `${EXT_A}=from_local\n`);

    applyEnvFiles(local);

    assert.equal(process.env[EXT_A], 'from_local');
  });

  it('loads global extend file values as base', () => {
    const global = path.join(tmpDir, '.aidev.global');
    fs.writeFileSync(global, `${EXT_A}=from_global\n${EXT_B}=global_only\n`);
    const local = path.join(tmpDir, '.env.aidev');
    fs.writeFileSync(local, `${EXT_A}=from_local\n`);

    applyEnvFiles(local, global);

    // local wins over global for EXT_A
    assert.equal(process.env[EXT_A], 'from_local');
    // global-only key is still loaded
    assert.equal(process.env[EXT_B], 'global_only');
  });

  it('local .env.aidev AIDEV_ENV_EXTEND entry is used when no explicit path given', () => {
    const global = path.join(tmpDir, '.aidev.global');
    fs.writeFileSync(global, `${EXT_B}=from_global_via_local_ref\n`);

    const local = path.join(tmpDir, '.env.aidev');
    fs.writeFileSync(local, `AIDEV_ENV_EXTEND=${global}\n${EXT_A}=local_val\n`);

    applyEnvFiles(local);

    assert.equal(process.env[EXT_A], 'local_val');
    assert.equal(process.env[EXT_B], 'from_global_via_local_ref');
  });

  it('process.env variables override both local and global', () => {
    process.env[EXT_A] = 'shell_value';

    const global = path.join(tmpDir, '.aidev.global');
    fs.writeFileSync(global, `${EXT_A}=global_value\n`);
    const local = path.join(tmpDir, '.env.aidev');
    fs.writeFileSync(local, `${EXT_A}=local_value\n`);

    applyEnvFiles(local, global);

    assert.equal(process.env[EXT_A], 'shell_value');
  });

  it('explicit envExtend arg overrides AIDEV_ENV_EXTEND entry inside local file', () => {
    const globalA = path.join(tmpDir, 'global_a');
    fs.writeFileSync(globalA, `${EXT_A}=from_global_a\n`);
    const globalB = path.join(tmpDir, 'global_b');
    fs.writeFileSync(globalB, `${EXT_B}=from_global_b\n`);

    const local = path.join(tmpDir, '.env.aidev');
    // local points to globalA via AIDEV_ENV_EXTEND, but caller passes globalB explicitly
    fs.writeFileSync(local, `AIDEV_ENV_EXTEND=${globalA}\n`);

    applyEnvFiles(local, globalB);

    // globalB was used (explicit wins)
    assert.equal(process.env[EXT_B], 'from_global_b');
    // globalA was NOT used
    assert.equal(process.env[EXT_A], undefined);
  });

  it('silently skips a missing global file', () => {
    const missing = path.join(tmpDir, 'does_not_exist');
    const local = path.join(tmpDir, '.env.aidev');
    fs.writeFileSync(local, `${EXT_A}=still_works\n`);

    assert.doesNotThrow(() => applyEnvFiles(local, missing));
    assert.equal(process.env[EXT_A], 'still_works');
  });

  it('works when no local file exists', () => {
    const global = path.join(tmpDir, '.aidev.global');
    fs.writeFileSync(global, `${EXT_A}=global_only\n`);

    applyEnvFiles(undefined, global);

    assert.equal(process.env[EXT_A], 'global_only');
  });

  it('vars loaded from global file propagate to child processes', () => {
    const global = path.join(tmpDir, '.aidev.global');
    fs.writeFileSync(global, `${EXT_C}=child_sees_this\n`);

    applyEnvFiles(undefined, global);
    assert.equal(process.env[EXT_C], 'child_sees_this');

    const child = spawnSync(
      process.execPath,
      ['-e', `process.stdout.write(process.env['${EXT_C}'] || 'NOT_FOUND')`],
      { encoding: 'utf8', env: process.env }
    );
    assert.equal(child.stdout, 'child_sees_this');
  });

  it('resolves AIDEV_ENV_EXTEND relative path against local file directory', () => {
    // global file sits alongside .env.aidev
    const global = path.join(tmpDir, '.aidev.global');
    fs.writeFileSync(global, `${EXT_B}=relative_global\n`);

    const local = path.join(tmpDir, '.env.aidev');
    // stored as a relative path in the local file
    fs.writeFileSync(local, `AIDEV_ENV_EXTEND=.aidev.global\n${EXT_A}=local_val\n`);

    applyEnvFiles(local);

    assert.equal(process.env[EXT_A], 'local_val');
    assert.equal(process.env[EXT_B], 'relative_global');
  });
});

describe('envFileKeys / clearEnvFiles', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aidev-envkeys-'));
    EXT_ALL.forEach((k) => delete process.env[k]);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    EXT_ALL.forEach((k) => delete process.env[k]);
  });

  it('returns keys from local and extend files', () => {
    const global = path.join(tmpDir, '.aidev.global');
    fs.writeFileSync(global, `${EXT_B}=global_only\n`);
    const local = path.join(tmpDir, '.env.aidev');
    fs.writeFileSync(local, `AIDEV_ENV_EXTEND=${global}\n${EXT_A}=local_val\n`);

    const keys = envFileKeys(local).sort();
    assert.deepEqual(keys, ['AIDEV_ENV_EXTEND', EXT_A, EXT_B].sort());
  });

  it('clearEnvFiles removes stale shell overrides for extend-only keys', () => {
    const global = path.join(tmpDir, '.aidev.global');
    fs.writeFileSync(global, `${EXT_B}=from_global\n`);
    const local = path.join(tmpDir, '.env.aidev');
    fs.writeFileSync(local, `AIDEV_ENV_EXTEND=${global}\n`);

    process.env[EXT_B] = 'stale_shell';

    clearEnvFiles(local);
    applyEnvFiles(local);

    assert.equal(process.env[EXT_B], 'from_global');
  });
});

// ─── resolveEnvPath ────────────────────────────────────────────────────────────

describe('resolveEnvPath', () => {
  it('returns absolute paths unchanged', () => {
    assert.equal(resolveEnvPath('/etc/aidev.global', '/any/base'), '/etc/aidev.global');
  });

  it('expands ~ to the home directory', () => {
    const result = resolveEnvPath('~/.aidev.global', '/any/base');
    assert.equal(result, path.join(os.homedir(), '.aidev.global'));
  });

  it('expands ~/subdir correctly', () => {
    const result = resolveEnvPath('~/conf/aidev.global', '/any/base');
    assert.equal(result, path.join(os.homedir(), 'conf/aidev.global'));
  });

  it('resolves relative paths against the supplied base', () => {
    const base = '/projects/myapp';
    const result = resolveEnvPath('.aidev.global', base);
    assert.equal(result, path.resolve(base, '.aidev.global'));
  });

  it('resolves ../ relative paths correctly', () => {
    const base = '/projects/myapp';
    const result = resolveEnvPath('../shared/aidev.global', base);
    assert.equal(result, path.resolve(base, '../shared/aidev.global'));
  });
});

// ─── loadConfig tag defaults ──────────────────────────────────────────────────

describe('loadConfig tag defaults', () => {
  const envKeys = [
    'CLICKUP_API_KEY', 'CLICKUP_TEAM_ID', 'CLICKUP_TAG',
    'NON_CODE_TAG', 'JIRA_LABEL', 'PROVIDER',
    'ACCEPTED_TAG',
  ];
  const saved: Record<string, string | undefined> = {};
  let tmpDir: string;
  let origCwd: string;

  beforeEach(() => {
    for (const k of envKeys) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aidev-tagdefault-'));
    origCwd = process.cwd();
    process.chdir(tmpDir);
    // Minimal .env.aidev with only required ClickUp fields
    fs.writeFileSync(
      path.join(tmpDir, '.env.aidev'),
      'CLICKUP_API_KEY=pk_test\nCLICKUP_TEAM_ID=12345\n',
    );
  });

  afterEach(() => {
    process.chdir(origCwd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
    for (const k of envKeys) {
      if (saved[k] !== undefined) process.env[k] = saved[k];
      else delete process.env[k];
    }
  });

  it('defaults clickupTag to the folder name when CLICKUP_TAG is unset', () => {
    const config = loadConfig();
    const folderName = path.basename(tmpDir);
    assert.equal(config.clickupTag, folderName);
  });

  it('defaults nonCodeTag to folder-name + "-other" when NON_CODE_TAG is unset', () => {
    const config = loadConfig();
    const folderName = path.basename(tmpDir);
    assert.equal(config.nonCodeTag, `${folderName}-other`);
  });

  it('defaults jiraLabel to the folder name when JIRA_LABEL is unset', () => {
    const config = loadConfig();
    const folderName = path.basename(tmpDir);
    assert.equal(config.jiraLabel, folderName);
  });

  it('respects explicit CLICKUP_TAG when set', () => {
    process.env.CLICKUP_TAG = 'custom-tag';
    const config = loadConfig();
    assert.equal(config.clickupTag, 'custom-tag');
    delete process.env.CLICKUP_TAG;
  });

  it('respects explicit NON_CODE_TAG when set', () => {
    process.env.NON_CODE_TAG = 'my-noncode';
    const config = loadConfig();
    assert.equal(config.nonCodeTag, 'my-noncode');
    delete process.env.NON_CODE_TAG;
  });

  it('does not require CLICKUP_TAG in env', () => {
    assert.doesNotThrow(() => loadConfig());
  });

  it('defaults acceptedTag to "accepted" when ACCEPTED_TAG is unset', () => {
    delete process.env.ACCEPTED_TAG;
    const config = loadConfig();
    assert.equal(config.acceptedTag, 'accepted');
  });

  it('respects explicit ACCEPTED_TAG when set', () => {
    process.env.ACCEPTED_TAG = 'approved';
    try {
      const config = loadConfig();
      assert.equal(config.acceptedTag, 'approved');
    } finally {
      delete process.env.ACCEPTED_TAG;
    }
  });
});

// ─── loadConfig AGENTS parsing ────────────────────────────────────────────────

describe('loadConfig AGENTS parsing', () => {
  const envKeys = [
    'CLICKUP_API_KEY', 'CLICKUP_TEAM_ID', 'AGENTS', 'PROVIDER',
  ];
  const saved: Record<string, string | undefined> = {};
  let tmpDir: string;
  let origCwd: string;

  beforeEach(() => {
    for (const k of envKeys) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aidev-agents-'));
    origCwd = process.cwd();
    process.chdir(tmpDir);
  });

  afterEach(() => {
    process.chdir(origCwd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
    for (const k of envKeys) {
      if (saved[k] !== undefined) process.env[k] = saved[k];
      else delete process.env[k];
    }
  });

  function writeEnv(content: string): void {
    fs.writeFileSync(
      path.join(tmpDir, '.env.aidev'),
      `CLICKUP_API_KEY=pk_test\nCLICKUP_TEAM_ID=12345\n${content}`,
    );
  }

  it('defaults to claude,cursor when AGENTS is not set', () => {
    writeEnv('');
    const config = loadConfig();
    assert.deepEqual(config.agents, ['claude', 'cursor']);
  });

  it('parses AGENTS from env file and preserves order', () => {
    writeEnv('AGENTS=cursor,windsurf,claude');
    const config = loadConfig();
    assert.deepEqual(config.agents, ['cursor', 'windsurf', 'claude']);
  });

  it('parses AGENTS with reversed order', () => {
    writeEnv('AGENTS=claude,windsurf,cursor');
    const config = loadConfig();
    assert.deepEqual(config.agents, ['claude', 'windsurf', 'cursor']);
  });

  it('handles single agent', () => {
    writeEnv('AGENTS=cursor');
    const config = loadConfig();
    assert.deepEqual(config.agents, ['cursor']);
  });

  it('trims whitespace around agent names', () => {
    writeEnv('AGENTS= cursor , claude ');
    const config = loadConfig();
    assert.deepEqual(config.agents, ['cursor', 'claude']);
  });

  it('handles quoted value in env file (dotenv strips quotes)', () => {
    writeEnv('AGENTS="cursor,windsurf,claude"');
    const config = loadConfig();
    assert.deepEqual(config.agents, ['cursor', 'windsurf', 'claude']);
  });

  it('throws on invalid agent name', () => {
    writeEnv('AGENTS=cursor,invalid_agent');
    assert.throws(() => loadConfig(), /Invalid agent/);
  });

  it('falls back to default when AGENTS is empty string (falsy)', () => {
    process.env.AGENTS = '';
    writeEnv('');
    const config = loadConfig();
    assert.deepEqual(config.agents, ['claude', 'cursor']);
  });

  it('throws when AGENTS contains only commas (no valid agents)', () => {
    process.env.AGENTS = ',,,';
    writeEnv('');
    assert.throws(() => loadConfig(), /at least one agent/);
  });

  it('process.env AGENTS overrides env file value', () => {
    process.env.AGENTS = 'claude';
    writeEnv('AGENTS=cursor,windsurf,claude');
    const config = loadConfig();
    assert.deepEqual(config.agents, ['claude']);
    delete process.env.AGENTS;
  });

  it('accepts anthropic-sdk as a valid agent', () => {
    writeEnv('AGENTS=anthropic-sdk');
    const config = loadConfig();
    assert.deepEqual(config.agents, ['anthropic-sdk']);
  });

  it('accepts anthropic-sdk alongside other agents', () => {
    writeEnv('AGENTS=claude,anthropic-sdk,cursor');
    const config = loadConfig();
    assert.deepEqual(config.agents, ['claude', 'anthropic-sdk', 'cursor']);
  });
});

// ─── parseAnthropicTokens ─────────────────────────────────────────────────────

describe('parseAnthropicTokens', () => {
  it('returns an empty array for an empty string', () => {
    assert.deepEqual(parseAnthropicTokens(''), []);
  });

  it('parses a single token', () => {
    assert.deepEqual(parseAnthropicTokens('sk-ant-key-1'), ['sk-ant-key-1']);
  });

  it('parses multiple comma-separated tokens', () => {
    assert.deepEqual(
      parseAnthropicTokens('sk-ant-key-1,sk-ant-key-2,sk-ant-key-3'),
      ['sk-ant-key-1', 'sk-ant-key-2', 'sk-ant-key-3'],
    );
  });

  it('trims whitespace around tokens', () => {
    assert.deepEqual(
      parseAnthropicTokens(' sk-ant-key-1 , sk-ant-key-2 '),
      ['sk-ant-key-1', 'sk-ant-key-2'],
    );
  });

  it('drops empty entries from trailing or consecutive commas', () => {
    assert.deepEqual(
      parseAnthropicTokens('sk-ant-key-1,,sk-ant-key-2,'),
      ['sk-ant-key-1', 'sk-ant-key-2'],
    );
  });

  it('returns an empty array for a string of only commas and whitespace', () => {
    assert.deepEqual(parseAnthropicTokens(' , , , '), []);
  });
});

// ─── pickNextToken ────────────────────────────────────────────────────────────

describe('pickNextToken', () => {
  it('returns undefined token and cursor 0 for an empty list', () => {
    assert.deepEqual(pickNextToken([], 0), { token: undefined, nextCursor: 0 });
    assert.deepEqual(pickNextToken([], 5), { token: undefined, nextCursor: 0 });
  });

  it('returns the only token and wraps cursor to 0 for a single-token list', () => {
    assert.deepEqual(pickNextToken(['a'], 0), { token: 'a', nextCursor: 0 });
    assert.deepEqual(pickNextToken(['a'], 1), { token: 'a', nextCursor: 0 });
  });

  it('rotates through tokens in order', () => {
    const tokens = ['a', 'b', 'c'];
    let cursor = 0;
    const seen: string[] = [];
    for (let i = 0; i < 6; i++) {
      const { token, nextCursor } = pickNextToken(tokens, cursor);
      seen.push(token!);
      cursor = nextCursor;
    }
    assert.deepEqual(seen, ['a', 'b', 'c', 'a', 'b', 'c']);
  });

  it('wraps cursor back to 0 after the last token', () => {
    assert.deepEqual(pickNextToken(['a', 'b'], 1), { token: 'b', nextCursor: 0 });
  });

  it('normalizes an out-of-range cursor via modulo', () => {
    assert.deepEqual(pickNextToken(['a', 'b', 'c'], 7), { token: 'b', nextCursor: 2 });
  });
});

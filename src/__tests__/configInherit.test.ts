import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { loadConfigWithInheritance } from '../config';
import { LOCK_FILENAME } from '../lockfile';
import { startConfigServer, type ConfigInheritPayload } from '../ipc';
import type { Config } from '../types';

// A minimal `local`-provider Config with every field populated so deepEqual
// comparisons are stable. Mirrors the makePayload pattern in ipc.test.ts.
function makeFakeConfig(projectName: string): Config {
  return {
    provider: 'local',
    clickupApiKey: '',
    clickupTeamId: '',
    clickupTag: '',
    clickupPendingStatus: '',
    clickupOpenStatus: '',
    clickupInReviewStatus: '',
    jiraBaseUrl: '',
    jiraEmail: '',
    jiraApiToken: '',
    jiraProject: '',
    jiraLabel: '',
    jiraPendingStatus: '',
    jiraInReviewStatus: '',
    linearApiKey: '',
    linearTeamId: '',
    linearLabel: '',
    linearPendingStatus: '',
    linearInReviewStatus: '',
    mondayApiToken: '',
    mondayBoardId: '',
    mondayStatusColumnId: '',
    mondayGroupId: '',
    mondayTagColumnId: '',
    notionApiKey: '',
    notionDatabaseId: '',
    notionStatusProperty: '',
    notionPendingStatus: '',
    notionInReviewStatus: '',
    trelloApiKey: '',
    trelloToken: '',
    trelloBoardId: '',
    trelloLabel: '',
    trelloOpenList: '',
    trelloPendingList: '',
    trelloInProgressList: '',
    trelloInReviewList: '',
    trelloOpenStatus: '',
    trelloPendingStatus: '',
    trelloInReviewStatus: '',
    nonCodeTag: '',
    nonCodeClickupTeamId: '',
    nonCodeJiraProject: '',
    nonCodeLinearTeamId: '',
    consultTag: '',
    consultedTag: '',
    projectName,
    clickupListId: '',
    assigneeTag: '',
    gitRemote: '',
    githubBaseBranch: '',
    githubRepo: '',
    agents: ['claude'],
    devNotesMode: 'smart',
    triggerWord: '',
    thinkingTag: '',
    planningTag: '',
    commentPrefix: '',
    hooksPath: '',
    acceptedTag: '',
    autoApprove: false,
    agentReviewTag: '',
    autoReview: false,
    doneStatus: '',
    autoCompress: false,
    compressThreshold: 0,
    logTtlDays: 0,
    safeMode: false,
    mcpJsonPath: '',
    betterMcp: false,
    betterMcpConfigPath: '',
  };
}

const envKeysToSave = ['PROVIDER', 'AGENTS', 'AIDEV_INHERIT_TEST_ENV'];

describe('loadConfigWithInheritance — fallback to disk', () => {
  let tmpDir: string;
  let origCwd: string;
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of envKeysToSave) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aidev-inherit-disk-'));
    origCwd = process.cwd();
    process.chdir(tmpDir);
    // Minimal env file: local provider needs no API keys.
    fs.writeFileSync(path.join(tmpDir, '.env.aidev'), 'PROVIDER=local\n', 'utf8');
  });

  afterEach(() => {
    process.chdir(origCwd);
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
    for (const k of envKeysToSave) {
      if (saved[k] !== undefined) process.env[k] = saved[k];
      else delete process.env[k];
    }
  });

  it('falls back to disk loading when no .aidev.lock exists in CWD', async () => {
    // No lock file written — common case.
    const config = await loadConfigWithInheritance();
    assert.equal(config.provider, 'local');
    // Disk loading derives projectName from the CWD folder name.
    assert.equal(config.projectName, path.basename(tmpDir));
  });

  it('skips inheritance when the lock points to a non-ancestor PID', async () => {
    // A PID far outside our process tree and almost certainly not alive.
    fs.writeFileSync(path.join(tmpDir, LOCK_FILENAME), String(process.pid + 99999), 'utf8');
    const config = await loadConfigWithInheritance();
    assert.equal(config.provider, 'local');
    assert.equal(config.projectName, path.basename(tmpDir));
  });

  it('skips inheritance when the lock points to the current process (self)', async () => {
    fs.writeFileSync(path.join(tmpDir, LOCK_FILENAME), String(process.pid), 'utf8');
    const config = await loadConfigWithInheritance();
    assert.equal(config.provider, 'local');
    assert.equal(config.projectName, path.basename(tmpDir));
  });
});

describe('loadConfigWithInheritance — inherits parent config over IPC', () => {
  let tmpDir: string;
  let origCwd: string;
  let server: { close(): void } | null = null;
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    savedEnv['AIDEV_INHERIT_TEST_ENV'] = process.env['AIDEV_INHERIT_TEST_ENV'];
    delete process.env['AIDEV_INHERIT_TEST_ENV'];
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aidev-inherit-ipc-'));
    origCwd = process.cwd();
  });

  afterEach(() => {
    if (server) {
      try { server.close(); } catch { /* ignore */ }
      server = null;
    }
    process.chdir(origCwd);
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
    if (savedEnv['AIDEV_INHERIT_TEST_ENV'] !== undefined) {
      process.env['AIDEV_INHERIT_TEST_ENV'] = savedEnv['AIDEV_INHERIT_TEST_ENV'];
    } else {
      delete process.env['AIDEV_INHERIT_TEST_ENV'];
    }
  });

  it('adopts the parent Config and env when the lock points to a live ancestor', async () => {
    // process.ppid is a real, live ancestor of this process.
    const ancestorPid = process.ppid;
    assert.ok(ancestorPid && ancestorPid > 1, 'test requires a resolvable parent process');

    const fakeConfig = makeFakeConfig('inherited-project');
    const payload: ConfigInheritPayload = {
      config: fakeConfig,
      env: { AIDEV_INHERIT_TEST_ENV: 'applied-by-parent' },
      pid: ancestorPid,
    };

    // Start the config server bound to the ancestor's PID socket path.
    server = startConfigServer(payload, ancestorPid);

    // chdir into the temp dir and drop a lock pointing at the ancestor.
    process.chdir(tmpDir);
    fs.writeFileSync(path.join(tmpDir, LOCK_FILENAME), String(ancestorPid), 'utf8');

    const config = await loadConfigWithInheritance();

    // The returned config must be the parent's, wholesale.
    assert.deepEqual(config, fakeConfig);
    // The parent's env vars must have been applied to process.env.
    assert.equal(process.env['AIDEV_INHERIT_TEST_ENV'], 'applied-by-parent');
  });
});

import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { mock } from 'node:test';
import { requestConfig, configSocketPath, type ConfigInheritPayload } from '../ipc';
import { runCommand } from '../commands/run';
import { logger } from '../logger';
import { LOCK_FILENAME } from '../lockfile';
import type { Config } from '../types';
import type { TaskProvider } from '../providers/base';
import type { AIRunner } from '../ai/base';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const netModule = require('node:net');

function makeConfig(overrides: Partial<Config> = {}): Config {
  return {
    provider: 'local',
    clickupApiKey: '',
    clickupTeamId: '',
    clickupTag: '',
    clickupPendingStatus: 'pending',
    clickupOpenStatus: 'open',
    clickupInReviewStatus: 'review',
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
    projectName: 'runipc-test',
    clickupListId: '',
    assigneeTag: '',
    gitRemote: 'origin',
    githubBaseBranch: 'main',
    githubRepo: '',
    agents: ['claude'],
    devNotesMode: 'smart',
    triggerWord: 'aidev-continue',
    thinkingTag: '',
    planningTag: '',
    commentPrefix: '[aidev]',
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
    ...overrides,
  };
}

function makeProvider(overrides: Partial<TaskProvider> = {}): TaskProvider {
  return {
    fetchTasks: async () => [],
    fetchTasksByStatus: async () => [],
    getComments: async () => [],
    postComment: async () => {},
    updateStatus: async () => {},
    ...overrides,
  } as TaskProvider;
}

// ─── Subprocess end-to-end test ──────────────────────────────────────────────
//
// Spawns a real `node` subprocess that imports `startConfigServer`, writes a
// `.aidev.lock` containing its own PID into a temp dir, and serves a fake
// payload. The parent then reads the lock to discover the child PID and calls
// `requestConfig(childPid)`, validating the socket path convention end-to-end.

describe('run IPC — end-to-end socket convention', () => {
  let tmpDir: string;
  let scriptPath: string;
  let child: ChildProcess | null = null;

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aidev-runipc-'));
    scriptPath = path.join(tmpDir, 'child.ts');
    const script = `
import { startConfigServer, type ConfigInheritPayload } from ${JSON.stringify(path.resolve(__dirname, '..', 'ipc'))};
import * as fs from 'node:fs';
import * as path from 'node:path';

const lockPath = process.argv[2];
const readyPath = process.argv[3];
const donePath = process.argv[4];

const pid = process.pid;
fs.writeFileSync(lockPath, String(pid), 'utf8');

const payload: ConfigInheritPayload = {
  config: {
    provider: 'local',
    projectName: 'child-project',
    agents: ['claude'],
    devNotesMode: 'smart',
    triggerWord: 'aidev-continue',
    commentPrefix: '[aidev]',
    autoApprove: false,
    autoReview: false,
    autoCompress: false,
    compressThreshold: 0,
    logTtlDays: 0,
    safeMode: false,
    betterMcp: false,
  } as unknown as Config,
  env: { AIDEV_FOO: 'bar', AIDEV_BAZ: 'qux' },
  pid,
};

const server = startConfigServer(payload, pid);
fs.writeFileSync(readyPath, 'ready', 'utf8');

// Exit when the parent drops a "done" marker file.
const check = setInterval(() => {
  if (fs.existsSync(donePath)) {
    clearInterval(check);
    server.close();
    process.exit(0);
  }
}, 25);
process.on('SIGTERM', () => { server.close(); process.exit(0); });
`;
    fs.writeFileSync(scriptPath, script, 'utf8');
  });

  after(() => {
    if (child && child.exitCode === null) {
      try { child.kill('SIGTERM'); } catch { /* ignore */ }
    }
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it('serves a payload that requestConfig returns via the lock-discovered PID', async () => {
    const lockPath = path.join(tmpDir, LOCK_FILENAME);
    const readyPath = path.join(tmpDir, 'ready');
    const donePath = path.join(tmpDir, 'done');

    child = spawn(process.execPath, ['--require', 'tsx/cjs', scriptPath, lockPath, readyPath, donePath], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
    });

    // Surface any child errors for debugging.
    let stderr = '';
    child.stderr?.on('data', (c: Buffer) => { stderr += c.toString(); });

    // Wait for the child to signal readiness (lock + server listening).
    const deadline = Date.now() + 5000;
    while (!fs.existsSync(readyPath) && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 25));
    }
    assert.ok(fs.existsSync(readyPath), `child did not become ready in time. stderr: ${stderr}`);

    const lockRaw = fs.readFileSync(lockPath, 'utf8').trim();
    const childPid = parseInt(lockRaw, 10);
    assert.ok(Number.isInteger(childPid) && childPid > 0, `invalid lock pid: ${lockRaw}`);

    const got = await requestConfig(childPid, 3000);
    assert.ok(got, 'expected a payload from the child server');
    assert.equal(got!.pid, childPid);
    assert.equal(got!.env.AIDEV_FOO, 'bar');
    assert.equal(got!.env.AIDEV_BAZ, 'qux');
    assert.equal(got!.config.projectName, 'child-project');

    // Tell the child to shut down cleanly.
    fs.writeFileSync(donePath, 'done', 'utf8');
    await new Promise<void>((resolve) => {
      if (child!.exitCode !== null) return resolve();
      child!.once('exit', () => resolve());
    });
  });
});

// ─── Unit: runCommand does not abort when startConfigServer throws ───────────

describe('runCommand — IPC server start failure is non-fatal', () => {
  let originalCwd: string;
  let tmpDir: string;

  before(() => {
    originalCwd = process.cwd();
  });

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aidev-runipc-unit-'));
    process.chdir(tmpDir);
  });

  afterEach(() => {
    mock.restoreAll();
    process.chdir(originalCwd);
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it('logs a warning and completes the run when startConfigServer throws', async () => {
    const warnMock = mock.method(logger, 'warn', () => {});

    // Force startConfigServer to throw synchronously by making net.createServer
    // reject. (The `startConfigServer` export is a non-configurable getter under
    // tsx, so it cannot be mocked directly; mocking the underlying net call keeps
    // the test focused on runCommand's error-handling path.)
    const createServerMock = mock.method(netModule, 'createServer', () => {
      throw new Error('socket unavailable');
    });

    const config = makeConfig();
    const provider = makeProvider();
    const runners: AIRunner[] = [];

    // Should not throw — the run flow must proceed past the IPC failure.
    await runCommand('all', config, provider, runners);

    assert.ok(createServerMock.mock.calls.length > 0, 'net.createServer should have been invoked by startConfigServer');
    const warned = warnMock.mock.calls.some((c) => {
      const msg = String(c.arguments[0] ?? '');
      return msg.includes('config-sharing IPC server') || msg.includes('socket unavailable');
    });
    assert.ok(warned, 'expected a warning about the IPC server failure');
  });
});

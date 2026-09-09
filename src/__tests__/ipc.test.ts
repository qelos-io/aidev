import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import {
  configSocketPath,
  startConfigServer,
  requestConfig,
  type ConfigInheritPayload,
} from '../ipc';
import type { Config } from '../types';

// Use large random PIDs to avoid clashing with a real process. Each test gets
// its own PID so concurrent/sequential servers never collide on the socket
// (Windows named pipes can linger briefly after close()).
let pidCounter = 2_000_000_000 + Math.floor(Math.random() * 1_000_000);
function nextPid(): number {
  pidCounter += 1;
  return pidCounter;
}

function makePayload(pid: number): ConfigInheritPayload {
  const config: Config = {
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
    projectName: 'test-project',
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
  return {
    config,
    env: { AIDEV_FOO: 'bar', AIDEV_LOG_PATH: '/tmp/log' },
    pid,
  };
}

const servers: Array<{ close(): void }> = [];
const usedPids: number[] = [];

afterEach(() => {
  for (const s of servers.splice(0)) {
    try { s.close(); } catch { /* ignore */ }
  }
  // Best-effort cleanup of any leftover socket files on POSIX.
  if (process.platform !== 'win32') {
    for (const pid of usedPids) {
      try {
        const p = configSocketPath(pid);
        if (fs.existsSync(p)) fs.unlinkSync(p);
      } catch { /* ignore */ }
    }
  }
});

describe('configSocketPath', () => {
  it('returns a string containing the pid', () => {
    const p = configSocketPath(12345);
    assert.equal(typeof p, 'string');
    assert.ok(p.includes('12345'), `expected pid in path, got ${p}`);
  });
});

describe('startConfigServer / requestConfig', () => {
  it('serves a payload that requestConfig returns (deep-equal)', async () => {
    const pid = nextPid();
    usedPids.push(pid);
    const payload = makePayload(pid);
    const server = startConfigServer(payload, pid);
    servers.push(server);

    const got = await requestConfig(pid);
    assert.ok(got, 'expected a payload, got null');
    assert.deepEqual(got!.config, payload.config);
    assert.deepEqual(got!.env, payload.env);
    assert.equal(got!.pid, pid);
  });

  it('resolves null when no server is listening for the pid', async () => {
    const pid = nextPid();
    usedPids.push(pid);
    const start = Date.now();
    const got = await requestConfig(pid, 500);
    const elapsed = Date.now() - start;
    assert.equal(got, null);
    // Should resolve within a reasonable window around the timeout.
    assert.ok(elapsed < 2000, `took too long: ${elapsed}ms`);
  });

  it('resolves null on a very short timeout against a slow server', async () => {
    // Start a server that accepts connections but never responds.
    const pid = nextPid();
    usedPids.push(pid);
    const socketPath = configSocketPath(pid);
    const isPosix = process.platform !== 'win32';
    if (isPosix) {
      try { if (fs.existsSync(socketPath)) fs.unlinkSync(socketPath); } catch { /* ignore */ }
    }

    const net = await import('node:net');
    const silentServer = net.createServer((socket) => {
      // Accept but never write back.
      socket.on('error', () => { /* ignore */ });
    });
    silentServer.listen(socketPath);
    if (isPosix) {
      try { fs.chmodSync(socketPath, 0o600); } catch { /* ignore */ }
    }
    servers.push({
      close: () => {
        try { silentServer.close(); } catch { /* ignore */ }
        if (isPosix) {
          try { if (fs.existsSync(socketPath)) fs.unlinkSync(socketPath); } catch { /* ignore */ }
        }
      },
    });

    const start = Date.now();
    const got = await requestConfig(pid, 50);
    const elapsed = Date.now() - start;
    assert.equal(got, null);
    assert.ok(elapsed < 1000, `took too long: ${elapsed}ms`);
  });

  it('ConfigServer.close() stops the server; subsequent requestConfig resolves null', async () => {
    const pid = nextPid();
    usedPids.push(pid);
    const payload = makePayload(pid);
    const server = startConfigServer(payload, pid);

    // Sanity check: server works before close.
    const first = await requestConfig(pid);
    assert.ok(first, 'expected payload before close');

    server.close();

    const second = await requestConfig(pid, 500);
    assert.equal(second, null);
  });

  it('close() is idempotent and does not throw', () => {
    const pid = nextPid();
    usedPids.push(pid);
    const payload = makePayload(pid);
    const server = startConfigServer(payload, pid);
    assert.doesNotThrow(() => server.close());
    assert.doesNotThrow(() => server.close());
    assert.doesNotThrow(() => server.close());
  });
});

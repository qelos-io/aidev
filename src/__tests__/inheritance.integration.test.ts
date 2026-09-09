import { describe, it, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { LOCK_FILENAME } from '../lockfile';

// End-to-end integration test for child-process config inheritance.
//
// Topology (positive variant):
//   test process
//     └─ server subprocess (starts IPC config server, writes .aidev.lock)
//          └─ loader subprocess (calls loadConfigWithInheritance, writes result)
//
// The loader's parent is the server, so `isAncestorPid(serverPid)` is true in
// the loader, satisfying the ancestry requirement for inheritance. The loader
// chdir()s into the temp dir before loading config, so `.aidev.lock` (which
// points at the server PID) is found in CWD and the loader adopts the parent's
// published Config + env over IPC.
//
// The negative variant spawns the loader directly from the test (no lock file)
// so it falls back to disk-based loading from a minimal `.env.aidev`.
//
// All subprocesses are spawned with cwd = repo root so `tsx/cjs` resolves from
// node_modules; the loader switches into the temp dir itself via chdir().

const repoRoot = path.resolve(__dirname, '..', '..');
const configModulePath = path.resolve(__dirname, '..', 'config');
const ipcModulePath = path.resolve(__dirname, '..', 'ipc');

interface LoaderResult {
  provider: string;
  logPath: string | undefined;
  error?: string;
}

function waitForFile(p: string, timeoutMs: number): Promise<boolean> {
  const start = Date.now();
  return new Promise((resolve) => {
    const check = (): void => {
      if (fs.existsSync(p)) return resolve(true);
      if (Date.now() - start >= timeoutMs) return resolve(false);
      setTimeout(check, 25);
    };
    check();
  });
}

function waitForExit(child: ChildProcess, timeoutMs: number): Promise<number | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), timeoutMs);
    child.once('exit', (code) => {
      clearTimeout(timer);
      resolve(code);
    });
  });
}

describe('child-process config inheritance — end-to-end', () => {
  let tmpDir: string;
  let serverScriptPath: string;
  let loaderScriptPath: string;
  let serverChild: ChildProcess | null = null;

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aidev-inherit-e2e-'));
    serverScriptPath = path.join(tmpDir, 'server.ts');
    loaderScriptPath = path.join(tmpDir, 'loader.ts');

    // The server subprocess: starts the IPC config server with a fake Config,
    // writes its own PID to .aidev.lock, then spawns the loader as its child
    // (so the loader's ancestor chain includes the server). Forwards the
    // loader's exit to a "done" marker the test waits on.
    //
    // Args: <tmpDir> <resultPath> <donePath> <logPath>
    const serverScript = `
import { startConfigServer, type ConfigInheritPayload } from ${JSON.stringify(ipcModulePath)};
import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawn } from 'node:child_process';

const tmpDir = process.argv[2];
const resultPath = process.argv[3];
const donePath = process.argv[4];
const logPath = process.argv[5];

const pid = process.pid;
fs.writeFileSync(path.join(tmpDir, ${JSON.stringify(LOCK_FILENAME)}), String(pid), 'utf8');

const payload: ConfigInheritPayload = {
  config: {
    provider: 'local',
    projectName: 'inherited-e2e',
    agents: ['claude'],
    devNotesMode: 'smart',
    autoApprove: false,
    autoReview: false,
    autoCompress: false,
    compressThreshold: 0,
    logTtlDays: 0,
    safeMode: false,
    betterMcp: false,
  } as unknown as Config,
  env: { AIDEV_LOG_PATH: logPath, PROVIDER: 'local' },
  pid,
};

const server = startConfigServer(payload, pid);

// Spawn the loader as a child of THIS process so its ancestor chain
// includes the server PID (the lock holder). cwd stays at the repo root so
// 'tsx/cjs' resolves from node_modules; the loader chdir()s into tmpDir
// itself before loading config (so .aidev.lock is found in CWD).
const loader = spawn(
  process.execPath,
  ['--require', 'tsx/cjs', ${JSON.stringify(loaderScriptPath)}, resultPath, tmpDir],
  { cwd: ${JSON.stringify(repoRoot)}, stdio: ['ignore', 'pipe', 'pipe'], env: process.env },
);
let stderr = '';
loader.stderr?.on('data', (c: Buffer) => { stderr += c.toString(); });
loader.once('exit', () => {
  server.close();
  try { fs.writeFileSync(donePath, stderr, 'utf8'); } catch { /* ignore */ }
  process.exit(0);
});
process.on('SIGTERM', () => { server.close(); try { loader.kill('SIGTERM'); } catch { /* ignore */ } process.exit(0); });
`;
    fs.writeFileSync(serverScriptPath, serverScript, 'utf8');

    // The loader subprocess: chdir()s into the supplied working dir, calls
    // loadConfigWithInheritance (the async variant), and writes the resulting
    // provider + AIDEV_LOG_PATH to a result file. With a valid ancestor lock
    // it inherits over IPC; without a lock it falls back to disk.
    //
    // Args: <resultPath> <workDir>
    const loaderScript = `
import { loadConfigWithInheritance } from ${JSON.stringify(configModulePath)};
import * as fs from 'node:fs';

const resultPath = process.argv[2];
const workDir = process.argv[3];
process.chdir(workDir);

(async () => {
  try {
    const config = await loadConfigWithInheritance();
    const result = JSON.stringify({
      provider: config.provider,
      logPath: process.env.AIDEV_LOG_PATH,
    });
    fs.writeFileSync(resultPath, result, 'utf8');
  } catch (err) {
    fs.writeFileSync(resultPath, JSON.stringify({ provider: '', logPath: undefined, error: String(err) }), 'utf8');
  }
  process.exit(0);
})();
`;
    fs.writeFileSync(loaderScriptPath, loaderScript, 'utf8');
  });

  after(() => {
    if (serverChild && serverChild.exitCode === null) {
      try { serverChild.kill('SIGTERM'); } catch { /* ignore */ }
    }
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  // Best-effort cleanup of any leftover server between tests.
  afterEach(() => {
    if (serverChild && serverChild.exitCode === null) {
      try { serverChild.kill('SIGTERM'); } catch { /* ignore */ }
    }
    serverChild = null;
  });

  it('inherits the parent Config and env over IPC when the lock points to a live ancestor', async () => {
    const logPath = path.join(tmpDir, 'inherited.log');
    const resultPath = path.join(tmpDir, 'result-positive.json');
    const donePath = path.join(tmpDir, 'done-positive');

    serverChild = spawn(
      process.execPath,
      ['--require', 'tsx/cjs', serverScriptPath, tmpDir, resultPath, donePath, logPath],
      { cwd: repoRoot, stdio: ['ignore', 'pipe', 'pipe'], env: process.env },
    );

    let serverStderr = '';
    serverChild.stderr?.on('data', (c: Buffer) => { serverStderr += c.toString(); });

    // Wait for the server chain to finish (loader exits -> server writes done).
    const exited = await waitForExit(serverChild, 20000);
    assert.ok(exited !== null, `server subprocess did not exit in time. stderr: ${serverStderr}`);

    const doneOk = await waitForFile(donePath, 1000);
    assert.ok(doneOk, 'server did not write done marker');

    assert.ok(fs.existsSync(resultPath), `loader did not write result. server stderr: ${serverStderr}`);
    const result = JSON.parse(fs.readFileSync(resultPath, 'utf8')) as LoaderResult;
    assert.equal(result.error, undefined, `loader errored: ${result.error}`);
    assert.equal(result.provider, 'local', `expected inherited provider 'local', got ${result.provider}`);
    assert.equal(
      result.logPath,
      logPath,
      `expected inherited AIDEV_LOG_PATH '${logPath}', got '${result.logPath}'`,
    );
  });

  it('falls back to disk loading when no .aidev.lock is present', async () => {
    // Use a fresh temp dir with no lock file, only a minimal .env.aidev.
    const diskDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aidev-inherit-disk-e2e-'));
    try {
      fs.writeFileSync(path.join(diskDir, '.env.aidev'), 'PROVIDER=local\n', 'utf8');
      // Ensure no stale lock from a previous run.
      const lockPath = path.join(diskDir, LOCK_FILENAME);
      try { fs.unlinkSync(lockPath); } catch { /* ignore */ }

      const resultPath = path.join(diskDir, 'result-disk.json');
      // Strip config-related env vars so the .env.aidev in diskDir is the
      // authoritative source (applyEnvFiles never overwrites already-set
      // process.env values, and the test runner's env may carry PROVIDER).
      const cleanEnv: Record<string, string> = { ...process.env };
      for (const k of ['PROVIDER', 'AGENTS', 'AIDEV_LOG_PATH', 'AIDEV_ENV_EXTEND']) {
        delete cleanEnv[k];
      }
      const loader = spawn(
        process.execPath,
        ['--require', 'tsx/cjs', loaderScriptPath, resultPath, diskDir],
        { cwd: repoRoot, stdio: ['ignore', 'pipe', 'pipe'], env: cleanEnv },
      );

      let stderr = '';
      loader.stderr?.on('data', (c: Buffer) => { stderr += c.toString(); });

      const code = await waitForExit(loader, 20000);
      assert.ok(code !== null, `loader did not exit in time. stderr: ${stderr}`);

      assert.ok(fs.existsSync(resultPath), `loader did not write result. stderr: ${stderr}`);
      const result = JSON.parse(fs.readFileSync(resultPath, 'utf8')) as LoaderResult;
      assert.equal(result.error, undefined, `loader errored: ${result.error}`);
      assert.equal(result.provider, 'local', `expected disk provider 'local', got ${result.provider}`);
    } finally {
      try { fs.rmSync(diskDir, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  });
});

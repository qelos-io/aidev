import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { AIRunner, AIRunResult } from './base';
import { logger } from '../logger';
import {
  commandExists,
  getUserShellEnv,
  isWindows,
  shouldRetryAgentCliAttempt,
  spawnCommand,
} from '../platform';

/** Docker image for headless Windsurf on Windows. */
const WINDSURF_DOCKER_IMAGE = process.env.WINDSURF_DOCKER_IMAGE || 'windsurfinabox';

/** Max time (ms) to wait for Docker container to finish. */
const DOCKER_TIMEOUT = 10 * 60 * 1000;

export class WindsurfRunner implements AIRunner {
  readonly name = 'windsurf';

  isAvailable(): boolean {
    if (isWindows) return isDockerWindsurfAvailable();
    return commandExists('windsurf');
  }

  async run(prompt: string, notes?: string): Promise<AIRunResult> {
    const fullPrompt = notes ? `${prompt}\n\nAdditional context:\n${notes}` : prompt;

    if (isWindows) return runViaDocker(fullPrompt);
    return runViaCli(fullPrompt);
  }
}

// ─── CLI runner (macOS / Linux) ────────────────────────────────────────────────

async function runViaCli(fullPrompt: string): Promise<AIRunResult> {
  logger.info('Running Windsurf CLI...');
  logger.debug(`Prompt: ${fullPrompt.slice(0, 200)}...`);

  const wasRunning = isWindsurfProcessRunning();
  const cwd = process.cwd();

  const stdinInput = fullPrompt;
  const promptArg = '-';

  const baseArgs = ['--agent', '--print', '--trust', '--workspace', cwd, promptArg];
  const attempts: string[][] = [
    ['--model', 'auto', ...baseArgs],
    ['--reasoning', 'auto', ...baseArgs],
    baseArgs,
  ];

  let result = spawnCommand('windsurf', attempts[0], {
    encoding: 'utf8',
    timeout: 10 * 60 * 1000,
    cwd,
    env: getUserShellEnv(),
    input: stdinInput,
  });

    for (let i = 1; i < attempts.length; i++) {
      if (result.status === 0) break;
      if (!shouldRetryAgentCliAttempt(result.stderr || '', result.stdout || '')) break;
      result = spawnCommand('windsurf', attempts[i], {
      encoding: 'utf8',
      timeout: 10 * 60 * 1000,
      cwd,
      env: getUserShellEnv(),
      input: stdinInput,
    });
  }

  const success = result.status === 0;
  const output = result.stdout || '';
  const error = result.stderr || '';

  if (!success) {
    logger.warn(`Windsurf exited with status ${result.status}`);
    if (error) logger.warn(`windsurf stderr: ${error.slice(0, 500)}`);
    if (result.error) logger.warn(`windsurf spawn error: ${result.error.message}`);
  }

  if (!wasRunning) {
    killWindsurfProcess();
  }

  return { success, output, error };
}

// ─── Docker runner (Windows) ───────────────────────────────────────────────────

/**
 * Checks whether the Docker-based Windsurf approach can work:
 *  1. `docker` CLI is in PATH
 *  2. WINDSURF_TOKEN env var is set (required for auth)
 *  3. The Docker image exists locally
 */
export function isDockerWindsurfAvailable(): boolean {
  if (!commandExists('docker')) return false;
  if (!process.env.WINDSURF_TOKEN) {
    logger.debug('Windsurf Docker: WINDSURF_TOKEN not set');
    return false;
  }
  return dockerImageExists(WINDSURF_DOCKER_IMAGE);
}

function dockerImageExists(image: string): boolean {
  const result = spawnSync('docker', ['image', 'inspect', image], {
    encoding: 'utf8',
    timeout: 10000,
    stdio: ['ignore', 'ignore', 'ignore'],
  });
  return result.status === 0;
}

/**
 * Runs Windsurf inside a Docker container using the windsurfinabox image.
 *
 * Flow:
 *  1. Write prompt to `windsurf-instructions.txt` in a temp staging dir
 *  2. Copy workspace files into the staging dir (so the container can modify them)
 *  3. Launch container with workspace mounted at /home/ubuntu/workspace
 *  4. Wait for the container to finish (it writes WORK-COMPLETED to output)
 *  5. Copy modified files back to the real workspace
 */
async function runViaDocker(fullPrompt: string): Promise<AIRunResult> {
  logger.info('Running Windsurf via Docker (headless)...');
  logger.debug(`Prompt: ${fullPrompt.slice(0, 200)}...`);

  const cwd = process.cwd();
  const containerName = `aidev-windsurf-${process.pid}-${Date.now()}`;

  // Write the instructions file directly in the workspace — the container
  // reads it from the mounted workspace directory.
  const instructionsFile = path.join(cwd, 'windsurf-instructions.txt');
  const outputFile = path.join(cwd, 'windsurf-output.txt');

  try {
    fs.writeFileSync(instructionsFile, fullPrompt, 'utf8');

    // Clean up any stale output file from a previous run
    try { fs.unlinkSync(outputFile); } catch { /* ignore */ }

    // Windsurf config dir — user can override via WINDSURF_CONFIG_DIR
    const configDir = process.env.WINDSURF_CONFIG_DIR
      || path.join(os.homedir(), '.config', 'Windsurf');

    // Convert Windows paths to Docker-compatible paths (forward slashes)
    const dockerCwd = cwd.replace(/\\/g, '/');
    const dockerConfigDir = configDir.replace(/\\/g, '/');

    const args = [
      'run', '--rm',
      '--name', containerName,
      '-e', `WINDSURF_TOKEN=${process.env.WINDSURF_TOKEN}`,
      '-v', `${dockerCwd}:/home/ubuntu/workspace`,
      '-v', `${dockerConfigDir}:/home/ubuntu/.config/Windsurf`,
      WINDSURF_DOCKER_IMAGE,
    ];

    logger.debug(`Docker command: docker ${args.join(' ').slice(0, 300)}...`);

    const result = spawnSync('docker', args, {
      encoding: 'utf8',
      timeout: DOCKER_TIMEOUT,
      cwd,
    });

    // Read container output
    let containerOutput = '';
    if (fs.existsSync(outputFile)) {
      containerOutput = fs.readFileSync(outputFile, 'utf8');
    }

    const stdout = result.stdout || '';
    const stderr = result.stderr || '';
    const combinedOutput = [containerOutput, stdout].filter(Boolean).join('\n');

    const success = result.status === 0 && containerOutput.includes('WORK-COMPLETED');

    if (!success) {
      logger.warn(`Windsurf Docker exited with status ${result.status}`);
      if (stderr) logger.warn(`docker stderr: ${stderr.slice(0, 500)}`);
      if (result.error) logger.warn(`docker spawn error: ${result.error.message}`);
      if (!containerOutput.includes('WORK-COMPLETED')) {
        logger.warn('Windsurf Docker did not produce WORK-COMPLETED marker');
      }
    }

    return { success, output: combinedOutput, error: stderr };
  } finally {
    // Clean up instructions and output files
    try { fs.unlinkSync(instructionsFile); } catch { /* ignore */ }
    try { fs.unlinkSync(outputFile); } catch { /* ignore */ }

    // Kill the container if it's still running (e.g. timeout)
    try {
      spawnSync('docker', ['rm', '-f', containerName], {
        timeout: 5000,
        stdio: 'ignore',
      });
    } catch { /* ignore */ }
  }
}

// ─── Process management (macOS / Linux) ────────────────────────────────────────

/** Returns true if the Windsurf IDE (not the CLI shim) is already running. */
function isWindsurfProcessRunning(): boolean {
  try {
    // Only relevant on non-Windows (CLI mode)
    const result = spawnSync('pgrep', ['-f', 'Windsurf'], {
      encoding: 'utf8',
      timeout: 5000,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return result.status === 0;
  } catch {
    return false;
  }
}

/** Force-kills the Windsurf IDE process tree. */
function killWindsurfProcess(): void {
  try {
    logger.debug('Terminating Windsurf process');
    spawnSync('pkill', ['-f', 'Windsurf'], {
      timeout: 5000,
      stdio: 'ignore',
    });
  } catch {
    // Process may already be gone
  }
}

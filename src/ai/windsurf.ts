import { spawnSync } from 'node:child_process';
import { AIRunner, AIRunResult } from './base';
import { logger } from '../logger';
import { commandExists, getUserShellEnv, isWindows, spawnCommand } from '../platform';

export class WindsurfRunner implements AIRunner {
  readonly name = 'windsurf';

  isAvailable(): boolean {
    return commandExists('windsurf');
  }

  async run(prompt: string, notes?: string): Promise<AIRunResult> {
    const fullPrompt = notes ? `${prompt}\n\nAdditional context:\n${notes}` : prompt;

    logger.info('Running Windsurf...');
    logger.debug(`Prompt: ${fullPrompt.slice(0, 200)}...`);

    const wasRunning = isWindsurfProcessRunning();
    const cwd = process.cwd();
    // Prompt must go via stdin only — positional args are treated as file paths
    // by the windsurf CLI and would create files named with the prompt text.
    const result = spawnCommand(
      'windsurf',
      ['--agent', '--print', '--trust', '--workspace', cwd, '-'],
      {
        encoding: 'utf8',
        timeout: 10 * 60 * 1000,
        cwd,
        env: getUserShellEnv(),
        input: fullPrompt,
      }
    );

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
}

/** Returns true if the Windsurf IDE (not the CLI shim) is already running. */
function isWindsurfProcessRunning(): boolean {
  try {
    if (isWindows) {
      const result = spawnSync('tasklist', ['/FI', 'IMAGENAME eq Windsurf.exe', '/NH'], {
        encoding: 'utf8',
        timeout: 5000,
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      return result.stdout?.includes('Windsurf.exe') ?? false;
    }
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
    if (isWindows) {
      spawnSync('taskkill', ['/IM', 'Windsurf.exe', '/F'], {
        timeout: 5000,
        stdio: 'ignore',
      });
      return;
    }
    spawnSync('pkill', ['-f', 'Windsurf'], {
      timeout: 5000,
      stdio: 'ignore',
    });
  } catch {
    // Process may already be gone
  }
}

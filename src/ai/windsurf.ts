import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
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

    // On Windows, cmd.exe does not forward stdin to child processes spawned via
    // .cmd shims, so piping via `-` leaves windsurf with an unread temp file and
    // no agent prompt.  Write the prompt to a named temp file and pass its path
    // as the positional argument instead.
    let tmpFile: string | undefined;
    let stdinInput: string | undefined;
    let promptArg: string;

    if (isWindows) {
      tmpFile = path.join(os.tmpdir(), `aidev-windsurf-${process.pid}.txt`);
      fs.writeFileSync(tmpFile, fullPrompt, 'utf8');
      promptArg = tmpFile;
    } else {
      stdinInput = fullPrompt;
      // Prompt must go via stdin on non-Windows — positional args are treated as
      // file paths by the windsurf CLI and would create files named with the
      // prompt text.
      promptArg = '-';
    }

    const baseArgs = ['--agent', '--print', '--trust', '--workspace', cwd, promptArg];
    const attempts: string[][] = [
      ['--model', 'auto', ...baseArgs],
      ['--reasoning', 'auto', ...baseArgs],
      baseArgs,
    ];

    try {
      let result = spawnCommand('windsurf', attempts[0], {
        encoding: 'utf8',
        timeout: 10 * 60 * 1000,
        cwd,
        env: getUserShellEnv(),
        input: stdinInput,
      });

      for (let i = 1; i < attempts.length; i++) {
        if (result.status === 0) break;
        const err = (result.stderr || '').toLowerCase();
        const unknownFlag =
          err.includes('unknown option') ||
          err.includes('unrecognized option') ||
          err.includes('unknown argument') ||
          err.includes('unexpected argument') ||
          err.includes('invalid option');
        if (!unknownFlag) break;
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
    } finally {
      if (tmpFile) {
        try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
      }
    }
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

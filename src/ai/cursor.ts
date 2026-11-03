import * as fs from 'node:fs';
import * as path from 'node:path';
import { AIRunner, AIRunOptions, AIRunResult } from './base';
import { logger } from '../logger';
import { commandExists, getUserShellEnv, spawnCommand } from '../platform';
import { runSpawnAttempts } from './spawnAttempts';
import { getMcpState } from '../mcp';

/**
 * Cursor Agent CLI runner. Uses the `agent` binary on all platforms.
 * On Windows, the Cursor IDE is `cursor.exe` and does not support headless agent
 * mode; the separate Agent CLI must be installed (e.g. irm 'https://cursor.com/install?win32=true' | iex)
 * so that `agent` is in PATH.
 */
export class CursorRunner implements AIRunner {
  readonly name = 'cursor';
  readonly supportsSessions = true;

  /** aidev session id -> Cursor chat id created via `agent create-chat`. */
  private readonly chatIds = new Map<string, string>();

  private createChat(cwd: string): string | null {
    const res = spawnCommand('agent', ['create-chat'], {
      encoding: 'utf8',
      timeout: 30 * 1000,
      cwd,
      env: getUserShellEnv(),
    });
    const id = (res.stdout || '').trim().split(/\s+/).pop() || '';
    if (res.status !== 0 || !/^[0-9a-f-]{16,}$/i.test(id)) {
      logger.warn('Could not create a Cursor chat — continuing without a session');
      return null;
    }
    return id;
  }

  isAvailable(): boolean {
    return commandExists('agent');
  }

  async run(prompt: string, notes?: string, options?: AIRunOptions): Promise<AIRunResult> {
    const fullPrompt = notes ? `${prompt}\n\nAdditional context:\n${notes}` : prompt;

    logger.info('Running Cursor Agent...');
    logger.debug(`Prompt: ${fullPrompt.slice(0, 200)}...`);

    const cwd = process.cwd();
    const baseArgs = ['--print', '--force', '--trust', '--workspace', cwd];

    if (getMcpState()) {
      baseArgs.push('--approve-mcps');
    }

    if (options?.assetDirs) {
      for (const dir of options.assetDirs) {
        const absPath = path.resolve(dir);
        if (fs.existsSync(absPath) && fs.statSync(absPath).isDirectory()) {
          baseArgs.push('--add-dir', absPath);
        }
      }
    }

    const session = options?.session;
    if (session) {
      if (session.resume) {
        const chatId = this.chatIds.get(session.id);
        baseArgs.push(...(chatId ? ['--resume', chatId] : ['--continue']));
      } else {
        const chatId = this.createChat(cwd);
        if (chatId) {
          this.chatIds.set(session.id, chatId);
          baseArgs.push('--resume', chatId);
        }
      }
    }

    const attempts: string[][] = [
      [...baseArgs, '--model', 'auto'],
      [...baseArgs, '--reasoning', 'auto'],
      baseArgs,
    ];

    const result = await runSpawnAttempts('agent', attempts, {
      encoding: 'utf8',
      timeout: 10 * 60 * 1000,
      cwd,
      env: getUserShellEnv(),
      input: fullPrompt,
      signal: options?.signal,
    });

    if (result.aborted) {
      return { success: false, output: result.stdout, error: result.stderr || 'aborted', aborted: true };
    }

    const success = result.status === 0;
    const output = result.stdout || '';
    const error = result.stderr || '';

    if (!success) {
      logger.warn(`Cursor Agent exited with status ${result.status}`);
      if (error) logger.warn(`cursor stderr: ${error.slice(0, 500)}`);
      if (result.error) logger.warn(`cursor spawn error: ${result.error.message}`);
    }

    return { success, output, error };
  }
}

import { AIRunner, AIRunResult } from './base';
import { logger } from '../logger';
import { commandExists, getUserShellEnv, spawnCommand } from '../platform';

/**
 * Cursor Agent CLI runner. Uses the `agent` binary on all platforms.
 * On Windows, the Cursor IDE is `cursor.exe` and does not support headless agent
 * mode; the separate Agent CLI must be installed (e.g. irm 'https://cursor.com/install?win32=true' | iex)
 * so that `agent` is in PATH.
 */
export class CursorRunner implements AIRunner {
  readonly name = 'cursor';

  isAvailable(): boolean {
    if (!commandExists('agent')) return false;

    if (!process.env.CURSOR_API_KEY) {
      const result = spawnCommand('agent', ['--version'], {
        encoding: 'utf8',
        timeout: 3000,
        env: getUserShellEnv(),
      });

      if (result.stderr?.includes('Authentication required') || result.status !== 0) {
        logger.warn(
          'Cursor Agent CLI found but not authenticated. ' +
          'Run `agent login` or set the CURSOR_API_KEY environment variable.'
        );
        return false;
      }
    }

    return true;
  }

  async run(prompt: string, notes?: string): Promise<AIRunResult> {
    const fullPrompt = notes ? `${prompt}\n\nAdditional context:\n${notes}` : prompt;

    logger.info('Running Cursor Agent...');
    logger.debug(`Prompt: ${fullPrompt.slice(0, 200)}...`);

    const cwd = process.cwd();
    const result = spawnCommand(
      'agent',
      ['--print', '--force', '--trust', '--workspace', cwd],
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
      logger.warn(`Cursor Agent exited with status ${result.status}`);
      if (error) logger.warn(`cursor stderr: ${error.slice(0, 500)}`);
      if (result.error) logger.warn(`cursor spawn error: ${result.error.message}`);
    }

    return { success, output, error };
  }
}

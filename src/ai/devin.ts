import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { AIRunner, AIRunOptions, AIRunResult } from './base';
import { logger } from '../logger';
import { commandExists, getUserShellEnv } from '../platform';
import { runSpawnAttempts } from './spawnAttempts';

export class DevinRunner implements AIRunner {
  readonly name = 'devin';

  isAvailable(): boolean {
    return commandExists('devin');
  }

  async run(prompt: string, notes?: string, options?: AIRunOptions): Promise<AIRunResult> {
    const fullPrompt = notes ? `${prompt}\n\nAdditional context:\n${notes}` : prompt;
    return runViaCli(fullPrompt, options);
  }
}

async function runViaCli(fullPrompt: string, options?: AIRunOptions): Promise<AIRunResult> {
  logger.info('Running Devin CLI...');
  logger.debug(`Prompt: ${fullPrompt.slice(0, 200)}...`);

  const cwd = process.cwd();
  const promptFile = path.join(os.tmpdir(), `aidev-devin-${process.pid}-${Date.now()}.txt`);

  try {
    fs.writeFileSync(promptFile, fullPrompt, 'utf8');

    const args = ['-p', '--permission-mode', 'bypass', '--prompt-file', promptFile];

    const result = await runSpawnAttempts('devin', [args], {
      encoding: 'utf8',
      timeout: 10 * 60 * 1000,
      cwd,
      env: getUserShellEnv(),
      signal: options?.signal,
    }, () => false);

    if (result.aborted) {
      return { success: false, output: result.stdout, error: result.stderr || 'aborted', aborted: true };
    }

    const success = result.status === 0;
    const output = result.stdout || '';
    const error = result.stderr || '';

    if (!success) {
      logger.warn(`Devin exited with status ${result.status}`);
      if (error) logger.warn(`devin stderr: ${error.slice(0, 500)}`);
      if (result.error) logger.warn(`devin spawn error: ${result.error.message}`);
    }

    return { success, output, error };
  } finally {
    try { fs.unlinkSync(promptFile); } catch { /* ignore */ }
  }
}

import type { SpawnSyncOptionsWithStringEncoding } from 'node:child_process';
import { shouldRetryAgentCliAttempt, spawnCommandAsync, type SpawnAsyncOptions } from '../platform';

export interface SpawnAttemptResult {
  status: number | null;
  stdout: string;
  stderr: string;
  aborted?: boolean;
  error?: Error;
}

type SpawnOptions = SpawnAsyncOptions & Pick<SpawnSyncOptionsWithStringEncoding, 'cwd' | 'env' | 'input' | 'timeout' | 'encoding'>;

export async function runSpawnAttempts(
  command: string,
  attempts: string[][],
  options: SpawnOptions,
  shouldRetry: (stderr: string, stdout: string) => boolean = shouldRetryAgentCliAttempt,
): Promise<SpawnAttemptResult> {
  for (let i = 0; i < attempts.length; i++) {
    if (options.signal?.aborted) {
      return { status: null, stdout: '', stderr: 'aborted', aborted: true };
    }

    // Always async: spawnSync only kills the direct child on timeout and then waits
    // for the output pipes to close, which never happens if a grandchild (e.g. a jest
    // run started by the agent) is still alive — that hung whole runs for hours.
    const result = await spawnCommandAsync(command, attempts[i], options);

    if (result.aborted) {
      return result;
    }

    if (result.status === 0) {
      return result;
    }

    if (i + 1 < attempts.length && shouldRetry(result.stderr, result.stdout)) {
      continue;
    }

    return result;
  }

  return { status: 1, stdout: '', stderr: '' };
}

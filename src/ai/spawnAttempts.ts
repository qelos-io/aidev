import type { SpawnSyncOptionsWithStringEncoding, SpawnSyncReturns } from 'node:child_process';
import { shouldRetryAgentCliAttempt, spawnCommand, spawnCommandAsync, type SpawnAsyncOptions } from '../platform';

export interface SpawnAttemptResult {
  status: number | null;
  stdout: string;
  stderr: string;
  aborted?: boolean;
  error?: Error;
}

type SpawnOptions = SpawnAsyncOptions & Pick<SpawnSyncOptionsWithStringEncoding, 'cwd' | 'env' | 'input' | 'timeout' | 'encoding'>;

function fromSyncResult(result: SpawnSyncReturns<string>): SpawnAttemptResult {
  return {
    status: result.status,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    error: result.error,
  };
}

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

    const result = options.signal
      ? await spawnCommandAsync(command, attempts[i], options)
      : fromSyncResult(spawnCommand(command, attempts[i], options));

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

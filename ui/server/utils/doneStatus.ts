import type { UiConfig, UiProvider } from './provider';

const DONE_STATUS_CANDIDATES = ['done', 'closed', 'finish', 'success', 'prod'];

/**
 * Resolve the provider-specific "done" status name(s). Uses DONE_STATUS when
 * configured; otherwise probes fetchAvailableStatuses for common done names.
 */
export async function resolveDoneStatuses(
  config: UiConfig,
  provider: UiProvider,
): Promise<string[]> {
  if (config.doneStatus) return [config.doneStatus];

  if (typeof provider.fetchAvailableStatuses !== 'function') {
    return ['done'];
  }

  try {
    const statuses = await provider.fetchAvailableStatuses();
    const byLower = new Map(statuses.map((s) => [s.toLowerCase(), s]));
    for (const candidate of DONE_STATUS_CANDIDATES) {
      const match = byLower.get(candidate);
      if (match) return [match];
    }
  } catch {
    // fall through to generic default
  }

  return ['done'];
}

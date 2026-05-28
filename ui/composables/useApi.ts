const TOKEN_KEY = 'aidev-ui-token';

// Structural subset of ofetch's FetchOptions — covers everything our screens
// need without coupling the composable to ofetch's exported types (which can
// drift across Nuxt versions).
type ApiOptions = {
  method?: string;
  body?: unknown;
  query?: Record<string, unknown>;
  headers?: Record<string, string>;
  signal?: AbortSignal;
};

/**
 * Wrap $fetch so every call attaches the bearer token from localStorage and
 * any 401 boots the user back to /login. Use inside Vue components only —
 * relies on Nuxt's app context for navigateTo().
 */
export function useApi() {
  return async <T = unknown>(url: string, opts: ApiOptions = {}): Promise<T> => {
    const token = import.meta.client ? localStorage.getItem(TOKEN_KEY) : null;
    const headers: Record<string, string> = { ...(opts.headers ?? {}) };
    if (token) headers.Authorization = `Bearer ${token}`;

    try {
      return (await $fetch(url, { ...opts, headers } as Parameters<typeof $fetch>[1])) as T;
    } catch (err: unknown) {
      const status =
        (err as { response?: { status?: number }; statusCode?: number })?.response?.status ??
        (err as { statusCode?: number })?.statusCode;
      if (status === 401 && import.meta.client) {
        localStorage.removeItem(TOKEN_KEY);
        await navigateTo('/login');
      }
      throw err;
    }
  };
}

export function clearApiToken() {
  if (import.meta.client) localStorage.removeItem(TOKEN_KEY);
}

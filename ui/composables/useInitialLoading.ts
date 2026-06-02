import type { Ref } from 'vue';

/**
 * Content loading for views that poll or auto-refresh.
 * The loading flag is true only before the first payload exists; interval and
 * background fetches keep stale data visible until the response arrives.
 */
export function useInitialLoading<T>(data: Ref<T | null>) {
  const loading = ref(false);

  /** Call at fetch start. Returns true when this fetch drives the loading flag. */
  function beginFetch(clearError?: Ref<string>): boolean {
    const isInitial = data.value === null;
    if (isInitial) {
      loading.value = true;
      if (clearError) clearError.value = '';
    }
    return isInitial;
  }

  function endFetch(isInitial: boolean): void {
    if (isInitial) loading.value = false;
  }

  return { loading, beginFetch, endFetch };
}

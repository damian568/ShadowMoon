import { useCallback, useEffect, useRef, useState } from 'react';

export interface AsyncState<T> {
  data: T | undefined;
  error: string | null;
  loading: boolean;
  refreshing: boolean;
  reload: () => void;
  refresh: () => void;
}

/** Runs `fn` when `deps` change; `refresh()` re-runs it with force=true (pull-to-refresh). */
export function useAsync<T>(fn: (force: boolean) => Promise<T>, deps: unknown[]): AsyncState<T> {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const callId = useRef(0);

  // Always call the latest `fn` (it closes over the current props), without making `run` change every render.
  const fnRef = useRef(fn);
  useEffect(() => {
    fnRef.current = fn;
  });

  const run = useCallback(async (force: boolean, asRefresh: boolean) => {
    const id = ++callId.current;
    if (asRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const result = await fnRef.current(force);
      if (id === callId.current) setData(result);
    } catch (e: any) {
      if (id === callId.current) setError(e?.message ?? 'Unknown error');
    } finally {
      if (id === callId.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, []);

  // Re-run whenever the caller's `deps` change. It starts on the next tick so the loading state is not set
  // synchronously inside the effect (`loading` is already true on the first run).
  useEffect(() => {
    const t = setTimeout(() => run(false, false), 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run, ...deps]);

  return {
    data,
    error,
    loading,
    refreshing,
    reload: () => run(false, false),
    refresh: () => run(true, true),
  };
}

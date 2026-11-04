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

  const run = useCallback(
    async (force: boolean, asRefresh: boolean) => {
      const id = ++callId.current;
      asRefresh ? setRefreshing(true) : setLoading(true);
      setError(null);
      try {
        const result = await fn(force);
        if (id === callId.current) setData(result);
      } catch (e: any) {
        if (id === callId.current) setError(e?.message ?? 'Unknown error');
      } finally {
        if (id === callId.current) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    deps,
  );

  useEffect(() => {
    run(false, false);
  }, [run]);

  return {
    data,
    error,
    loading,
    refreshing,
    reload: () => run(false, false),
    refresh: () => run(true, true),
  };
}

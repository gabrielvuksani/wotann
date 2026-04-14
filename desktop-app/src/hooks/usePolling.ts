/**
 * usePolling — Generic polling hook for Tauri commands.
 *
 * Polls a Tauri command at a given interval and exposes the latest
 * result along with loading/error state. Automatically cleans up
 * the interval on unmount or when parameters change.
 */

import { useCallback, useEffect, useRef, useState } from "react";

interface PollingResult<T> {
  readonly data: T | null;
  readonly loading: boolean;
  readonly error: string | null;
  readonly refresh: () => void;
}

/**
 * Polls an async function at a given interval.
 *
 * @param fetcher  - Async function that returns the data
 * @param intervalMs - Polling interval in milliseconds
 * @param enabled  - Whether polling is active (default: true)
 */
export function usePolling<T>(
  fetcher: () => Promise<T>,
  intervalMs: number,
  enabled: boolean = true,
): PollingResult<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fetcherRef = useRef(fetcher);
  const mountedRef = useRef(true);

  // Keep fetcher ref up to date without triggering re-renders
  fetcherRef.current = fetcher;

  const executeFetch = useCallback(async () => {
    if (!mountedRef.current) return;

    setLoading(true);
    try {
      const result = await fetcherRef.current();
      if (mountedRef.current) {
        setData(result);
        setError(null);
      }
    } catch (err) {
      if (mountedRef.current) {
        const message =
          err instanceof Error ? err.message : "Unknown error";
        setError(message);
      }
    } finally {
      if (mountedRef.current) {
        setLoading(false);
      }
    }
  }, []);

  // Initial fetch + interval setup
  useEffect(() => {
    mountedRef.current = true;

    if (!enabled) return;

    // Fire immediately on mount/enable
    executeFetch();

    const intervalId = setInterval(executeFetch, intervalMs);

    return () => {
      mountedRef.current = false;
      clearInterval(intervalId);
    };
  }, [intervalMs, enabled, executeFetch]);

  return { data, loading, error, refresh: executeFetch };
}

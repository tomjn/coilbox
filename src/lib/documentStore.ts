/**
 * The module-cache-plus-listener-set-plus-hook shape that six plugins each
 * wrote by hand for a folder of JSON documents: projects, blueprints,
 * campaigns, galaxies and runs (issue #2440). A session cache means navigating
 * back to a list does not re-read every document, and the listener set means a
 * write from one mounted consumer reaches every other one, not just the one
 * that made it. That is the fix `conquest/conquests.ts` added after a resolved
 * battle updated the overlay's copy and disk but left the map rendering the
 * pre-battle turn.
 *
 * `scenario/scenarios.ts` is not built on this: its list is two halves read on
 * different triggers, folded together before publishing, which this shape has
 * nothing to say about.
 */

import { useCallback, useEffect, useState } from "react";

export interface DocumentStore<T> {
  /** Every mounted consumer's view of the data, kept in step with refreshes
   *  and publishes made anywhere else. */
  useStore(): {
    data: T;
    loading: boolean;
    error: string | null;
    refresh: () => Promise<void>;
  };
  /** Re-read from the source, replace the cache, and notify every listener. */
  refresh(): Promise<T>;
  /** Replace the cache with an already-known value and notify every listener,
   *  for a write path that updates the cache itself rather than re-reading it
   *  (e.g. an optimistic save into a keyed document). */
  publish(value: T): T;
  /** Synchronous read of the last known value, for non-React callers, or
   *  `null` before anything has loaded this session. */
  getCached(): T | null;
}

/**
 * Build a store over one `fetch`. `initial` is what a first render shows before
 * anything has loaded, and is never written to the cache itself.
 */
export function createDocumentStore<T>(
  fetch: () => Promise<T>,
  initial: T,
): DocumentStore<T> {
  let cache: T | null = null;
  const listeners = new Set<(value: T) => void>();

  function publish(value: T): T {
    cache = value;
    for (const listener of listeners) listener(value);
    return value;
  }

  async function refresh(): Promise<T> {
    return publish(await fetch());
  }

  function useStore() {
    const [data, setData] = useState<T>(cache ?? initial);
    const [loading, setLoading] = useState(cache === null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
      listeners.add(setData);
      return () => {
        listeners.delete(setData);
      };
    }, []);

    useEffect(() => {
      if (cache !== null) {
        setData(cache);
        setLoading(false);
        return;
      }
      let cancelled = false;
      setLoading(true);
      fetch()
        .then((loaded) => {
          if (!cancelled) {
            publish(loaded);
            setError(null);
          }
        })
        .catch((e) => {
          if (!cancelled) setError(e instanceof Error ? e.message : String(e));
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
      return () => {
        cancelled = true;
      };
    }, []);

    const refreshCallback = useCallback(async () => {
      setError(null);
      try {
        await refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    }, []);

    return { data, loading, error, refresh: refreshCallback };
  }

  function getCached(): T | null {
    return cache;
  }

  return { useStore, refresh, publish, getCached };
}

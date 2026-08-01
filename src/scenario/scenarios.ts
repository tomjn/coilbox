import { useCallback, useEffect, useState } from "react";
import { playableScenarios } from "./listing";
import type { Scenario } from "./model";
import { listScenarios } from "./storage";

/**
 * Session cache of the parsed scenario list, so navigating back to the Scenario
 * Builder shows results instantly instead of re-reading every document. The same
 * module-cache-plus-listeners shape the campaign list uses, so a save or delete
 * in the editor updates every mounted consumer, including the list behind it.
 */
let cache: Scenario[] | null = null;
const listeners = new Set<(scenarios: Scenario[]) => void>();

/** Re-read every stored scenario and push the result to every consumer. */
export async function refreshScenarios(): Promise<Scenario[]> {
  const loaded = await listScenarios();
  cache = loaded;
  for (const listener of listeners) listener(loaded);
  return loaded;
}

/**
 * Every stored scenario, newest edit first. Serves the session cache on mount,
 * else reads once. Invalid documents are skipped by {@link listScenarios}, so
 * one bad file cannot make the list unusable.
 */
export function useScenarios() {
  const [scenarios, setScenarios] = useState<Scenario[]>(cache ?? []);
  const [loading, setLoading] = useState(cache === null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const listener = (loaded: Scenario[]) => setScenarios(loaded);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  useEffect(() => {
    if (cache) {
      setScenarios(cache);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    listScenarios()
      .then((loaded) => {
        cache = loaded;
        if (!cancelled) {
          setScenarios(loaded);
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

  const refresh = useCallback(async () => {
    setError(null);
    try {
      await refreshScenarios();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  return { scenarios, loading, error, refresh };
}

/**
 * Whether there is anything on the Scenarios page, which is what decides
 * whether a player sees it in the nav at all. A stored draft with no game or
 * map does not count, the same way it is not listed. Mirrors the Campaigns
 * item, which appears once a campaign exists.
 */
export function useHasScenarios(): boolean {
  const { scenarios, loading } = useScenarios();
  return !loading && playableScenarios(scenarios).length > 0;
}

/**
 * A loaded scenario straight from the session cache, or `undefined` when the
 * list has not loaded yet. For non-React callers that need a best-effort name
 * now, chiefly the breadcrumb resolver, which only has the route's id.
 */
export function getCachedScenario(id: string): Scenario | undefined {
  return cache?.find((s) => s.id === id);
}

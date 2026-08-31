import { useCallback, useEffect, useState } from "react";
import type { GameItem } from "../content/bindings";
import { useUnitsyncScan } from "../content/config";
import { usePreferredTarget } from "../play/config";
import { gameScenarios } from "./gameScenarios";
import { playableScenarios } from "./listing";
import { type LoadedScenario, listScenarios } from "./storage";

/**
 * Session cache of the parsed scenario list, so navigating back to the Scenario
 * Builder shows results instantly instead of re-reading every document. The same
 * module-cache-plus-listeners shape the campaign list uses, so a save or delete
 * in the editor updates every mounted consumer, including the list behind it.
 *
 * Holds all three sources merged: stored (local and bundled) plus whatever a
 * game's own archive shipped, newest edit first.
 */
let cache: LoadedScenario[] | null = null;
const listeners = new Set<(scenarios: LoadedScenario[]) => void>();

/**
 * The `scan?.games` reference `cache` was last built from, so a mount whose
 * content scan resolves after the initial (gameless) fetch already landed
 * knows to fetch again rather than serve a cache with no game missions in it
 * forever. `undefined` matches the case nothing has resolved yet, the same as
 * `scan?.games` itself before the scan completes.
 */
let cacheGamesSource: readonly GameItem[] | undefined;

/** Newest edit first: `listScenarios`'s own order, reapplied once a game's
 * missions are folded in. */
function byRecency(loaded: LoadedScenario[]): LoadedScenario[] {
  return [...loaded].sort((a, b) =>
    b.scenario.updatedAt.localeCompare(a.scenario.updatedAt),
  );
}

/**
 * Re-read every stored scenario and push the result to every consumer.
 *
 * A game's own missions are not re-read here: nothing this is called after (a
 * save, a delete, a rescan of stored documents) ever changes one, so whatever
 * `useScenarios` last folded in from the game's archive is carried over rather
 * than dropped from the list until the next full reload.
 */
export async function refreshScenarios(): Promise<LoadedScenario[]> {
  const loaded = await listScenarios();
  const fromGames = (cache ?? []).filter((l) => l.source === "game");
  const merged = byRecency([...loaded, ...fromGames]);
  cache = merged;
  for (const listener of listeners) listener(merged);
  return merged;
}

/**
 * Every scenario, newest edit first, each with where it came from. Serves the
 * session cache on mount, else reads once. Invalid documents are skipped by
 * {@link listScenarios}, so one bad file cannot make the list unusable.
 */
export function useScenarios() {
  const [scenarios, setScenarios] = useState<LoadedScenario[]>(cache ?? []);
  const [loading, setLoading] = useState(cache === null);
  const [error, setError] = useState<string | null>(null);
  // A game's own missions need the installed games list. The content scan
  // already resolves and caches that (the sidebar and the Scenarios page both
  // already pay for it), so this reuses it rather than scanning again.
  const { target } = usePreferredTarget();
  const { data: scan } = useUnitsyncScan(target?.enginePath, target?.dataDir);

  useEffect(() => {
    const listener = (loaded: LoadedScenario[]) => setScenarios(loaded);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  useEffect(() => {
    // The content scan resolves after its own round of async work, often
    // later than the first pass of this effect. Reusing the cache is only
    // safe once it was built from this same games list, otherwise a game's
    // missions would never make it in past the instant-from-cache path below.
    if (cache && cacheGamesSource === scan?.games) {
      setScenarios(cache);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    Promise.all([listScenarios(), gameScenarios(scan?.games ?? [])])
      .then(([stored, fromGames]) => {
        const loaded = byRecency([...stored, ...fromGames]);
        // Gated on `cancelled` rather than written unconditionally: the games
        // list arrives after its own async resolution, so this effect can
        // rerun with a fuller `scan.games` before an earlier run (fetched
        // with none yet known) has finished. Writing the stale result here
        // would clobber the newer one that already landed.
        if (!cancelled) {
          cache = loaded;
          cacheGamesSource = scan?.games;
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
  }, [scan?.games]);

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
  return (
    !loading && playableScenarios(scenarios.map((l) => l.scenario)).length > 0
  );
}

/**
 * Where to send someone who wants to open one scenario (issue #1372): the
 * Scenarios list with that scenario's play drawer open.
 *
 * `/scenario-builder/:id` is the only route that names a single scenario today
 * and it is advanced-gated, so an ordinary player cannot be sent there. This is
 * the same address the player-facing list already answers to, plus which
 * scenario, which is why it is a param and not a route of its own.
 */
export function scenarioRoute(id: string): string {
  return `/scenarios?scenario=${encodeURIComponent(id)}`;
}

/**
 * A loaded scenario straight from the session cache, or `undefined` when the
 * list has not loaded yet. For non-React callers that need a best-effort name
 * now, chiefly the breadcrumb resolver, which only has the route's id.
 */
export function getCachedScenario(id: string): LoadedScenario | undefined {
  return cache?.find((l) => l.scenario.id === id);
}

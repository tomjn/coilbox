import { useCallback, useEffect, useState } from "react";
import { useUnitsyncScan } from "../content/config";
import { usePreferredTarget } from "../play/config";
import { gameScenarios } from "./gameScenarios";
import { playableScenarios } from "./listing";
import { type GameOrigin, type LoadedScenario, listScenarios } from "./storage";

/**
 * Session cache of the parsed scenario list, so navigating back to the Scenario
 * Builder shows results instantly instead of re-reading every document. The same
 * module-cache-plus-listeners shape the campaign list uses, so a save or delete
 * in the editor updates every mounted consumer, including the list behind it.
 *
 * Split into two halves read on their own terms, rather than one fetch that
 * waits on both: `storedCache` is coilbox's own documents, which depend on
 * nothing else and are read once per session. `gamesCache` is what a game's
 * own archive ships, which depends on the installed games list and is only
 * re-read when that list actually changes. Folding both into a single fetch
 * would mean re-reading storage every time the games list resolves or a mount
 * outlives the render the games list first showed up on, which is wasted work
 * on a path nothing asked to be more expensive.
 */
let storedCache: LoadedScenario[] | null = null;
let gamesCache: LoadedScenario[] = [];
/** Whether the games half has settled at least once this session, so a later
 *  mount does not report itself as still loading over a list it already has. */
let gamesRead = false;
let cache: LoadedScenario[] | null = null;
const listeners = new Set<(scenarios: LoadedScenario[]) => void>();

/** Newest edit first: `listScenarios`'s own order, reapplied once a game's
 * missions are folded in. */
function byRecency(loaded: LoadedScenario[]): LoadedScenario[] {
  return [...loaded].sort((a, b) =>
    b.scenario.updatedAt.localeCompare(a.scenario.updatedAt),
  );
}

/** Recompute the published cache from the two halves and notify every
 * mounted consumer. */
function publish(): LoadedScenario[] {
  cache = byRecency([...(storedCache ?? []), ...gamesCache]);
  for (const listener of listeners) listener(cache);
  return cache;
}

/**
 * Re-read every stored scenario and push the result to every consumer.
 *
 * A game's own missions are not re-read here: almost nothing this is called
 * after (a save, a delete, a rescan of stored documents) ever changes one, so
 * whatever `useScenarios` last folded in from the game's archive is carried over
 * rather than dropped from the list until the next full reload. The one thing
 * that does change one says so through {@link addGameMission} and
 * {@link forgetGameMission}.
 */
export async function refreshScenarios(): Promise<LoadedScenario[]> {
  storedCache = await listScenarios();
  return publish();
}

/**
 * Fold in a mission an author has just moved into a game (`moveIntoGame.ts`).
 *
 * The games half is read from the installed games list rather than on demand, so
 * a move that changes what a game ships would otherwise not show until the next
 * full reload, and the editor would find nothing at the route it just moved the
 * document to. The document written into the game is the one being handed over
 * here, so this splices rather than reading the archive back.
 */
export function addGameMission(loaded: LoadedScenario): LoadedScenario[] {
  gamesCache = [...gamesCache, loaded];
  return publish();
}

/** The reverse: a mission an author has taken back out of a game. */
export function forgetGameMission(origin: GameOrigin): LoadedScenario[] {
  gamesCache = gamesCache.filter(
    (l) =>
      l.origin?.archivePath !== origin.archivePath ||
      l.origin.folder !== origin.folder,
  );
  return publish();
}

/**
 * Every scenario, newest edit first, each with where it came from. Serves the
 * session cache on mount, else reads once. Invalid documents are skipped by
 * {@link listScenarios}, so one bad file cannot make the list unusable.
 */
export function useScenarios() {
  const [scenarios, setScenarios] = useState<LoadedScenario[]>(cache ?? []);
  const [loading, setLoading] = useState(storedCache === null);
  const [gamesDone, setGamesDone] = useState(gamesRead);
  const [error, setError] = useState<string | null>(null);
  // A game's own missions need the installed games list. The content scan
  // already resolves and caches that (the sidebar and the Scenarios page both
  // already pay for it), so this reuses it rather than scanning again.
  const { target, loading: targetLoading } = usePreferredTarget();
  const enginePath = target?.enginePath;
  const dataDir = target?.dataDir;
  const { data: scan } = useUnitsyncScan(enginePath, dataDir);

  useEffect(() => {
    const listener = (loaded: LoadedScenario[]) => setScenarios(loaded);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  // The stored documents: read once per session, independent of the games
  // list, so a mount never re-reads storage just because the scan answered
  // (or because a later mount's own scan hook starts out unresolved again).
  useEffect(() => {
    if (storedCache) {
      setScenarios(publish());
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    listScenarios()
      .then((loaded) => {
        if (cancelled) return;
        storedCache = loaded;
        setScenarios(publish());
        setError(null);
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

  // A game's missions, read separately because they depend on the content
  // scan rather than on coilbox's own storage. Nothing is read here until the
  // scan actually answers: `scan` is `undefined` while it is still resolving,
  // and reading with an empty list this early would publish a mission-less
  // version of what a later-resolving mount already had cached, only to
  // correct itself a render later.
  useEffect(() => {
    if (targetLoading) return;
    // No engine means no installed game, so there is nothing to wait for and
    // the games half is already as complete as it will get. Settling here is
    // what stops the page holding `loading` true forever on a machine that has
    // no engine, where the scan never runs and never answers.
    if (!enginePath || !dataDir) {
      gamesRead = true;
      setGamesDone(true);
      return;
    }
    if (!scan) return;
    let cancelled = false;
    gameScenarios(scan.games)
      .then((loaded) => {
        if (cancelled) return;
        gamesCache = loaded;
        setScenarios(publish());
      })
      .catch((e) => {
        console.warn("could not read a game's own missions", e);
      })
      .finally(() => {
        if (cancelled) return;
        gamesRead = true;
        setGamesDone(true);
      });
    return () => {
      cancelled = true;
    };
  }, [scan, targetLoading, enginePath, dataDir]);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      await refreshScenarios();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  // Loading covers both halves. Reporting the stored half's own state would
  // settle before a game's missions have been read, which shows a player whose
  // only scenarios come from a game an empty list first and the real one a
  // moment later.
  return { scenarios, loading: loading || !gamesDone, error, refresh };
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

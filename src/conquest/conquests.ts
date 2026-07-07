import { useCallback, useEffect, useRef, useState } from "react";
import { conquestList, conquestStateLoad, conquestStateSave } from "./bindings";
import {
  type ConquestState,
  type ConquestStateFile,
  type GalaxyDoc,
  parseGalaxyJson,
  reconcileState,
} from "./model";

/** A parsed galaxy plus where it came from (bundled galaxies are read-only). */
export interface LoadedGalaxy {
  galaxy: GalaxyDoc;
  source: "local" | "bundled";
}

/**
 * Session cache of the parsed galaxy list, so navigating back to the Conquest
 * hub shows results instantly instead of re-reading and re-parsing every
 * document. The listener set pushes a mutation in one consumer (the wizard
 * saving a generated galaxy, a delete) to every mounted {@link useGalaxies} —
 * mirroring `campaign/campaigns.ts`.
 */
let cache: LoadedGalaxy[] | null = null;
const listeners = new Set<(loaded: LoadedGalaxy[]) => void>();

/** Read + parse every stored galaxy document, skipping invalid ones. */
async function fetchGalaxies(): Promise<LoadedGalaxy[]> {
  const { items } = await conquestList({});
  const loaded: LoadedGalaxy[] = [];
  for (const item of items) {
    const galaxy = parseGalaxyJson(item.json);
    if (galaxy) {
      loaded.push({ galaxy, source: item.source });
    } else {
      console.warn("skipping invalid galaxy document", item.source);
    }
  }
  return loaded;
}

/**
 * Re-read the galaxy list from disk, refresh the shared session cache, and
 * push the result to every mounted {@link useGalaxies}. Call after a
 * save/delete/import.
 */
export async function refreshGalaxies(): Promise<LoadedGalaxy[]> {
  const loaded = await fetchGalaxies();
  cache = loaded;
  for (const l of listeners) l(loaded);
  return loaded;
}

/**
 * Load every stored galaxy. Serves the session cache on mount, else reads and
 * parses each document (skipping — with a console warning — any that fail
 * validation, so one malformed bundled/imported galaxy can't break the hub).
 */
export function useGalaxies() {
  const [galaxies, setGalaxies] = useState<LoadedGalaxy[]>(cache ?? []);
  const [loading, setLoading] = useState(cache === null);
  const [error, setError] = useState<string | null>(null);

  // Stay in lockstep with refreshes triggered by any other consumer.
  useEffect(() => {
    const listener = (loaded: LoadedGalaxy[]) => setGalaxies(loaded);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  // First mount: serve the cache, else fetch once.
  useEffect(() => {
    if (cache) {
      setGalaxies(cache);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    fetchGalaxies()
      .then((loaded) => {
        cache = loaded;
        if (!cancelled) {
          setGalaxies(loaded);
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
      await refreshGalaxies();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  return { galaxies, loading, error, refresh };
}

/**
 * Synchronous read of a loaded galaxy from the session cache, or `undefined`
 * if the list hasn't loaded yet. For non-React callers that need a best-effort
 * title now — chiefly the breadcrumb `crumb` resolvers.
 */
export function getCachedGalaxy(id: string): LoadedGalaxy | undefined {
  return cache?.find((l) => l.galaxy.id === id);
}

/** The empty state document, matching the plugin's default. */
const emptyStateFile: ConquestStateFile = { schemaVersion: 1, conquests: {} };

/**
 * Load / save wrappers around the run-state commands. State is stored
 * separately from galaxy documents so bundled (read-only) galaxies still track
 * runs. Each galaxy's saved state is healed against its (possibly updated)
 * document via {@link reconcileState} on read.
 */
export function useConquestState() {
  const [file, setFile] = useState<ConquestStateFile>(emptyStateFile);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Ref mirror so saveFor can build "latest + this change" without waiting on
  // a state flush (two quick saves must not clobber each other).
  const fileRef = useRef(file);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { json } = await conquestStateLoad({});
      let parsed = emptyStateFile;
      try {
        parsed = JSON.parse(json) as ConquestStateFile;
      } catch {
        parsed = emptyStateFile;
      }
      fileRef.current = parsed;
      setFile(parsed);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  /** Persist one galaxy's run state (or remove it with `undefined`). */
  const saveFor = useCallback(
    async (galaxyId: string, state: ConquestState | undefined) => {
      const conquests = { ...fileRef.current.conquests };
      if (state) {
        conquests[galaxyId] = state;
      } else {
        delete conquests[galaxyId];
      }
      const next: ConquestStateFile = { schemaVersion: 1, conquests };
      fileRef.current = next;
      setFile(next);
      await conquestStateSave({ json: JSON.stringify(next) });
    },
    [],
  );

  useEffect(() => {
    refresh();
  }, [refresh]);

  /** A galaxy's saved run, healed against the current document. */
  const stateFor = useCallback(
    (galaxy: GalaxyDoc): ConquestState | undefined => {
      const saved = file.conquests[galaxy.id];
      return saved ? reconcileState(galaxy, saved) : undefined;
    },
    [file],
  );

  return { file, loading, error, refresh, saveFor, stateFor };
}

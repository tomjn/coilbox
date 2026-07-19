import { useCallback, useEffect, useRef, useState } from "react";
import {
  runliteMetaLoad,
  runliteMetaSave,
  runliteStateLoad,
  runliteStateSave,
} from "./bindings";
import {
  emptyMeta,
  parseRunMeta,
  parseRunStateFile,
  type RogueliteMeta,
  type RogueliteRun,
} from "./model";

/**
 * Load / save the keyed collection of active runs. Each warpath persists under
 * its own id (mirroring conquest, which keys many runs by galaxy id), so runs
 * for different games/factions coexist instead of overwriting each other. The
 * saved blob is parsed and healed via {@link parseRunStateFile} on read. A ref
 * mirror lets saves build on the latest value without waiting for a React
 * flush, so two quick saves can't clobber each other.
 */
/**
 * Session cache of loaded runs, kept warm by {@link useRuns}. Mirrors conquest's
 * `getCachedGalaxy`: it exists for non-React callers that need a run now —
 * chiefly the breadcrumb `crumb` resolver, which can't use hooks.
 */
let cache: Record<string, RogueliteRun> = {};

/** Synchronous best-effort read of a loaded run from the session cache. */
export function getCachedRun(id: string): RogueliteRun | undefined {
  return cache[id];
}

export function useRuns() {
  const [runs, setRuns] = useState<Record<string, RogueliteRun>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const runsRef = useRef<Record<string, RogueliteRun>>({});

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { json } = await runliteStateLoad({});
      const { runs: parsed } = parseRunStateFile(json);
      runsRef.current = parsed;
      cache = parsed;
      setRuns(parsed);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  const persist = useCallback(async (next: Record<string, RogueliteRun>) => {
    runsRef.current = next;
    cache = next;
    setRuns(next);
    await runliteStateSave({
      json: JSON.stringify({ schemaVersion: 1, runs: next }),
    });
  }, []);

  /** Add or replace a run under `id`, preserving every other run. */
  const saveRun = useCallback(
    async (id: string, run: RogueliteRun) => {
      await persist({ ...runsRef.current, [id]: run });
    },
    [persist],
  );

  /** Remove a run (abandon), preserving every other run. */
  const deleteRun = useCallback(
    async (id: string) => {
      const next = { ...runsRef.current };
      delete next[id];
      await persist(next);
    },
    [persist],
  );

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { runs, loading, error, refresh, saveRun, deleteRun };
}

/**
 * Single-run view by id: the run (or `null`) plus a `save` that writes it back
 * into the keyed collection, or clears just that run with `null`. Keeps the
 * active-run page's `save(next)` / `save(null)` shape unchanged.
 */
export function useRun(id: string | undefined) {
  const { runs, loading, error, refresh, saveRun, deleteRun } = useRuns();
  const run = id ? (runs[id] ?? null) : null;

  const save = useCallback(
    async (next: RogueliteRun | null) => {
      if (!id) return;
      if (next) await saveRun(id, next);
      else await deleteRun(id);
    },
    [id, saveRun, deleteRun],
  );

  return { run, loading, error, refresh, save };
}

/**
 * Load / save persistent meta-progression (between-run unlocks). Small and
 * read-mostly; written only when a run ends.
 */
export function useRunMeta() {
  const [meta, setMeta] = useState<RogueliteMeta>(emptyMeta);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const metaRef = useRef<RogueliteMeta>(emptyMeta);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { json } = await runliteMetaLoad({});
      const parsed = parseRunMeta(json);
      metaRef.current = parsed;
      setMeta(parsed);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  const save = useCallback(async (next: RogueliteMeta) => {
    metaRef.current = next;
    setMeta(next);
    await runliteMetaSave({ json: JSON.stringify(next) });
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { meta, loading, error, refresh, save };
}

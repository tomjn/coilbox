import { useCallback, useEffect, useRef, useState } from "react";
import {
  runliteMetaLoad,
  runliteMetaSave,
  runliteStateLoad,
  runliteStateSave,
} from "./bindings";
import {
  emptyMeta,
  parseRunJson,
  parseRunMeta,
  type RogueliteMeta,
  type RogueliteRun,
  reconcileRun,
} from "./model";

/**
 * Load / save the single active run. Unlike conquest (which keys many runs by
 * galaxy id), a roguelite has at most one run in flight, so the state document
 * is just that run or `null`. The saved blob is healed via {@link reconcileRun}
 * on read. A ref mirror lets `save` build on the latest value without waiting
 * for a React flush, so two quick saves can't clobber each other.
 */
export function useRun() {
  const [run, setRun] = useState<RogueliteRun | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const runRef = useRef<RogueliteRun | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { json } = await runliteStateLoad({});
      let parsed: RogueliteRun | null = null;
      try {
        const data = JSON.parse(json) as { run?: unknown };
        if (data.run) parsed = parseRunJson(JSON.stringify(data.run));
      } catch {
        parsed = null;
      }
      const healed = parsed ? reconcileRun(parsed) : null;
      runRef.current = healed;
      setRun(healed);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  /** Persist the active run (or clear it with `null`). */
  const save = useCallback(async (next: RogueliteRun | null) => {
    runRef.current = next;
    setRun(next);
    await runliteStateSave({
      json: JSON.stringify({ schemaVersion: 1, run: next }),
    });
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

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

/**
 * Reading a game's full unit definitions for the workshop.
 *
 * `src/content/config.ts` is the model for the shape: a session cache, a shared
 * in-flight read so a page mounting the hook twice spawns one worker, and a
 * `reload` for the retry button. The one deliberate difference is how much is
 * cached. Every other unitsync read here keeps a `Map` keyed by target and
 * game, because a scan or a game's info is small and a player moves between
 * games. This read is the whole def table for every unit in a game, and it is
 * big by design (see {@link UnitDefsResult}). Balanced Annihilation's 379 units
 * come to 1,119,012 bytes of JSON, measured by running the worker's
 * `--unit-defs` mode against it on 7 September 2026, and it is not the largest
 * game installed. The workshop edits one game at a time, so the cache holds one
 * game: coming back to the game you were just editing is instant, and browsing
 * five games in a session does not leave five games' worth of unit tables alive
 * behind you.
 *
 * Issue #1269 left this decision to the page on purpose, which is why the hook
 * is here rather than beside the binding.
 */
import { useCallback, useEffect, useState } from "react";
import {
  type CustomParamsResult,
  type UnitDefsResult,
  unitsyncCustomParams,
  unitsyncUnitDefs,
} from "@/content/bindings";
import { shareInFlight } from "@/content/inFlight";

/** How the read is going, in the vocabulary `content/config.ts` already uses. */
export type UnitDefsStatus = "idle" | "loading" | "ready" | "error";

const cacheKey = (enginePath: string, dataDir: string, gameArchive: string) =>
  `${dataDir}::${enginePath}::${gameArchive}`;

/** The one game's defs held for the session, and which game they are. */
let cached: { key: string; result: UnitDefsResult } | null = null;
/** Open reads, so two mounts of the hook wait on one worker. */
const pending = new Map<string, Promise<UnitDefsResult>>();

/** Forget the cached game, so the next read goes back to the worker. */
export function invalidateUnitDefs() {
  cached = null;
}

/**
 * Every key a game declares for every unit, for the game whose archive is
 * named. Nothing is read until all three arguments are known, so a page can
 * mount the hook before the user has picked a game.
 */
export function useUnitDefs(
  enginePath?: string,
  dataDir?: string,
  gameArchive?: string,
) {
  const [defs, setDefs] = useState<UnitDefsResult | null>(null);
  const [status, setStatus] = useState<UnitDefsStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const reload = useCallback(() => {
    invalidateUnitDefs();
    setNonce((n) => n + 1);
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: nonce is the manual retry trigger, not read in the body
  useEffect(() => {
    if (!enginePath || !dataDir || !gameArchive) {
      setDefs(null);
      setStatus("idle");
      setError(null);
      return;
    }
    const key = cacheKey(enginePath, dataDir, gameArchive);
    if (cached?.key === key) {
      setDefs(cached.result);
      setStatus("ready");
      setError(null);
      return;
    }
    let cancelled = false;
    setStatus("loading");
    setError(null);
    shareInFlight(pending, key, () =>
      unitsyncUnitDefs({ enginePath, dataDir, gameArchive }),
    )
      .then((res) => {
        if (cancelled) return;
        // The worker's own complaint is read before anything is taken out of
        // the result, and a missing `units` is treated as no units rather than
        // walked into. A worker that predates `--unit-defs` answers with the
        // scan envelope and its reason ("unknown argument: --unit-defs"), and
        // reaching for `res.units` first turned that into a TypeError with
        // nothing in it for whoever has to go and rebuild the sidecar.
        const units = res.units ?? {};
        setDefs({
          ...res,
          units,
          unitErrors: res.unitErrors ?? [],
          errors: res.errors ?? [],
        });
        if (Object.keys(units).length === 0 && res.errors?.length) {
          setStatus("error");
          setError(res.errors[0]);
          return;
        }
        // Only a result the worker could checksum is kept, mirroring its own
        // disk cache, so an unsyncable read stays retryable rather than
        // sticking for the session.
        if (res.checksum) cached = { key, result: res };
        setStatus("ready");
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setDefs(null);
        setStatus("error");
        setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [enginePath, dataDir, gameArchive, nonce]);

  return { defs, status, error, reload, loading: status === "loading" };
}

/**
 * Which of a game's Lua files name each custom parameter, kept per game for the
 * session (issue #2661).
 *
 * A `Map` rather than the single slot the def table gets above, because this is
 * the small read: Beyond All Reason's index is 57,348 bytes, measured by running
 * the worker's `--custom-params` mode against it on 7 September 2026, next to
 * over a megabyte of defs. Keeping five games' indexes alive costs less than one
 * game's defs.
 *
 * Nothing here is required for the page to work. A parameter with no consumer
 * found and a parameter whose scan has not come back yet are both a row with no
 * note on it, so the page never waits on this.
 */
const consumerCache = new Map<string, CustomParamsResult>();
const consumerPending = new Map<string, Promise<CustomParamsResult>>();

export function useCustomParams(
  enginePath?: string,
  dataDir?: string,
  gameArchive?: string,
) {
  const [result, setResult] = useState<CustomParamsResult | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!enginePath || !dataDir || !gameArchive) {
      setResult(null);
      setLoading(false);
      return;
    }
    const key = cacheKey(enginePath, dataDir, gameArchive);
    const hit = consumerCache.get(key);
    if (hit) {
      setResult(hit);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setResult(null);
    setLoading(true);
    shareInFlight(consumerPending, key, () =>
      unitsyncCustomParams({ enginePath, dataDir, gameArchive }),
    )
      .then((res) => {
        // A worker that predates `--custom-params` answers with the scan
        // envelope and its reason, so `params` is read defensively rather than
        // walked into, the same way `useUnitDefs` reads `units`.
        const filled: CustomParamsResult = {
          ...res,
          params: res.params ?? {},
          errors: res.errors ?? [],
        };
        // Only a scan the worker could checksum is kept, mirroring its own disk
        // cache, so a failed read stays retryable rather than sticking for the
        // session.
        if (res.checksum) consumerCache.set(key, filled);
        if (cancelled) return;
        setResult(filled);
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        // Swallowed on purpose. This is a note alongside a field, and a page
        // that could otherwise be edited must not turn into an error because
        // the note could not be fetched.
        setResult(null);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [enginePath, dataDir, gameArchive]);

  return { consumers: result, loading };
}

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
import { type UnitDefsResult, unitsyncUnitDefs } from "@/content/bindings";
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

import { useSetting } from "@picoframe/frame";
import { useCallback, useMemo } from "react";
import { useHubMapAppearances } from "@/hub/maps/useMapFacts";
import { updateStoredSetting } from "../lib/storedSetting";
import type { MapAppearance } from "../mapconv/bindings";
import {
  MAP_APPEARANCE_KEY,
  type MapAppearanceCache,
  mergeAppearances,
  namesWithNoLocalAnswer,
  spaceMapNames,
} from "./mapAppearance";

/**
 * React hooks over the opportunistic per-map appearance cache (pure helpers in
 * `mapAppearance.ts`). Populated as a side effect of the minimap the app
 * already renders (see `useRecordMapAppearance`, wired into
 * `useUnitsyncMinimap`), so it never mounts an archive of its own. Best-effort:
 * a map whose minimap has never been resolved is simply absent.
 */

/** The raw cache record (reactive). */
export function useMapAppearanceCache(): MapAppearanceCache {
  const [cache] = useSetting<MapAppearanceCache>(MAP_APPEARANCE_KEY, {});
  return cache;
}

/**
 * What is known about each of these maps: this machine's own answer where it has
 * one, and the hub's for the rest (issue #1739).
 *
 * Local wins, always. The local answer came from the archive on this machine and
 * the hub's came from whoever else held a map of that name, so the fallback is
 * for names with no local archive rather than a second opinion about one there
 * is. The hub is only asked about the names the cache has no entry for, so a
 * player with every map in the list makes no request at all.
 *
 * The whole appearance record rather than one field of it, because that is what
 * the cache holds and what the next consumer of it will want.
 */
export function useMapAppearances(
  names: readonly string[],
): MapAppearanceCache {
  const local = useMapAppearanceCache();
  const missing = useMemo(
    () => namesWithNoLocalAnswer(names, local),
    [names, local],
  );
  const remote = useHubMapAppearances(missing);

  return useMemo(
    () => mergeAppearances(local, Object.fromEntries(remote)),
    [local, remote],
  );
}

/**
 * The set of known space-map names (reactive).
 *
 * `names` is what the caller is drawing. Passing them lets the hub answer for
 * the maps this machine has not got, which is what stops a galaxy of
 * uninstalled maps drawing planets where it should draw asteroids. Passing none
 * is the local cache alone, which is what this always was.
 */
export function useKnownSpaceMaps(names: readonly string[] = []): Set<string> {
  const cache = useMapAppearances(names);
  return useMemo(() => spaceMapNames(cache), [cache]);
}

/**
 * Bank one map's appearance, folding it into the cache as stored rather than the
 * cache a render read. A battle list mounts a minimap per battle and each one
 * records inside its own effect, so on the warm path every write lands before
 * any re-render. Folding over the render's copy banked only the last map
 * (issue #1374), and a ref per component instance can't fix that because the
 * instances can't see each other's writes.
 *
 * A no-op when the entry is already present (we only learn more by re-resolving,
 * which we don't do), so repeat views don't rewrite settings.
 */
export function recordMapAppearance(
  name: string,
  appearance: MapAppearance,
  write: (next: MapAppearanceCache) => void,
) {
  updateStoredSetting<MapAppearanceCache>(
    MAP_APPEARANCE_KEY,
    {},
    write,
    (prev) => (prev[name] ? prev : { ...prev, [name]: appearance }),
  );
}

/**
 * A stable recorder that banks a map's appearance. Stable so callers can hold it
 * in an effect's dependencies, which `useUnitsyncMinimap` does.
 */
export function useRecordMapAppearance(): (
  name: string,
  appearance: MapAppearance,
) => void {
  const [, setCache] = useSetting<MapAppearanceCache>(MAP_APPEARANCE_KEY, {});
  return useCallback(
    (name, appearance) => {
      recordMapAppearance(name, appearance, setCache);
    },
    [setCache],
  );
}

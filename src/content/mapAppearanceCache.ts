import { useSetting } from "@picoframe/frame";
import { useCallback, useMemo } from "react";
import { updateStoredSetting } from "../lib/storedSetting";
import type { MapAppearance } from "../mapconv/bindings";
import {
  MAP_APPEARANCE_KEY,
  type MapAppearanceCache,
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

/** The set of known space-map names (reactive). */
export function useKnownSpaceMaps(): Set<string> {
  const cache = useMapAppearanceCache();
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

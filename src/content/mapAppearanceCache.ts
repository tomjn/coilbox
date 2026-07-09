import { useSetting } from "@picoframe/frame";
import { useCallback, useMemo, useRef } from "react";
import type { MapAppearance } from "../mapconv/bindings";

/**
 * Opportunistic, persistent cache of per-map `MapAppearance`, keyed by map
 * spring-name. Populated as a side effect of the minimap the app already
 * renders (see `useRecordMapAppearance`, wired into `useUnitsyncMinimap`), so
 * it never mounts an archive of its own. Best-effort: a map whose minimap has
 * never been resolved is simply absent. Stores the whole appearance record so
 * future features (wind, tidal, water colours) reuse it, not just `voidWater`.
 */
const MAP_APPEARANCE_KEY = "content.mapAppearance";

type Cache = Record<string, MapAppearance>;

/** Names in the cache that are space maps (`voidWater === true`). Pure. */
export function spaceMapNames(cache: Cache): Set<string> {
  const out = new Set<string>();
  for (const [name, app] of Object.entries(cache)) {
    if (app?.voidWater === true) out.add(name);
  }
  return out;
}

/** The raw cache record (reactive). */
export function useMapAppearanceCache(): Cache {
  const [cache] = useSetting<Cache>(MAP_APPEARANCE_KEY, {});
  return cache;
}

/** The set of known space-map names (reactive). */
export function useKnownSpaceMaps(): Set<string> {
  const cache = useMapAppearanceCache();
  return useMemo(() => spaceMapNames(cache), [cache]);
}

/**
 * A stable recorder that banks a map's appearance. Uses a ref for the current
 * cache so the returned callback never goes stale and callers need not depend
 * on the cache. A no-op when the entry is already present (we only learn more
 * by re-resolving, which we don't do), so repeat views don't rewrite settings.
 */
export function useRecordMapAppearance(): (
  name: string,
  appearance: MapAppearance,
) => void {
  const [cache, setCache] = useSetting<Cache>(MAP_APPEARANCE_KEY, {});
  const ref = useRef(cache);
  ref.current = cache;
  return useCallback(
    (name, appearance) => {
      if (ref.current[name]) return;
      setCache({ ...ref.current, [name]: appearance });
    },
    [setCache],
  );
}

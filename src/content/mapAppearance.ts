import type { MapAppearance } from "../mapconv/bindings";

/**
 * Pure map-appearance cache helpers, kept free of the frame `useSetting`
 * import so they unit-test (the hooks live in `mapAppearanceCache.ts`). The
 * cache is keyed by map spring-name and stores the whole {@link MapAppearance}
 * record so future features (wind, tidal, water colours) reuse it, not just
 * `voidWater`.
 */

export const MAP_APPEARANCE_KEY = "content.mapAppearance";

export type MapAppearanceCache = Record<string, MapAppearance>;

/** Names in the cache that are space maps (`voidWater === true`). */
export function spaceMapNames(cache: MapAppearanceCache): Set<string> {
  const out = new Set<string>();
  for (const [name, app] of Object.entries(cache)) {
    if (app?.voidWater === true) out.add(name);
  }
  return out;
}

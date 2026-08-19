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

/**
 * The names in `wanted` this machine has no answer for (issue #1739).
 *
 * What the hub is asked about, and nothing else. A player with every map in the
 * list installed produces an empty set here and makes no request at all, which
 * is the rule that keeps the lookup a fallback rather than a second opinion.
 *
 * Deduplicated, because a list of what is on screen repeats: several battles
 * play the same map.
 */
export function namesWithNoLocalAnswer(
  wanted: readonly string[],
  cache: MapAppearanceCache,
): string[] {
  const missing = new Set<string>();
  for (const name of wanted) {
    if (name && !cache[name]) missing.add(name);
  }
  return [...missing];
}

/**
 * The local cache with the hub's answers underneath it.
 *
 * Local always wins. Its answer came from the archive on this machine, and the
 * hub's came from whoever else held a map of that name, so where the two
 * disagree the one that read the bytes here is the one to believe.
 */
export function mergeAppearances(
  local: MapAppearanceCache,
  remote: MapAppearanceCache,
): MapAppearanceCache {
  return Object.keys(remote).length === 0 ? local : { ...remote, ...local };
}

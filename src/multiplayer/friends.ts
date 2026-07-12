import { useSetting } from "@picoframe/frame";

/**
 * Client-local favourites ("friends"): usernames the user has starred for quick
 * access, scoped per server so a nick on one lobby doesn't leak onto another.
 * This is a pure preference with no server protocol behind it, so it lives in the
 * frame settings store and works on every server regardless of friend support.
 *
 * It is deliberately the base layer for a later server-side friend protocol
 * (issue #187): that work merges server friends into this local list rather than
 * replacing it, so the store stays a plain `Record<serverKey, string[]>` of names.
 */

/** Names for one server, deduped and sorted. Tolerates a missing list. */
export function favouritesFor(
  map: Record<string, string[]>,
  serverKey: string,
): string[] {
  return map[serverKey] ?? [];
}

/** True when `name` is a favourite on `serverKey`. */
export function isFavourite(
  map: Record<string, string[]>,
  serverKey: string,
  name: string,
): boolean {
  return favouritesFor(map, serverKey).includes(name);
}

/**
 * Add `name` to `serverKey`'s favourites. Idempotent (deduped by name); the list
 * is kept sorted so the Friends section renders in a stable order. Returns a new
 * map.
 */
export function addFavourite(
  map: Record<string, string[]>,
  serverKey: string,
  name: string,
): Record<string, string[]> {
  const cur = favouritesFor(map, serverKey);
  if (cur.includes(name)) return map;
  return { ...map, [serverKey]: [...cur, name].sort() };
}

/** Remove `name` from `serverKey`'s favourites. Returns a new map. */
export function removeFavourite(
  map: Record<string, string[]>,
  serverKey: string,
  name: string,
): Record<string, string[]> {
  const cur = favouritesFor(map, serverKey);
  if (!cur.includes(name)) return map;
  return { ...map, [serverKey]: cur.filter((n) => n !== name) };
}

/**
 * The per-`serverKey` favourites list. A preference (client-local, no protocol),
 * so it lives in the frame settings store rather than backend state.
 */
export function useFavourites() {
  return useSetting<Record<string, string[]>>("multiplayer.favourites", {});
}

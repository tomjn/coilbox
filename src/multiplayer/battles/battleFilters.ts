import type { Battle } from "../bindings";

export type BattleSortKey = "players" | "map" | "game" | "title";

export interface BattleFilters {
  search: string;
  hideEmpty: boolean;
  hideLockedPassworded: boolean;
  hideFull: boolean;
  sortKey: BattleSortKey;
  sortDir: "asc" | "desc";
}

/**
 * Total occupants of a battle. A server that counts them for us says so in
 * `playerCount`, which is the only thing a Tachyon lobby list carries: it has no
 * roster until you are in the lobby. Otherwise the count comes from the roster,
 * where the founder is tracked in `host` and is not guaranteed to appear in
 * `members` (classic TASServer sends no JOINEDBATTLE for the founder), so add
 * one for the host unless they are already a member key.
 *
 * Takes the fields it reads rather than a whole `Battle`, so a caller holding a
 * narrower snapshot of the lobby can ask. `src/home/suggestedMap.ts` does.
 */
export function occupancy(
  b: Pick<Battle, "host" | "members" | "playerCount">,
): number {
  if (b.playerCount !== null) return b.playerCount;
  const m = Object.keys(b.members).length;
  return Object.hasOwn(b.members, b.host) ? m : m + 1;
}

/** The affordance a non-joined battle row offers: join an open battle, or walk
 * into the room of a running one, where the match can be watched. */
export interface BattleRowAction {
  kind: "join" | "watch";
  label: string;
  disabled: boolean;
}

/**
 * Decide the action for a battle row you are not already in. An open battle offers
 * Join, gated on being joinable and not full. A running battle (host in-game)
 * is joined too, and never blocked by a full roster: nobody walking into a running
 * room takes a player slot in the match. Joining starts no engine. The room's own
 * button offers to watch, once you are in it. Both require `canJoin` (connected,
 * not busy, not already in a battle). Pure — no snapshot access.
 */
export function battleRowAction(
  b: Battle,
  opts: { canJoin: boolean; inProgress: boolean },
): BattleRowAction {
  if (opts.inProgress) {
    return { kind: "watch", label: "Join", disabled: !opts.canJoin };
  }
  const full = occupancy(b) >= b.maxPlayers;
  return { kind: "join", label: "Join", disabled: !opts.canJoin || full };
}

function compareBy(key: BattleSortKey, a: Battle, b: Battle): number {
  switch (key) {
    case "players":
      return occupancy(a) - occupancy(b) || a.id - b.id;
    case "map":
      return a.map.localeCompare(b.map) || a.id - b.id;
    case "game":
      return a.modname.localeCompare(b.modname) || a.id - b.id;
    case "title":
      return a.title.localeCompare(b.title) || a.id - b.id;
  }
}

/** Filter and sort a battle list for display. Pure — no snapshot access. */
export function filterSortBattles(
  battles: Battle[],
  f: BattleFilters,
): Battle[] {
  const q = f.search.trim().toLowerCase();
  const filtered = battles.filter((b) => {
    if (q) {
      const hay = `${b.title} ${b.map} ${b.host} ${b.modname}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    if (f.hideEmpty && occupancy(b) <= 1) return false;
    if (f.hideLockedPassworded && (b.locked || b.passworded)) return false;
    if (f.hideFull && occupancy(b) >= b.maxPlayers) return false;
    return true;
  });
  const dir = f.sortDir === "asc" ? 1 : -1;
  return [...filtered].sort((a, b) => dir * compareBy(f.sortKey, a, b));
}

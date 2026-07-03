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
 * Total occupants of a battle. The founder is tracked in `host` and is not
 * guaranteed to appear in `members` (classic TASServer sends no JOINEDBATTLE for
 * the founder), so add one for the host unless they are already a member key.
 */
export function occupancy(b: Battle): number {
  const m = Object.keys(b.members).length;
  return Object.hasOwn(b.members, b.host) ? m : m + 1;
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

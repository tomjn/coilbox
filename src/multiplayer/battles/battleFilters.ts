import { t } from "@lingui/core/macro";
import type { Battle } from "../bindings";

export type BattleSortKey = "players" | "map" | "game" | "title";

export interface BattleFilters {
  search: string;
  hideEmpty: boolean;
  hideLockedPassworded: boolean;
  hideFull: boolean;
  /** Hide battles on an engine other than Spring or Recoil (Open Annihilation). */
  hideOpenAnnihilation: boolean;
  sortKey: BattleSortKey;
  sortDir: "asc" | "desc";
}

/**
 * The engine name of a battle that runs on neither Spring nor Recoil, or null.
 * An Open Annihilation host sends `Open Annihilation` here. Recoil hosts send
 * `spring`, and a lobby that names no engine (Tachyon) reads as Recoil.
 */
export function otherEngineName(b: Pick<Battle, "engine">): string | null {
  const name = b.engine?.trim();
  if (!name) return null;
  const lower = name.toLowerCase();
  return lower === "spring" || lower === "recoil" ? null : name;
}

/**
 * Apply the profile's game filter to a battle list. Recoil battles are matched
 * on their game name. A battle on another engine is dropped outright, because a
 * profile narrowed to a game is narrowed to a Recoil game and a loose pattern
 * could otherwise match the game name an Open Annihilation host sends.
 */
export function scopeToProfileGame(
  battles: Battle[],
  matcher: ((name: string) => boolean) | null,
): Battle[] {
  if (!matcher) return battles;
  return battles.filter(
    (b) => otherEngineName(b) === null && matcher(b.modname),
  );
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

/**
 * Whether a battle has started. The server says so on the lobby, which is what
 * Tachyon does, or the host is in-game, which is all TASServer gives us.
 */
export function isBattleRunning(
  b: Pick<Battle, "inProgress" | "host">,
  users: Record<string, { status: { ingame: boolean } }> | undefined,
): boolean {
  return b.inProgress || (users?.[b.host]?.status.ingame ?? false);
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
 * Join, or Spectate when every player slot is taken, since the player cap does not
 * count spectators and a joiner lands as one. A running battle (host in-game) is
 * joined too. Joining starts no engine. The room's own button offers to watch,
 * once you are in it. Both require `canJoin` (connected, not busy, not already in
 * a battle). Pure, with no snapshot access.
 */
export function battleRowAction(
  b: Battle,
  opts: { canJoin: boolean; inProgress: boolean },
): BattleRowAction {
  if (opts.inProgress) {
    return { kind: "watch", label: t`Join`, disabled: !opts.canJoin };
  }
  const full = occupancy(b) >= b.maxPlayers;
  return {
    kind: "join",
    label: full ? t`Spectate` : t`Join`,
    disabled: !opts.canJoin,
  };
}

export type BattleGroupKey = "open" | "passworded" | "running" | "locked";

/**
 * Split a battle list into the groups the lobby shows, keeping the input order.
 * The battle you are in is left out, since it is pinned above the groups even when
 * locked. Locked battles, waiting or running, go in `locked` alone, because nobody
 * can enter them. Of the rest, running wins over passworded: whether a battle has
 * started is the first thing that decides what you can do with it.
 */
export function groupBattles(
  battles: Battle[],
  joinedId: number | null,
  inProgressIds: ReadonlySet<number>,
): Record<BattleGroupKey, Battle[]> {
  const groups: Record<BattleGroupKey, Battle[]> = {
    open: [],
    passworded: [],
    running: [],
    locked: [],
  };
  for (const b of battles) {
    if (b.id === joinedId) continue;
    if (b.locked) groups.locked.push(b);
    else if (inProgressIds.has(b.id)) groups.running.push(b);
    else if (b.passworded) groups.passworded.push(b);
    else groups.open.push(b);
  }
  return groups;
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
    if (f.hideOpenAnnihilation && otherEngineName(b) !== null) return false;
    return true;
  });
  const dir = f.sortDir === "asc" ? 1 : -1;
  return [...filtered].sort((a, b) => dir * compareBy(f.sortKey, a, b));
}

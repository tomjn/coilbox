import { useSetting } from "@picoframe/frame";
import { updateStoredSetting } from "../../lib/storedSetting";
import type { Battle } from "../bindings";
import { occupancy } from "./battleFilters";

/**
 * A search the player saved from the Battles page, which coilbox keeps running
 * while they are connected. It applies to every connected server.
 */
export interface SavedBattleSearch {
  id: string;
  /** Part of the game's name, case-insensitive. Required. */
  game: string;
  /** Part of the map's name, case-insensitive. Empty means any map. */
  map: string;
  /** Fewest players in the battle, the host included. 0 means no minimum. */
  minPlayers: number;
  /** The battle must have a free player slot. */
  freeSlot: boolean;
  /** The battle must not be passworded. */
  noPassword: boolean;
  /** Off means it is kept but raises nothing. */
  enabled: boolean;
}

/** Whether one battle satisfies every condition of one search. Pure. */
export function matchesSearch(s: SavedBattleSearch, b: Battle): boolean {
  if (!b.modname.toLowerCase().includes(s.game.trim().toLowerCase())) {
    return false;
  }
  const map = s.map.trim().toLowerCase();
  if (map && !b.map.toLowerCase().includes(map)) return false;
  const players = occupancy(b);
  if (players < s.minPlayers) return false;
  if (s.freeSlot && players >= b.maxPlayers) return false;
  if (s.noPassword && b.passworded) return false;
  return true;
}

/**
 * What one connection has already told the player, or decided not to: per
 * search id, the ids of the battles that matched. Battle ids belong to one
 * server, so each connection keeps its own record.
 */
export type ToldBattles = ReadonlyMap<string, ReadonlySet<number>>;

export interface SearchMatch {
  search: SavedBattleSearch;
  battle: Battle;
}

/**
 * Which battles newly match a saved search, given what has been told so far.
 * Pure: returns the matches and the record to pass to the next call.
 *
 * - A battle notifies once for as long as it stays listed. Matching, ceasing to
 *   match and matching again does not notify again, because a battle near a
 *   player-count threshold would otherwise notify on every join and leave.
 *   Once it leaves the list its record goes, so a battle id that comes back
 *   notifies again.
 * - A search seen for the first time is only recorded. That covers the first
 *   list after connecting and a search saved just now, so neither announces
 *   battles that were already there.
 * - A search that is switched off is recorded but raises nothing, so switching
 *   it on does not announce battles that appeared meanwhile.
 * - The battle the player is in is recorded but never raised, so leaving it
 *   does not announce it.
 */
export function newMatches(
  searches: readonly SavedBattleSearch[],
  battles: readonly Battle[],
  joinedId: number | null,
  told: ToldBattles,
): { matches: SearchMatch[]; told: ToldBattles } {
  const listed = new Set(battles.map((b) => b.id));
  const next = new Map<string, ReadonlySet<number>>();
  const matches: SearchMatch[] = [];
  for (const search of searches) {
    const before = told.get(search.id);
    const now = new Set<number>();
    for (const b of battles) {
      if (!matchesSearch(search, b)) continue;
      now.add(b.id);
      const seen = before?.has(b.id) ?? true;
      if (!seen && search.enabled && b.id !== joinedId) {
        matches.push({ search, battle: b });
      }
    }
    if (before) {
      for (const id of before) if (listed.has(id)) now.add(id);
    }
    next.set(search.id, now);
  }
  return { matches, told: next };
}

export const SAVED_BATTLE_SEARCHES_KEY = "multiplayer.savedBattleSearches";

const NO_SEARCHES: SavedBattleSearch[] = [];

/**
 * The saved searches, one list for every server, and the way to change them. A
 * preference, so it lives in the frame settings store like the page's filters
 * do. Writes fold over what is stored rather than over this render's list, for
 * the reason `updateStoredSetting` gives.
 */
export function useSavedBattleSearches() {
  const [searches, setSearches] = useSetting<SavedBattleSearch[]>(
    SAVED_BATTLE_SEARCHES_KEY,
    NO_SEARCHES,
  );
  const update = (change: (prev: SavedBattleSearch[]) => SavedBattleSearch[]) =>
    updateStoredSetting<SavedBattleSearch[]>(
      SAVED_BATTLE_SEARCHES_KEY,
      NO_SEARCHES,
      setSearches,
      change,
    );
  return { searches, update };
}

/** A search in words, for the settings list and the notification. */
export function describeSearch(s: SavedBattleSearch): string {
  const parts = [s.game.trim()];
  if (s.map.trim()) parts.push(`on ${s.map.trim()}`);
  if (s.minPlayers > 0) parts.push(`${s.minPlayers}+ players`);
  if (s.freeSlot) parts.push("free slot");
  if (s.noPassword) parts.push("no password");
  return parts.join(", ");
}

/** The Battles page with one battle's row brought into view. */
export function battleRowHref(serverKey: string, battleId: number): string {
  return `/battles?${new URLSearchParams({
    server: serverKey,
    battle: String(battleId),
  }).toString()}`;
}

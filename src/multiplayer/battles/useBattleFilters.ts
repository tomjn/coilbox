import { useSetting } from "@picoframe/frame";
import type { Dispatch, SetStateAction } from "react";
import { useState } from "react";
import type { BattleFilters } from "./battleFilters";

/** The hide/sort subset of {@link BattleFilters} that persists across restarts. */
type PersistedBattleFilters = Omit<BattleFilters, "search">;

const defaultPersistedBattleFilters: PersistedBattleFilters = {
  hideEmpty: false,
  hideLockedPassworded: false,
  hideFull: false,
  sortKey: "players",
  sortDir: "desc",
};

/**
 * `BattleFilters` state for the Battles page, split across two backends: the
 * search text is transient (plain `useState`, cleared each visit — searches
 * are one-off), while hide-empty/full/passworded and sort persist through the
 * frame settings store (like the skirmish draft) so a regular's usual view
 * survives a restart. Exposes the same `[filters, setFilters]` shape as a
 * plain `useState<BattleFilters>` so callers (and `BattleFilterPopover`) don't
 * need to know about the split.
 */
export function useBattleFilters(): [
  BattleFilters,
  Dispatch<SetStateAction<BattleFilters>>,
] {
  const [search, setSearch] = useState("");
  const [persisted, setPersisted] = useSetting<PersistedBattleFilters>(
    "multiplayer.battleFilters",
    defaultPersistedBattleFilters,
  );

  const filters: BattleFilters = { search, ...persisted };
  const setFilters: Dispatch<SetStateAction<BattleFilters>> = (action) => {
    const next =
      typeof action === "function"
        ? (action as (f: BattleFilters) => BattleFilters)(filters)
        : action;
    setSearch(next.search);
    setPersisted({
      hideEmpty: next.hideEmpty,
      hideLockedPassworded: next.hideLockedPassworded,
      hideFull: next.hideFull,
      sortKey: next.sortKey,
      sortDir: next.sortDir,
    });
  };

  return [filters, setFilters];
}

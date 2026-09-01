/**
 * Narrowing and arranging the Scenario Builder's list (issue #2181).
 *
 * The list is everything an author has ever made, newest edit first, and past a
 * screenful the only way to reach a scenario is to scroll to it. These are the
 * two answers to that: filter it down to the ones being looked for, and name
 * each game once instead of on every row.
 *
 * Pure functions, separate from the page, because the ordering rules here are
 * the part worth pinning in a test on their own.
 */

import type { LoadedScenario } from "../../storage";

/** One of the three sources, or "all" for the filter being off. */
export type SourceFilter = "all" | LoadedScenario["source"];

/**
 * What each source is called on its chip.
 *
 * "Mine" rather than "Local" because the distinction an author cares about is
 * whose document it is, not where the bytes are: a local scenario is the only
 * kind they can freely edit and delete.
 */
export const SOURCE_LABELS: Record<LoadedScenario["source"], string> = {
  local: "Mine",
  bundled: "Bundled",
  game: "From games",
};

/** The chips, in the order they are offered. */
export const SOURCE_ORDER: LoadedScenario["source"][] = [
  "local",
  "bundled",
  "game",
];

/**
 * The scenarios matching the search box and the source chip.
 *
 * The search is on the name alone, and it is a substring rather than a fuzzy
 * match. A name is what an author is scanning the list for, and it is the only
 * field on the row that is always shown, so every match can be seen to be a
 * match. Searching the description too would let a row appear with nothing in it
 * that contains what was typed, which reads as a bug rather than a feature.
 */
export function filterScenarios(
  scenarios: LoadedScenario[],
  query: string,
  source: SourceFilter,
): LoadedScenario[] {
  const q = query.trim().toLowerCase();
  return scenarios.filter((loaded) => {
    if (source !== "all" && loaded.source !== source) return false;
    if (q && !loaded.scenario.name.toLowerCase().includes(q)) return false;
    return true;
  });
}

/** A run of scenarios set on the same game, under one heading. */
export interface ScenarioGroup {
  /** The game they are set on. Empty for the drafts that name no game. */
  gameName: string;
  scenarios: LoadedScenario[];
}

/**
 * The same scenarios, gathered under the game each is set on.
 *
 * Nothing is reordered. The list arrives newest edit first, so taking the groups
 * in the order their first member appears puts the group holding the single most
 * recently edited scenario at the top, and keeps each group internally newest
 * first. The newest edit is still the first thing on the screen, which is what
 * the ordering was for, and it is now also stable: editing a scenario moves it
 * to the top of its own group and moves that group to the top, rather than
 * shuffling one row past unrelated ones.
 *
 * Drafts with no game are a group like any other, placed by their newest member
 * rather than pinned to either end. A draft is a scenario in progress, so it
 * usually is the newest member and lands at the top anyway.
 */
export function groupScenariosByGame(
  scenarios: LoadedScenario[],
): ScenarioGroup[] {
  const groups = new Map<string, LoadedScenario[]>();
  for (const loaded of scenarios) {
    const gameName = loaded.scenario.setup.gameName || "";
    const existing = groups.get(gameName);
    if (existing) existing.push(loaded);
    else groups.set(gameName, [loaded]);
  }
  return [...groups].map(([gameName, group]) => ({
    gameName,
    scenarios: group,
  }));
}

/**
 * Which source chips are worth offering for this list.
 *
 * A chip that can only ever match nothing is noise, and with fewer than two
 * sources present there is nothing to choose between, so the row is dropped
 * whole. Computed from the unfiltered list, so the chips do not appear and
 * disappear as the search box is typed into.
 */
export function offeredSources(
  scenarios: LoadedScenario[],
): LoadedScenario["source"][] {
  const present = new Set(scenarios.map((loaded) => loaded.source));
  const offered = SOURCE_ORDER.filter((source) => present.has(source));
  return offered.length > 1 ? offered : [];
}

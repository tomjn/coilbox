/**
 * Which scenarios a player is offered, and what a row says about one.
 *
 * The Scenarios page and the Scenario Builder list the same documents for
 * different reasons, so the two questions they share live here: what a scenario
 * holds, and whether it is a document worth putting in front of the engine at
 * all.
 */

import type { Campaign } from "../campaign/model";
import type { Scenario } from "./model";

/** What a scenario holds, for a list row's second line. */
export function scenarioContents(scenario: Scenario): string {
  const counts = [
    [scenario.actors.length + scenario.groups.length, "unit placement"],
    [scenario.zones.length, "zone"],
    [scenario.triggers.length, "trigger"],
    [scenario.objectives.length, "objective"],
  ] as const;
  return counts
    .map(([n, noun]) => `${n} ${noun}${n === 1 ? "" : "s"}`)
    .join(" · ");
}

/**
 * Whether a scenario names both a game and a map. One that does not is a draft
 * the author has not set up yet, and nothing can be launched from it.
 */
export function isSetUp(scenario: Scenario): boolean {
  return !!scenario.setup.gameName && !!scenario.setup.mapName;
}

/**
 * The campaigns with a mission carrying a copy of this scenario, by title.
 *
 * More than one is possible. Two missions can attach the same scenario, in one
 * campaign or in two, and the attach picker does not hide a scenario that is
 * already in use. A campaign is counted once however many of its missions carry
 * it, because the question a row is answering is which campaigns depend on this
 * scenario, not how many times it appears in them.
 *
 * `scenarioIsAttached` answers the same question as a yes or no, for the delete
 * confirmation. This one keeps the titles, so a row can say how many.
 */
export function campaignsUsingScenario(
  campaigns: Campaign[],
  scenarioId: string,
): string[] {
  return campaigns
    .filter((c) => c.missions.some((m) => m.scenario?.id === scenarioId))
    .map((c) => c.title);
}

/**
 * The scenarios a player is offered, newest edit first, as
 * {@link listScenarios} already orders them.
 *
 * Only setup is judged here. Whether the game is *installed* is a separate
 * question, asked per row by `scenarioLaunchBlocker` so the answer can be a
 * sentence rather than a disappearance.
 */
export function playableScenarios(scenarios: Scenario[]): Scenario[] {
  return scenarios.filter(isSetUp);
}

/**
 * Which scenarios a player is offered, and what a row says about one.
 *
 * The Scenarios page and the Scenario Builder list the same documents for
 * different reasons, so the two questions they share live here: what a scenario
 * holds, and whether it is a document worth putting in front of the engine at
 * all.
 */

import type { Campaign } from "../campaign/model";
import { relativeTime } from "../lib/relativeTime";
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
 * What a scenario holds and when it was last written, for the Scenario Builder
 * row (issue #2179).
 *
 * The edit time rides on the contents line rather than on the line naming the
 * game and the map, for two reasons. It is a fact about the document, as the
 * counts are, while the other line is about the engine setup. And the counts are
 * small integers, so this line has a length the row can predict, where a game's
 * archive name has none and would push the time off the end of a narrow window.
 *
 * `campaignSummary` puts the same segment in the same place, last, so a campaign
 * row and a scenario row read as one product.
 */
export function scenarioSummary(
  scenario: Scenario,
  now: number = Date.now(),
): string {
  const edited = relativeTime(scenario.updatedAt, now);
  return edited
    ? `${scenarioContents(scenario)} · edited ${edited}`
    : scenarioContents(scenario);
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

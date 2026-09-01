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

/** The kinds of content a scenario is counted by, in the order they are read. */
export type ScenarioCountKey =
  | "placements"
  | "zones"
  | "triggers"
  | "objectives";

/** How many of one kind a scenario holds, and what that kind is called. */
export type ScenarioCount = {
  key: ScenarioCountKey;
  count: number;
  /** Singular, so a caller can phrase it either way. */
  noun: string;
};

/**
 * What a scenario holds, counted.
 *
 * The counts are given as data rather than as a finished string because the two
 * screens listing scenarios want different pictures of them. The Scenarios page
 * and the campaign pickers read them as a sentence, in the middle of a
 * paragraph. The Scenario Builder draws them as chips (issue #2180), where a
 * wall of near identical sentences was the problem. Both start here, so neither
 * can drift from the other about what a placement is.
 */
export function scenarioCounts(scenario: Scenario): ScenarioCount[] {
  return [
    {
      key: "placements",
      count: scenario.actors.length + scenario.groups.length,
      noun: "unit placement",
    },
    { key: "zones", count: scenario.zones.length, noun: "zone" },
    { key: "triggers", count: scenario.triggers.length, noun: "trigger" },
    { key: "objectives", count: scenario.objectives.length, noun: "objective" },
  ];
}

/** One count named, pluralised against itself: "1 zone", "0 zones". */
export function countPhrase({ count, noun }: ScenarioCount): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/** What a scenario holds, as a sentence, for a list row's second line. */
export function scenarioContents(scenario: Scenario): string {
  return scenarioCounts(scenario).map(countPhrase).join(" · ");
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

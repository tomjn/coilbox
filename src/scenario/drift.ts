/**
 * Whether what a game ships still matches the document beside it (issue #2160).
 *
 * A game can carry both `mission.lua` and the `scenario.json` it was compiled
 * from, and an author editing one without the other leaves the pair out of step.
 *
 * The comparison is exact rather than a heuristic, because `compileScenario` is
 * deterministic: array order is document order and author-keyed tables are
 * emitted in sorted key order. So recompiling the document and comparing text is
 * the whole test.
 */

import { compileScenario } from "./compile";
import type { Scenario } from "./model";

export function missionDrifted(scenario: Scenario, shipped: string): boolean {
  return compileScenario(scenario) !== shipped;
}

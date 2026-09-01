/**
 * What is wrong with the mission being written, worked out while it is being
 * written (issue #2162).
 *
 * The validator already answers this, and until now the only thing that asked
 * was the launch: an author found out that a trigger points at a zone they
 * deleted when they pressed Test. So the same question is asked of the document
 * as it changes, and the editor header carries the answer.
 *
 * Two things make that affordable. The mission is built by
 * {@link scenarioMissionValue} rather than compiled to Lua and read back, so
 * there is no round trip through the plugin: it is the same field mapping
 * `compileScenario` renders, so it cannot structurally disagree with what a
 * launch would validate. And the run is debounced, because every keystroke in
 * the name field is a new document and validating each one would walk every
 * trigger in the mission.
 */

import { useEffect, useState } from "react";
import { scenarioMissionValue } from "../../compile";
import type { Scenario } from "../../model";
import {
  isBlocking,
  type MapExtent,
  type MissionIssue,
  validateMission,
} from "../../validate";

/**
 * How long an edit settles for before the mission is validated again. Long
 * enough that typing a name is one run rather than one per letter, short enough
 * that a count is there by the time an author looks up from the panel they were
 * editing.
 */
export const PROBLEM_DEBOUNCE_MS = 400;

/** What is wrong with a mission, split by whether it stops a launch. */
export interface MissionProblems {
  /** Issues that refuse the launch. See {@link isBlocking}. */
  blocking: MissionIssue[];
  /** Issues the mission plays with, and a player reads as a bug. */
  warnings: MissionIssue[];
}

const NONE: MissionProblems = { blocking: [], warnings: [] };

/**
 * Validate a scenario document as it stands, and split what came back.
 *
 * `map` and `units` are what the caller has been able to read, and both are
 * optional for the reason {@link validateMission} takes them that way: a read
 * still in flight drops one check rather than holding up the rest.
 */
export function missionProblemsIn(
  scenario: Scenario,
  map?: MapExtent,
  units?: { name: string }[],
): MissionProblems {
  const issues = validateMission(scenarioMissionValue(scenario), map, units);
  return {
    blocking: issues.filter(isBlocking),
    warnings: issues.filter((issue) => !isBlocking(issue)),
  };
}

/** Whether two runs found the same things, so the second can be thrown away. */
function same(a: MissionIssue[], b: MissionIssue[]): boolean {
  return (
    a.length === b.length &&
    a.every(
      (issue, i) =>
        issue.path === b[i].path &&
        issue.message === b[i].message &&
        issue.severity === b[i].severity,
    )
  );
}

/**
 * The problems in a scenario, kept up to date as it is edited.
 *
 * A run that finds what the last one found is dropped rather than stored, so an
 * edit that fixes nothing and breaks nothing does not re-render the header. That
 * also keeps a caller whose `units` list is a fresh array each render from
 * looping: it can schedule a run per render, but it cannot cause one.
 */
export function useMissionProblems(
  scenario: Scenario | null,
  map?: MapExtent,
  units?: { name: string }[],
  delay: number = PROBLEM_DEBOUNCE_MS,
): MissionProblems {
  const [problems, setProblems] = useState<MissionProblems>(NONE);

  useEffect(() => {
    if (!scenario) {
      setProblems((prev) => (prev === NONE ? prev : NONE));
      return;
    }
    const id = setTimeout(() => {
      const found = missionProblemsIn(scenario, map, units);
      setProblems((prev) =>
        same(prev.blocking, found.blocking) &&
        same(prev.warnings, found.warnings)
          ? prev
          : found,
      );
    }, delay);
    return () => clearTimeout(id);
  }, [scenario, map, units, delay]);

  return problems;
}

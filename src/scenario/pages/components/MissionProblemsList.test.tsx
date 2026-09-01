// @vitest-environment happy-dom
/**
 * Issue #2249. The header's problem count opens this list, so these sentences
 * are in front of the author all the time rather than only after a refused
 * launch. A sentence that names an id the author has never seen sends them
 * looking for a row that is not labelled that.
 *
 * The point of testing it here rather than only against `describeIssue` is the
 * wiring: the list has the document, and a list rendered without it would still
 * read as a perfectly good sentence about the wrong string.
 */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { starterScenario } from "../../create";
import type { Scenario } from "../../model";
import { MissionProblemsList } from "./MissionProblemsList";
import { missionProblemsIn } from "./useMissionProblems";

afterEach(cleanup);

/** The starter mission with its dialogue line deleted, so the trigger that
 *  plays it points at nothing. */
function brokenScenario(): Scenario {
  const scenario = starterScenario("Demo");
  return { ...scenario, dialogue: [] };
}

function show(scenario: Scenario) {
  render(
    <MissionProblemsList
      problems={missionProblemsIn(scenario)}
      scenario={scenario}
    />,
  );
}

describe("the problems in the mission being written", () => {
  it("names the trigger the way the trigger list does", () => {
    show(brokenScenario());

    expect(
      screen.getByText(
        'Trigger "Command calls in" (briefing), action 1, line: no dialogue line called "briefing"',
      ),
    ).toBeTruthy();
  });

  it("does not say the id twice for a trigger named after itself", () => {
    const scenario = brokenScenario();
    const [trigger] = scenario.triggers;
    show({
      ...scenario,
      triggers: [
        { ...trigger, name: trigger.id },
        ...scenario.triggers.slice(1),
      ],
    });

    expect(
      screen.getByText(
        'Trigger "briefing", action 1, line: no dialogue line called "briefing"',
      ),
    ).toBeTruthy();
  });

  it("says so when there is nothing wrong", () => {
    show(starterScenario("Demo"));

    expect(
      screen.getByText(/Every reference in this mission resolves/),
    ).toBeTruthy();
  });
});

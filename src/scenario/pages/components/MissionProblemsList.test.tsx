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

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { starterScenario } from "../../create";
import type { Scenario } from "../../model";
import type { MissionIssue } from "../../validate";
import { MissionProblemsList } from "./MissionProblemsList";
import { missionProblemsIn } from "./useMissionProblems";

afterEach(cleanup);

/** The starter mission with its dialogue line deleted, so the trigger that
 *  plays it points at nothing. */
function brokenScenario(): Scenario {
  const scenario = starterScenario("Demo");
  return { ...scenario, dialogue: [] };
}

function show(
  scenario: Scenario,
  onActivate: (issue: MissionIssue) => void = () => {},
) {
  render(
    <MissionProblemsList
      problems={missionProblemsIn(scenario)}
      scenario={scenario}
      onActivate={onActivate}
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

/**
 * Issue #2271. `problemTarget` decides which rows have somewhere to click
 * through to, and this is the wiring: a row it names a target for is a button
 * that hands the issue back, and a row it does not is left as the same plain
 * text the list always showed, so the two kinds of row are told apart by role
 * as well as by look.
 */
describe("activating a problem row", () => {
  it("is a button for a problem a panel owns, and calls onActivate with it", () => {
    const onActivate = vi.fn();
    show(brokenScenario(), onActivate);

    const row = screen.getByRole("button", {
      name: /no dialogue line called "briefing"/,
    });
    fireEvent.click(row);

    expect(onActivate).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        message: 'no dialogue line called "briefing"',
      }),
    );
  });

  /** A team with no engine team has no panel of its own: `setup.participants`
   *  is who has one, and `problemTarget` leaves `teams["…"]` unclaimed. */
  it("is plain text for a problem naming a team, which no panel owns", () => {
    const scenario: Scenario = {
      ...starterScenario("Demo"),
      teams: { ghost: {} },
    };
    show(scenario);

    const message = screen.getByText(/"ghost" has no engine team/);
    expect(message.closest("button")).toBeNull();
  });
});

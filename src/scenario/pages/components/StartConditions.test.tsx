// @vitest-environment happy-dom
/**
 * The accessible names start conditions builds by hand (issue #2283).
 *
 * The bank and income boxes are labelled by string concatenation rather than a
 * hardcoded string, so a participant called "You" turning into "You's bank
 * metal" is the kind of thing that regresses silently. This pins the built
 * name instead of the possessive it used to read.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useMemo, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Participant } from "@/play/participants";
import { newScenario } from "../../create";
import type { Scenario } from "../../model";
import { StartConditions } from "./StartConditions";
import { missionProblemsIn } from "./useMissionProblems";

vi.mock("@/content/useGameUnits", () => ({
  useGameUnits: () => ({ units: [], loading: false }),
}));

afterEach(cleanup);

function participant(id: string, name: string): Participant {
  return {
    id,
    kind: "ai",
    name,
    side: "",
    color: [1, 1, 1],
    allyTeam: 0,
    spectator: false,
  } as Participant;
}

/** A scenario the panel will draw a row for, which means one whose setup holds
 *  the participant: the panel reads them out of the document now that it is a
 *  panel of its own rather than a section of the setup one. */
function withParticipant(id: string, name: string): Scenario {
  const base = newScenario("Test");
  return {
    ...base,
    setup: { ...base.setup, participants: [participant(id, name)] },
  };
}

/** The panel starts shut, the way every panel on the edit page does. */
function open() {
  fireEvent.click(screen.getByRole("button", { name: /^Start conditions/ }));
}

describe("amount field names", () => {
  it("names the bank fields without a possessive", () => {
    render(
      <StartConditions
        scenario={withParticipant("player", "You")}
        issues={[]}
        onChange={() => {}}
      />,
    );
    open();

    expect(screen.getByLabelText("Bank metal for You")).toBeTruthy();
    expect(screen.getByLabelText("Bank energy for You")).toBeTruthy();
    expect(screen.queryByLabelText(/You's/)).toBeNull();
  });
});

/**
 * A team's start units naming a def the game has not got (issue #2346). The
 * issue comes from the real validator (`missionProblemsIn`), not a hand-built
 * one, so this is pinned against what the drawer would say too.
 */
describe("a team's start units the validator has flagged", () => {
  function withUnknownStartUnit(): Scenario {
    const base = withParticipant("player", "You");
    return {
      ...base,
      teams: { player: { startUnits: ["notaunit"] } },
    };
  }

  function StartUnitsHarness() {
    const [document] = useState<Scenario>(withUnknownStartUnit);
    const issues = useMemo(() => {
      const found = missionProblemsIn(document, undefined, [
        { name: "armcom" },
      ]);
      return [...found.blocking, ...found.warnings];
    }, [document]);

    return (
      <StartConditions
        scenario={document}
        issues={issues}
        onChange={() => {}}
      />
    );
  }

  it("says so under that team's start units, in the validator's own words", () => {
    render(<StartUnitsHarness />);
    open();

    expect(
      screen.getByText('no unit type called "notaunit" in the game'),
    ).toBeTruthy();
  });
});

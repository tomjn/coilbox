// @vitest-environment happy-dom
/**
 * The accessible names start conditions builds by hand (issue #2283).
 *
 * The bank and income boxes are labelled by string concatenation rather than a
 * hardcoded string, so a participant called "You" turning into "You's bank
 * metal" is the kind of thing that regresses silently. This pins the built
 * name instead of the possessive it used to read.
 */

import { cleanup, render, screen } from "@testing-library/react";
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

describe("amount field names", () => {
  it("names the bank fields without a possessive", () => {
    const scenario = newScenario("Test");
    const you = participant("player", "You");

    render(
      <StartConditions
        scenario={scenario}
        participants={[you]}
        issues={[]}
        onChange={() => {}}
      />,
    );

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
    const base = newScenario("Demo");
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
    const you = participant("player", "You");

    return (
      <StartConditions
        scenario={document}
        participants={[you]}
        issues={issues}
        onChange={() => {}}
      />
    );
  }

  it("says so under that team's start units, in the validator's own words", () => {
    render(<StartUnitsHarness />);

    expect(
      screen.getByText('no unit type called "notaunit" in the game'),
    ).toBeTruthy();
  });
});

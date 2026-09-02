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
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Participant } from "@/play/participants";
import { newScenario } from "../../create";
import { StartConditions } from "./StartConditions";

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
        onChange={() => {}}
      />,
    );

    expect(screen.getByLabelText("Bank metal for You")).toBeTruthy();
    expect(screen.getByLabelText("Bank energy for You")).toBeTruthy();
    expect(screen.queryByLabelText(/You's/)).toBeNull();
  });
});

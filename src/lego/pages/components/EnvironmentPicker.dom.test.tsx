// @vitest-environment happy-dom

/**
 * The ground picker's climbing line (issue #4128): the drawn slope against the
 * unit's movement class, and nothing at all for a unit that does not move.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_GROUND, type GroundChoice } from "../../environment";
import { EnvironmentPicker } from "./EnvironmentPicker";

const unitDefs = vi.fn();

vi.mock("./useTestGame", () => ({
  useTestGame: () => ({
    target: { enginePath: "/e", dataDir: "/d" },
    game: { primaryArchive: { name: "G.sdz" } },
  }),
}));
vi.mock("@/workshop/config", () => ({ useUnitDefs: () => unitDefs() }));

afterEach(() => {
  cleanup();
  unitDefs.mockReset();
});

function haveMoveDefs(moveDefs: unknown[]) {
  unitDefs.mockReturnValue({
    defs: { units: {}, moveDefs },
    defsFor: "G.sdz",
  });
}

function open(movement?: { moveClass: string }, degrees = 22.5) {
  const ground: GroundChoice = { ...DEFAULT_GROUND, id: "slope", degrees };
  render(
    <EnvironmentPicker
      backdrop="studio"
      onBackdrop={() => {}}
      ground={ground}
      onGround={() => {}}
      shape={{ kind: "slope", degrees }}
      movement={movement}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Backdrop and ground" }));
}

describe("EnvironmentPicker climbing line", () => {
  it("says a hover class with maxSlope 15 climbs 22.5 degrees", () => {
    haveMoveDefs([{ name: "HOVER2", maxslope: 15 }]);
    open({ moveClass: "HOVER2" }, 22.5);
    expect(screen.getByText(/HOVER2 can climb this/)).toBeTruthy();
  });

  it("says the unit cannot climb a steeper slope", () => {
    haveMoveDefs([{ name: "HOVER2", maxslope: 15 }]);
    open({ moveClass: "HOVER2" }, 30);
    expect(screen.getByText(/HOVER2 cannot climb this/)).toBeTruthy();
  });

  it("says the limit is unknown when the game's classes were not read", () => {
    unitDefs.mockReturnValue({ defs: null, defsFor: null });
    open({ moveClass: "TANK2" });
    expect(screen.getByText(/Climbing limit unknown/)).toBeTruthy();
  });

  it("says nothing about climbing for a unit that does not move", () => {
    haveMoveDefs([{ name: "HOVER2", maxslope: 15 }]);
    open(undefined);
    expect(screen.getByText("Angle (°)")).toBeTruthy();
    expect(screen.queryByText(/climb/i)).toBeNull();
  });
});

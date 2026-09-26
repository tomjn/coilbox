// @vitest-environment happy-dom
/**
 * Issue #3180. A rule whose result equals the game's value writes no
 * override, so `unitLedger.changes` never carries it. This page has to show
 * it anyway, with a working revert.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ChangeLedger } from "../../changeLedger";
import { EMPTY_EDITS } from "../../project";
import { setRelativeEdit } from "../../relativeEdits";
import { ChangesPanel } from "./ChangesPanel";

afterEach(cleanup);

const gameUnits = { armpw: { health: 20, speed: 2 } };

const draw = (ledger: ChangeLedger, onRevertField = vi.fn()) => {
  const edits = setRelativeEdit(
    EMPTY_EDITS,
    "armpw",
    "health",
    { factor: 1.01, offset: 0, rounding: { kind: "integer" } },
    20,
  );
  render(
    <MemoryRouter>
      <ChangesPanel
        projectId="p1"
        ledger={ledger}
        loading={false}
        error={null}
        gameUnits={gameUnits}
        units={gameUnits}
        clones={{}}
        overrides={edits.overrides}
        nameOf={(key) => key}
        picOf={() => undefined}
        picsPending={false}
        factionOf={() => undefined}
        relative={edits.relative}
        onRevertField={onRevertField}
      />
    </MemoryRouter>,
  );
  return onRevertField;
};

describe("a rule whose number equals the game's value", () => {
  it("shows up when the unit has no other traced change", () => {
    draw({ units: [], notes: [] });
    expect(screen.getByText("health")).toBeTruthy();
    expect(screen.getByText("Game: 20")).toBeTruthy();
    expect(screen.getByText("Project: 20")).toBeTruthy();
    expect(screen.getByText("Follows the game: +1% of 20 = 20")).toBeTruthy();
  });

  it("shows up alongside a unit's other traced changes", () => {
    draw({
      units: [
        {
          unit: "armpw",
          changes: [
            {
              description: "speed",
              fieldPath: "speed",
              files: [],
              tweakSlot: null,
              tweakMiss: null,
              uncompiledReason: null,
            },
          ],
        },
      ],
      notes: [],
    });
    expect(screen.getByText("speed")).toBeTruthy();
    expect(screen.getByText("health")).toBeTruthy();
  });

  it("reverts through the page's own path, clearing the rule too", () => {
    const onRevertField = draw({ units: [], notes: [] });
    fireEvent.click(
      screen.getByRole("button", { name: "Revert health to the game's value" }),
    );
    expect(onRevertField).toHaveBeenCalledWith("armpw", "health");
  });
});

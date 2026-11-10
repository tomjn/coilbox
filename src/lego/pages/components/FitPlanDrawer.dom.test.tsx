// @vitest-environment happy-dom

/**
 * Fitting a body plan to a unit's own pieces (#3261): pick a plan, then a
 * piece for each bone by selecting it, and see what the fit will replace and
 * leave out before it is made.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { BIPED } from "../../bodyPlans";
import { type LegoPiece, type LegoProject, newProject } from "../../model";
import type { PlanProposal } from "../../proposePlan";
import { WHEELED } from "../../vehiclePlans";
import { FitPlanDrawer } from "./FitPlanDrawer";

afterEach(cleanup);

function piece(
  id: string,
  parentId: string,
  extra: Partial<LegoPiece> = {},
): LegoPiece {
  return {
    id,
    name: id,
    parentId,
    partId: null,
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
    ...extra,
  };
}

function walker(): LegoProject {
  const base = newProject({
    id: "u",
    rootPieceId: "root",
    name: "Walker",
    packId: "p",
    packVersion: "1",
    now: "2026-10-17T00:00:00.000Z",
  });
  return {
    ...base,
    pieces: [
      base.pieces[0] as LegoPiece,
      piece("pelvis", "root"),
      piece("lthigh", "pelvis", { role: "turret" }),
      piece("lshin", "lthigh"),
    ],
  };
}

function show(selectedId: string | null = null) {
  const onFit = vi.fn();
  const onSelect = vi.fn();
  const onOpenChange = vi.fn();
  const props = {
    project: walker(),
    onFit,
    onSelect,
    onOpenChange,
  };
  const view = render(<FitPlanDrawer {...props} selectedId={selectedId} />);
  const select = (id: string | null) =>
    view.rerender(<FitPlanDrawer {...props} selectedId={id} />);
  return { onFit, onSelect, onOpenChange, select };
}

const row = (name: RegExp) => screen.getByRole("button", { name });

describe("FitPlanDrawer", () => {
  it("offers every body plan first", () => {
    show();
    expect(screen.getByRole("button", { name: /Two legs/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Wheels/ })).toBeTruthy();
  });

  it("fills the highlighted bone with the piece selected, then moves on", () => {
    const { select } = show();
    fireEvent.click(screen.getByRole("button", { name: /Two legs/ }));
    fireEvent.click(row(/^Front left thigh/));
    expect(row(/^Front left thigh/).getAttribute("aria-pressed")).toBe("true");

    select("lthigh");

    expect(row(/^Front left thigh/).textContent).toContain("lthigh");
    expect(row(/^Front left shin/).getAttribute("aria-pressed")).toBe("true");
  });

  it("moves a piece picked for a second bone off the first", () => {
    const { select } = show();
    fireEvent.click(screen.getByRole("button", { name: /Two legs/ }));
    fireEvent.click(row(/^Front left thigh/));
    select("lthigh");
    fireEvent.click(row(/^Front right thigh/));
    select("lshin");
    select("lthigh");

    expect(row(/^Front left thigh/).textContent).toContain("Unmatched");
  });

  it("offers a suggestion and takes it only when confirmed", () => {
    show();
    fireEvent.click(screen.getByRole("button", { name: /Two legs/ }));
    expect(row(/^base/).textContent).toContain("Unmatched");

    fireEvent.click(screen.getByRole("button", { name: "Use suggestions" }));

    expect(row(/^base/).textContent).not.toContain("Unmatched");
  });

  it("says which roles it replaces and which presets it cannot add", () => {
    const { select } = show();
    fireEvent.click(screen.getByRole("button", { name: /Two legs/ }));
    fireEvent.click(row(/^Front left thigh/));
    select("lthigh");

    expect(screen.getByText(/lthigh: Turret to Front left thigh/)).toBeTruthy();
    expect(screen.getByText(/Walk, two legs needs/)).toBeTruthy();
    expect(screen.getByText(/Not measured/)).toBeTruthy();
  });

  it("fits once with the picks and closes", () => {
    const { select, onFit, onOpenChange } = show();
    fireEvent.click(screen.getByRole("button", { name: /Two legs/ }));
    expect(
      (screen.getByRole("button", { name: "Fit" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    fireEvent.click(row(/^Front left thigh/));
    select("lthigh");

    fireEvent.click(screen.getByRole("button", { name: "Fit" }));

    expect(onFit).toHaveBeenCalledTimes(1);
    expect(onFit).toHaveBeenCalledWith(BIPED, {}, { "thigh.l1": "lthigh" });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("asks for a count before listing the bones it decides", () => {
    show();
    fireEvent.click(screen.getByRole("button", { name: /Wheels/ }));
    expect(screen.queryByRole("button", { name: /^rwheel3/ })).toBeNull();

    fireEvent.change(screen.getByLabelText("Axles"), {
      target: { value: "3" },
    });

    expect(row(/^rwheel3/)).toBeTruthy();
    expect(WHEELED.proportions[0]?.id).toBe("axles");
  });
  it("adds a gun and a build arm as the described plans do (#3263)", () => {
    const { select, onFit } = show();
    fireEvent.click(screen.getByRole("button", { name: /Wheels/ }));
    expect(screen.queryByRole("button", { name: /^Turret/ })).toBeNull();

    fireEvent.click(screen.getByRole("checkbox", { name: "Gun" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Builds" }));
    fireEvent.click(row(/^Turret/));
    select("lthigh");
    fireEvent.click(screen.getByRole("button", { name: "Fit" }));

    const [plan, , picks] = onFit.mock.calls[0] ?? [];
    expect(plan.id).toBe("wheeled+gun+build");
    expect(picks).toEqual({ turret: "lthigh" });
    expect(row(/^Build nozzle/)).toBeTruthy();
  });

  it("offers no second gun to a plan that has a turret", () => {
    show();
    fireEvent.click(screen.getByRole("button", { name: /^Turret building/ }));
    expect(screen.queryByRole("checkbox", { name: "Gun" })).toBeNull();
  });
});

describe("FitPlanDrawer with a proposal (#5185)", () => {
  const proposal: PlanProposal = {
    base: BIPED,
    groups: { weapon: false, builds: false },
    counts: {},
    picks: { base: "root", hip: "pelvis", "thigh.l1": "lthigh" },
    evidence: {
      base: { kind: "root" },
      hip: { kind: "hangsFrom", what: "legs" },
      "thigh.l1": {
        kind: "script",
        callin: "StartMoving",
        evidence: "observed",
      },
    },
    notes: [],
  };

  function proposed(given: PlanProposal) {
    const onFit = vi.fn();
    render(
      <FitPlanDrawer
        project={walker()}
        selectedId={null}
        onSelect={vi.fn()}
        onOpenChange={vi.fn()}
        onFit={onFit}
        proposal={given}
      />,
    );
    return { onFit };
  }

  it("opens on the proposed plan with its picks filled and their evidence", () => {
    proposed(proposal);
    expect(screen.getByRole("heading", { name: "Fit Two legs" })).toBeTruthy();
    const thigh = row(/^Front left thigh/);
    expect(thigh.textContent).toContain("lthigh");
    expect(thigh.textContent).toContain("Moved in StartMoving");
    expect(row(/^Body/).textContent).toContain("The legs hang from it");
    expect(row(/^base/).textContent).toContain("The unit's root piece");
    // The first bone the proposal left unmatched is highlighted.
    expect(row(/^torso/).getAttribute("aria-pressed")).toBe("true");
  });

  it("leaves every pick editable before Fit", () => {
    const { onFit } = proposed(proposal);
    fireEvent.click(
      screen.getByRole("button", { name: "Unmatch Front left thigh" }),
    );
    expect(row(/^Front left thigh/).textContent).toContain("Unmatched");
    expect(row(/^Front left thigh/).textContent).not.toContain("StartMoving");

    fireEvent.click(screen.getByRole("button", { name: "Fit" }));
    expect(onFit).toHaveBeenCalledWith(
      BIPED,
      {},
      { base: "root", hip: "pelvis" },
    );
  });

  it("says why no plan fits and offers every plan as before", () => {
    proposed({
      ...proposal,
      base: null,
      picks: {},
      evidence: {},
      notes: ["No plan, said plainly."],
    });
    expect(screen.getByText("No plan, said plainly.")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Two legs/ })).toBeTruthy();
  });
});

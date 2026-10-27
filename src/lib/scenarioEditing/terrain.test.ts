/**
 * Terrain step edits through the shared editing rules (issue #4793), run the
 * way the blueprint editor runs them: each one made to the document the layout
 * is placed in, with the editor's history keeping the way back.
 */

import { describe, expect, it } from "vitest";

import type { BaseBlueprint, TerrainStep } from "@/blueprint/model";
import { newStep } from "@/blueprint/terrainEdit";
import {
  BLUEPRINT_BASE_ID,
  blueprintDocument,
  documentLayout,
} from "@/placement/blueprintDocument";
import { applyLayoutEdit } from "@/placement/blueprintHistory";
import { placementKey } from "@/placement/placements";
import type { Scenario } from "@/scenario/model";
import { removePlacement } from "./editing";
import { type EditHistory, emptyHistory, redoEdit, undoEdit } from "./history";
import {
  addStep,
  addStepCorner,
  moveInBuildOrder,
  moveStep,
  moveStepCorner,
  removeStep,
  removeStepCorner,
  setStep,
} from "./terrain";

const ID = BLUEPRINT_BASE_ID;

const pad: TerrainStep = newStep("area", [
  { x: -64, z: -64 },
  { x: 64, z: -64 },
  { x: 64, z: 64 },
  { x: -64, z: 64 },
]);

const wallStep = (before = 0): TerrainStep => ({
  ...newStep("wall", [
    { x: -96, z: 96 },
    { x: 96, z: 96 },
  ]),
  before,
});

function layout(terrain?: TerrainStep[]): BaseBlueprint {
  return {
    id: "bp1",
    name: "Pad",
    buildings: [
      { def: "factorycloak", offset: { x: 0, z: 0 }, facing: 0 },
      { def: "staticmex", offset: { x: 160, z: 0 }, facing: 0 },
    ],
    ...(terrain ? { terrain } : {}),
  };
}

/** One edit made the way the editor makes it, and the layout back out. */
function edited(
  from: BaseBlueprint,
  edit: (doc: Scenario) => Scenario,
): BaseBlueprint {
  return documentLayout(edit(blueprintDocument(from, "Zero-K")), from);
}

describe("terrain step edits", () => {
  it("adds a step after the other steps and before every building", () => {
    let index = -1;
    const out = edited(layout([wallStep(1)]), (doc) => {
      const added = addStep(doc, ID, pad);
      index = added.index;
      return added.scenario;
    });
    expect(index).toBe(1);
    expect(out.terrain?.map((s) => s.kind)).toEqual(["raise", "level"]);
    expect(out.terrain?.map((s) => s.before)).toEqual([0, 0]);
  });

  it("makes a layout of steps alone", () => {
    const empty: BaseBlueprint = { id: "bp2", name: "Walls", buildings: [] };
    const out = edited(empty, (doc) => addStep(doc, ID, wallStep()).scenario);
    expect(out.buildings).toEqual([]);
    expect(out.terrain).toHaveLength(1);
  });

  it("moves a step, snapped to the grid", () => {
    const out = edited(layout([pad]), (doc) =>
      moveStep(doc, ID, 0, { x: 13, z: 0 }),
    );
    expect(out.terrain?.[0].points[0]).toEqual({ x: -48, z: -64 });
  });

  it("reshapes a step by a corner, and adds and removes corners", () => {
    const moved = edited(layout([pad]), (doc) =>
      moveStepCorner(doc, ID, 0, 2, { x: 32, z: 0 }),
    );
    expect(moved.terrain?.[0].points[2]).toEqual({ x: 96, z: 64 });

    const added = edited(layout([pad]), (doc) =>
      addStepCorner(doc, ID, 0, 0, { x: 0, z: -96 }),
    );
    expect(added.terrain?.[0].points).toHaveLength(5);
    expect(added.terrain?.[0].points[1]).toEqual({ x: 0, z: -96 });

    const removed = edited(layout([pad]), (doc) =>
      removeStepCorner(doc, ID, 0, 3),
    );
    expect(removed.terrain?.[0].points).toHaveLength(3);
  });

  it("changes height and kind, and only the fields the kind has", () => {
    const out = edited(layout([pad]), (doc) =>
      setStep(doc, ID, 0, { height: -24, kind: "raise", width: 80 }),
    );
    expect(out.terrain?.[0]).toMatchObject({ kind: "raise", height: -24 });
    expect(out.terrain?.[0].width).toBeUndefined();

    const ramp = newStep("ramp", [
      { x: 0, z: 0 },
      { x: 0, z: 128 },
    ]);
    const ramped = edited(layout([ramp]), (doc) =>
      setStep(doc, ID, 0, { heights: [8, 64], width: 96, kind: "level" }),
    );
    expect(ramped.terrain?.[0]).toMatchObject({
      kind: "ramp",
      heights: [8, 64],
      width: 96,
    });
  });

  it("deletes a step, and the field with the last one", () => {
    const out = edited(layout([pad]), (doc) => removeStep(doc, ID, 0));
    expect(out.terrain).toBeUndefined();
  });

  it("keeps the steps when the last building is deleted", () => {
    const one: BaseBlueprint = {
      ...layout([wallStep(1)]),
      buildings: [layout().buildings[0]],
    };
    const out = edited(one, (doc) =>
      removePlacement(doc, placementKey("base", ID, 0)),
    );
    expect(out.buildings).toEqual([]);
    expect(out.terrain).toEqual([{ ...wallStep(1), before: 0 }]);
  });

  it("moves steps among steps and buildings among buildings only", () => {
    let at = -1;
    const out = edited(layout([pad, wallStep(1)]), (doc) => {
      const moved = moveInBuildOrder(doc, ID, { kind: "step", index: 0 }, 1);
      at = moved.step;
      return moved.scenario;
    });
    expect(at).toBe(1);
    expect(out.terrain?.map((s) => s.kind)).toEqual(["raise", "level"]);
    // Every step is written back before every building (issue #4817).
    expect(out.terrain?.map((s) => s.before)).toEqual([0, 0]);

    const doc = blueprintDocument(layout([pad]), "Zero-K");
    expect(
      moveInBuildOrder(doc, ID, { kind: "step", index: 0 }, 1).scenario,
    ).toBe(doc);
    expect(
      moveInBuildOrder(doc, ID, { kind: "building", index: 0 }, -1).scenario,
    ).toBe(doc);

    const swapped = edited(
      layout(),
      (doc) =>
        moveInBuildOrder(doc, ID, { kind: "building", index: 0 }, 1).scenario,
    );
    expect(swapped.buildings.map((b) => b.def)).toEqual([
      "staticmex",
      "factorycloak",
    ]);
  });
});

describe("the game's limits", () => {
  it("refuses a wall of more than 700 points", () => {
    // Filled every 16 elmos, so 700 points is 11,184 elmos of wall.
    const long: TerrainStep = {
      ...wallStep(),
      points: [
        { x: 0, z: 0 },
        { x: 12000, z: 0 },
      ],
    };
    const doc = blueprintDocument(layout(), "Zero-K");
    expect(addStep(doc, ID, long)).toEqual({ scenario: doc, index: -1 });
  });

  it("refuses an area wider or deeper than 2,000 elmos", () => {
    const doc = blueprintDocument(layout([pad]), "Zero-K");
    expect(moveStepCorner(doc, ID, 0, 2, { x: 2100, z: 0 })).toBe(doc);
    expect(moveStepCorner(doc, ID, 0, 2, { x: 1800, z: 0 })).not.toBe(doc);
  });

  it("refuses an order of more than 2,500 points", () => {
    const many: TerrainStep = {
      ...pad,
      points: Array.from({ length: 2501 }, (_, i) => ({
        x: (i % 50) * 8,
        z: Math.floor(i / 50) * 8,
      })),
    };
    const doc = blueprintDocument(layout(), "Zero-K");
    expect(addStep(doc, ID, many).index).toBe(-1);
  });

  it("refuses a ramp shorter than the game allows", () => {
    const ramp = newStep("ramp", [
      { x: 0, z: 0 },
      { x: 0, z: 128 },
    ]);
    const doc = blueprintDocument(layout([ramp]), "Zero-K");
    expect(moveStepCorner(doc, ID, 0, 1, { x: 0, z: -96 })).toBe(doc);
    expect(setStep(doc, ID, 0, { width: 2000 })).toBe(doc);
  });
});

describe("undo and redo of terrain edits", () => {
  it("takes each edit back in one press and puts it back again", () => {
    let current = layout();
    let history: EditHistory<BaseBlueprint> = emptyHistory;
    const apply = (edit: (doc: Scenario) => Scenario) => {
      const applied = applyLayoutEdit(current, history, "Zero-K", edit);
      current = applied.layout;
      history = applied.history;
    };

    apply((doc) => addStep(doc, ID, pad).scenario);
    apply((doc) => setStep(doc, ID, 0, { height: 16 }));
    apply((doc) => moveStep(doc, ID, 0, { x: 32, z: 0 }));
    const done = current;

    const back = undoEdit(history, current);
    expect(back?.document.terrain?.[0].points[0]).toEqual({ x: -64, z: -64 });
    if (!back) return;
    const again = redoEdit(back.history, back.document);
    expect(again?.document).toEqual(done);

    let unwound = { history, document: current };
    for (let i = 0; i < 3; i++) {
      const step = undoEdit(unwound.history, unwound.document);
      if (!step) break;
      unwound = step;
    }
    expect(unwound.document.terrain).toBeUndefined();
  });
});

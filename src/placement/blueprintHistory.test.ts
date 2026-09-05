/**
 * Undo in the standalone blueprint editor (issue #1442).
 *
 * The funnel is run here exactly as the editor runs it: a layout held as it
 * stands, every edit made to the document it is placed in, and the layout that
 * comes back out handed on. What that proves is that a step back is a step back
 * in the layout, not in some document beside it.
 *
 * The echo is the other half. The library saves on every change and hands the
 * saved layout back down, so every entry in the history has been through a round
 * trip by the time it is undone to. Entries are values rather than the objects
 * the editor made, and these run with an echo that copies to prove it.
 */

import { describe, expect, it } from "vitest";

import type { BaseBlueprint } from "@/blueprint/model";
import { renameBlueprint } from "@/lib/scenarioEditing/bases";
import {
  movePlacement,
  removePlacement,
  turnPlacement,
} from "@/lib/scenarioEditing/editing";
import type { Scenario } from "@/scenario/model";
import {
  type EditHistory,
  emptyHistory,
  redoEdit,
  undoEdit,
} from "@/scenario/pages/components/history";
import { BLUEPRINT_BASE_ID } from "./blueprintDocument";
import { applyLayoutEdit } from "./blueprintHistory";
import { placementKey } from "./placements";

const GAME = "Game";

/** A layout of two buildings, which is enough to move one and still have one
 *  that should not move. */
function layout(): BaseBlueprint {
  return {
    id: "bp1",
    name: "Opening",
    buildings: [
      { def: "armsolar", offset: { x: -64, z: 0 }, facing: 0 },
      { def: "armlab", offset: { x: 32, z: 0 }, facing: 0 },
    ],
  };
}

/** The key the surface names a building by. */
const at = (index: number) => placementKey("base", BLUEPRINT_BASE_ID, index);

/** What a save and a re-render hands back: the same layout, none of the same
 *  objects. */
const echo = (blueprint: BaseBlueprint): BaseBlueprint =>
  JSON.parse(JSON.stringify(blueprint));

/**
 * The editor's funnel, as the component runs it, with the layout going out
 * through `onChange` and coming back in as a prop each time.
 */
function editor(from: BaseBlueprint) {
  let current = from;
  let history: EditHistory<BaseBlueprint> = emptyHistory;
  return {
    apply(edit: (doc: Scenario) => Scenario) {
      const applied = applyLayoutEdit(current, history, GAME, edit);
      history = applied.history;
      current = echo(applied.layout);
    },
    undo(): boolean {
      const step = undoEdit(history, current);
      if (!step) return false;
      history = step.history;
      current = echo(step.document);
      return true;
    },
    redo(): boolean {
      const step = redoEdit(history, current);
      if (!step) return false;
      history = step.history;
      current = echo(step.document);
      return true;
    },
    get layout() {
      return current;
    },
    get history() {
      return history;
    },
  };
}

describe("undo in the blueprint editor", () => {
  it("has nowhere to go on a layout just opened", () => {
    expect(editor(layout()).undo()).toBe(false);
    expect(editor(layout()).redo()).toBe(false);
  });

  /**
   * The pointer layer moves the drawn objects during a gesture and calls
   * `onMove` once, on release, so one drag reaches the funnel once. This is that
   * one call: one step back, and it puts the building where it was picked up
   * from rather than part way along.
   */
  it("takes a drag back in one press", () => {
    const editing = editor(layout());
    editing.apply((doc) => movePlacement(doc, at(1), { x: 300, z: 200 }));

    expect(editing.layout.buildings[1].offset).toEqual({ x: 332, z: 200 });
    expect(editing.history.past).toHaveLength(1);

    expect(editing.undo()).toBe(true);
    expect(editing.layout.buildings[1].offset).toEqual({ x: 32, z: 0 });
    expect(editing.layout.buildings[0].offset).toEqual({ x: -64, z: 0 });
    expect(editing.undo()).toBe(false);
  });

  it("puts a deleted building back where it was", () => {
    const editing = editor(layout());
    editing.apply((doc) => removePlacement(doc, at(0)));
    expect(editing.layout.buildings.map((b) => b.def)).toEqual(["armlab"]);

    editing.undo();
    expect(editing.layout.buildings.map((b) => b.def)).toEqual([
      "armsolar",
      "armlab",
    ]);
  });

  /** Deleting the last building empties the layout rather than deleting it, so
   *  undoing that has a layout to come back to. */
  it("comes back from a layout emptied to nothing", () => {
    const editing = editor(layout());
    editing.apply((doc) => removePlacement(doc, at(0)));
    editing.apply((doc) => removePlacement(doc, at(0)));
    expect(editing.layout.buildings).toHaveLength(0);
    expect(editing.layout.name).toBe("Opening");

    editing.undo();
    editing.undo();
    expect(editing.layout).toEqual(layout());
  });

  it("goes forward again to exactly what was undone", () => {
    const editing = editor(layout());
    editing.apply((doc) => turnPlacement(doc, at(1), 1));
    const turned = editing.layout;

    editing.undo();
    expect(editing.layout.buildings[1].facing).toBe(0);
    expect(editing.redo()).toBe(true);
    expect(editing.layout).toEqual(turned);
    expect(editing.redo()).toBe(false);
  });

  it("drops the way forward once a new edit is made", () => {
    const editing = editor(layout());
    editing.apply((doc) => removePlacement(doc, at(0)));
    editing.undo();
    editing.apply((doc) => turnPlacement(doc, at(0), 1));

    expect(editing.redo()).toBe(false);
    expect(editing.layout.buildings).toHaveLength(2);
  });

  it("records nothing for an edit that changed nothing", () => {
    const editing = editor(layout());
    editing.apply((doc) => movePlacement(doc, "base:nobody#0", { x: 5, z: 5 }));

    expect(editing.history.past).toHaveLength(0);
    expect(editing.undo()).toBe(false);
  });

  /**
   * A rename is an edit like any other, which is why it has to come through
   * here (issue #1454). Renamed outside the funnel it is not a step, so taking
   * back the drag before it hands back a layout carrying the old name.
   */
  it("keeps a rename when an edit made before it is taken back", () => {
    const editing = editor(layout());
    editing.apply((doc) => renameBlueprint(doc, BLUEPRINT_BASE_ID, "Wall"));
    editing.apply((doc) => movePlacement(doc, at(1), { x: 300, z: 0 }));

    editing.undo();
    expect(editing.layout.buildings[1].offset).toEqual({ x: 32, z: 0 });
    expect(editing.layout.name).toBe("Wall");
  });

  it("walks a run of edits back in the order they were made", () => {
    const editing = editor(layout());
    editing.apply((doc) => turnPlacement(doc, at(0), 1));
    editing.apply((doc) => movePlacement(doc, at(0), { x: 100, z: 0 }));
    editing.apply((doc) => removePlacement(doc, at(1)));

    editing.undo();
    expect(editing.layout.buildings).toHaveLength(2);
    editing.undo();
    expect(editing.layout.buildings[0].offset).toEqual({ x: -64, z: 0 });
    editing.undo();
    expect(editing.layout).toEqual(layout());
  });
});

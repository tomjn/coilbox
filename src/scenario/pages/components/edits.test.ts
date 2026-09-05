import { describe, expect, it } from "vitest";
import { addBase, removeBase } from "@/lib/scenarioEditing/bases";
import type { Point, Scenario } from "../../model";
import { addActor } from "./editing";
import { applyEdit } from "./edits";
import { type EditHistory, emptyHistory, undoEdit } from "./history";

function scenario(): Scenario {
  return {
    schemaVersion: 2,
    id: "s1",
    name: "Test",
    description: "",
    runtimeVersion: 1,
    setup: {
      participants: [],
      gameName: "Game",
      mapName: "Map",
      startPosType: 0,
      modOptionValues: {},
    },
    teams: {},
    zones: [],
    actors: [],
    groups: [],
    blueprints: [],
    bases: [],
    restrictions: {},
    vars: {},
    triggers: [],
    objectives: [],
    dialogue: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

/**
 * The editor's funnel, as the page runs it: a document held as it stands, and
 * every edit applied to that rather than to whatever was last rendered.
 */
function editor(from: Scenario) {
  let document = from;
  let history: EditHistory<Scenario> = emptyHistory;
  return {
    apply(edit: Parameters<typeof applyEdit>[2]) {
      const applied = applyEdit(document, history, edit);
      document = applied.document;
      history = applied.history;
    },
    undo() {
      const step = undoEdit(history, document);
      if (!step) return;
      document = step.document;
      history = step.history;
    },
    get document() {
      return document;
    },
    get history() {
      return history;
    },
  };
}

/** Placing an actor, as a mode does it. */
const place = (id: string, pos: Point) => (doc: Scenario) =>
  addActor(doc, id, { unitDef: "armpw", team: "you", pos, facing: 0 });

describe("applyEdit", () => {
  it("keeps both of two placements made before a re-render", () => {
    const rendered = scenario();
    const editing = editor(rendered);

    // Both clicks are handled with `rendered` on screen: the second one has no
    // more idea the first happened than a mode resolved in the same render did.
    editing.apply(place("a", { x: 10, z: 10 }));
    editing.apply(place("b", { x: 20, z: 20 }));

    expect(editing.document.actors.map((actor) => actor.id)).toEqual([
      "a",
      "b",
    ]);
  });

  it("makes two placements two steps back", () => {
    const editing = editor(scenario());
    editing.apply(place("a", { x: 10, z: 10 }));
    editing.apply(place("b", { x: 20, z: 20 }));

    expect(editing.history.past).toHaveLength(2);
    expect(editing.history.past.at(-1)?.actors).toHaveLength(1);
    expect(editing.history.past[0].actors).toHaveLength(0);
  });

  it("takes a finished document, which is what a panel hands back", () => {
    const editing = editor(scenario());
    const renamed = { ...editing.document, name: "Renamed" };
    editing.apply(renamed);

    expect(editing.document.name).toBe("Renamed");
    expect(editing.history.past).toHaveLength(1);
  });

  /** A base and its layout are two registries, so undoing a delete could put a
   *  second copy of the layout back beside the one the delete left (#1424). */
  it("puts a deleted base back beside the layout it was placed from", () => {
    const editing = editor(scenario());
    editing.apply((doc) =>
      addBase(doc, "b1", "bp1", {
        team: "you",
        origin: { x: 100, z: 100 },
        buildings: [{ def: "armlab", offset: { x: 0, z: 0 }, facing: 0 }],
      }),
    );
    editing.apply((doc) => removeBase(doc, "b1"));
    expect(editing.document.blueprints).toHaveLength(1);

    editing.undo();
    expect(editing.document.blueprints.map((b) => b.id)).toEqual(["bp1"]);
    expect(editing.document.bases.map((b) => b.id)).toEqual(["b1"]);
  });

  it("records nothing for an edit that changed nothing", () => {
    const editing = editor(scenario());
    editing.apply((doc) => doc);

    expect(editing.history.past).toHaveLength(0);
  });
});

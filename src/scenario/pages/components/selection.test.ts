import { describe, expect, it } from "vitest";
import { BUILD_SQUARE } from "@/blueprint/footprint";
import { newScenario } from "../../create";
import type { Scenario } from "../../model";
import { sceneContents } from "./contents";
import { recordEdit, undoEdit } from "./history";
import { scenarioPlacements } from "./placements";
import {
  addKeys,
  boxFromDrag,
  countWords,
  entryKeys,
  inBox,
  inSelection,
  keysInBox,
  movedKeys,
  moveSelection,
  primaryKey,
  removalOrder,
  removeSelection,
  selectionCountWords,
  selectOne,
  stillThere,
  toggleKey,
  turnSelection,
} from "./selection";

/** How an edit to a base is written in these tests: this base's own layout,
 *  which is what every one of them places from. */
const own = () => "own" as const;

/**
 * A document with one of everything a selection can hold, so a mixed selection
 * has something of each kind to be mixed out of: an actor, a group of three
 * units, a base of three buildings and a zone.
 */
function document(): Scenario {
  return {
    ...newScenario("test"),
    actors: [
      {
        id: "a1",
        unitDef: "armpw",
        team: "p0",
        pos: { x: 100, z: 100 },
        facing: 0,
      },
      {
        id: "a2",
        unitDef: "armpw",
        team: "p0",
        pos: { x: 200, z: 100 },
        facing: 1,
      },
    ],
    groups: [
      {
        id: "g1",
        team: "p1",
        units: [
          { def: "armpw", count: 2 },
          { def: "armrock", count: 1 },
        ],
        pos: { x: 1000, z: 1000 },
        orders: [],
        dormant: false,
      },
    ],
    blueprints: [
      {
        id: "bp1",
        name: "The keep",
        buildings: [
          { def: "armsolar", offset: { x: 0, z: 0 }, facing: 0 },
          { def: "armllt", offset: { x: 64, z: 0 }, facing: 1 },
          { def: "armllt", offset: { x: 128, z: 0 }, facing: 2 },
        ],
      },
    ],
    bases: [
      {
        id: "b1",
        blueprint: "bp1",
        team: "p1",
        origin: { x: 2000, z: 2000 },
        buildings: [],
      },
    ],
    zones: [
      {
        id: "z1",
        name: "Landing",
        shape: "box",
        min: { x: 3000, z: 3000 },
        max: { x: 3400, z: 3400 },
      },
    ],
  };
}

/** An actor, a whole group, one of a base's buildings and a zone: the mixed
 *  selection every rule below is pinned against. */
const MIXED = [
  "actor:a1",
  "group:g1#0",
  "group:g1#1",
  "group:g1#2",
  "base:b1#1",
  "zone:z1",
];

describe("the selection as a set", () => {
  it("calls the last one chosen the primary, which is what the bars describe", () => {
    expect(primaryKey(["actor:a1", "base:b1#0"])).toBe("base:b1#0");
    expect(primaryKey([])).toBeNull();
  });

  it("replaces the selection on a plain click", () => {
    expect(selectOne("actor:a2")).toEqual(["actor:a2"]);
    expect(selectOne(null)).toEqual([]);
  });

  it("adds on a shift-click and makes what was clicked the primary", () => {
    const next = toggleKey(["actor:a1"], "base:b1#0");
    expect(next).toEqual(["actor:a1", "base:b1#0"]);
    expect(primaryKey(next)).toBe("base:b1#0");
  });

  it("takes away on a second shift-click, leaving the rest selected", () => {
    const next = toggleKey(["actor:a1", "base:b1#0"], "base:b1#0");
    expect(next).toEqual(["actor:a1"]);
    expect(primaryKey(next)).toBe("actor:a1");
  });

  it("keeps the order a selection was built in when more is added to it", () => {
    expect(addKeys(["actor:a1"], ["base:b1#0", "actor:a1", "zone:z1"])).toEqual(
      ["actor:a1", "base:b1#0", "zone:z1"],
    );
  });

  it("answers whether a key is in it", () => {
    expect(inSelection(["actor:a1"], "actor:a1")).toBe(true);
    expect(inSelection(["actor:a1"], "actor:a2")).toBe(false);
    expect(inSelection(["actor:a1"], null)).toBe(false);
  });

  it("drops what the document no longer holds, so a delete strands nothing", () => {
    const doc = document();
    const after = removeSelection(doc, ["actor:a1"], own);
    expect(stillThere(MIXED, scenarioPlacements(after), after)).not.toContain(
      "actor:a1",
    );
    expect(stillThere(MIXED, scenarioPlacements(after), after)).toContain(
      "zone:z1",
    );
  });

  it("drops a zone that has gone", () => {
    const doc = document();
    const gone = { ...doc, zones: [] };
    expect(stillThere(["zone:z1"], scenarioPlacements(gone), gone)).toEqual([]);
  });
});

describe("a marquee", () => {
  const placements = scenarioPlacements(document());

  it("covers the ground between the two corners, whichever way it was dragged", () => {
    const forwards = boxFromDrag({ x: 10, z: 20 }, { x: 90, z: 80 });
    const backwards = boxFromDrag({ x: 90, z: 80 }, { x: 10, z: 20 });
    expect(forwards).toEqual({ minX: 10, maxX: 90, minZ: 20, maxZ: 80 });
    expect(backwards).toEqual(forwards);
  });

  it("counts the edges as inside", () => {
    const box = boxFromDrag({ x: 0, z: 0 }, { x: 100, z: 100 });
    expect(inBox(box, { x: 100, z: 100 })).toBe(true);
    expect(inBox(box, { x: 101, z: 100 })).toBe(false);
  });

  it("takes every unit standing in it and nothing outside it", () => {
    const box = boxFromDrag({ x: 0, z: 0 }, { x: 150, z: 150 });
    expect(keysInBox(placements, box)).toEqual(["actor:a1"]);
  });

  it("takes a whole group when the box is round all of it", () => {
    const box = boxFromDrag({ x: 800, z: 800 }, { x: 1200, z: 1200 });
    expect(keysInBox(placements, box)).toEqual([
      "group:g1#0",
      "group:g1#1",
      "group:g1#2",
    ]);
  });

  it("takes nothing from empty ground", () => {
    expect(
      keysInBox(
        placements,
        boxFromDrag({ x: 9000, z: 9000 }, { x: 9500, z: 9500 }),
      ),
    ).toEqual([]);
  });
});

describe("what a contents row stands for", () => {
  const doc = document();
  const entries = sceneContents(doc);
  const entryFor = (kind: string) =>
    entries.find((one) => one.kind === kind) as (typeof entries)[number];

  it("adds a whole base, not just its first building", () => {
    expect(entryKeys(doc, entryFor("base"))).toEqual([
      "base:b1#0",
      "base:b1#1",
      "base:b1#2",
    ]);
  });

  it("adds all of a group's units, so deleting the row deletes the group", () => {
    expect(entryKeys(doc, entryFor("group"))).toEqual([
      "group:g1#0",
      "group:g1#1",
      "group:g1#2",
    ]);
  });

  it("adds an actor and a zone as themselves", () => {
    expect(entryKeys(doc, entryFor("actor"))).toEqual(["actor:a1"]);
    expect(entryKeys(doc, entryFor("zone"))).toEqual(["zone:z1"]);
  });
});

describe("moving a mixed selection", () => {
  it("moves a group once however many of its units are selected", () => {
    expect(movedKeys(MIXED)).toEqual([
      "actor:a1",
      "group:g1#0",
      "base:b1#1",
      "zone:z1",
    ]);
  });

  it("carries the actor, the group, the building and the zone by the same amount", () => {
    const doc = document();
    const after = moveSelection(doc, MIXED, { x: 100, z: 0 }, undefined, own);
    expect(after.actors[0].pos).toEqual({ x: 200, z: 100 });
    expect(after.groups[0].pos).toEqual({ x: 1100, z: 1000 });
    expect(after.blueprints[0].buildings[1].offset).toEqual({ x: 164, z: 0 });
    expect(after.zones[0]).toMatchObject({
      min: { x: 3100, z: 3000 },
      max: { x: 3500, z: 3400 },
    });
  });

  it("leaves the actor that was not selected where it was", () => {
    const doc = document();
    const after = moveSelection(doc, MIXED, { x: 100, z: 0 }, undefined, own);
    expect(after.actors[1].pos).toEqual({ x: 200, z: 100 });
  });

  it("does not carry a group three times for its three units", () => {
    const doc = document();
    const once = moveSelection(
      doc,
      ["group:g1#0"],
      { x: 64, z: 0 },
      undefined,
      own,
    );
    const thrice = moveSelection(
      doc,
      ["group:g1#0", "group:g1#1", "group:g1#2"],
      { x: 64, z: 0 },
      undefined,
      own,
    );
    expect(thrice.groups[0].pos).toEqual(once.groups[0].pos);
  });

  it("moves two buildings of one base by the same amount each", () => {
    const doc = document();
    const after = moveSelection(
      doc,
      ["base:b1#0", "base:b1#2"],
      { x: 0, z: BUILD_SQUARE },
      undefined,
      own,
    );
    const buildings = after.blueprints[0].buildings;
    expect(buildings[0].offset).toEqual({ x: 0, z: BUILD_SQUARE });
    expect(buildings[1].offset).toEqual({ x: 64, z: 0 });
    expect(buildings[2].offset).toEqual({ x: 128, z: BUILD_SQUARE });
  });
});

describe("turning a mixed selection", () => {
  it("turns each thing about its own centre and leaves positions alone", () => {
    const doc = document();
    const after = turnSelection(doc, MIXED, 1, own);
    expect(after.actors[0].facing).toBe(1);
    expect(after.blueprints[0].buildings[1].facing).toBe(2);
    expect(after.blueprints[0].buildings[1].offset).toEqual({ x: 64, z: 0 });
    expect(after.actors[0].pos).toEqual(doc.actors[0].pos);
  });

  it("leaves what has no facing alone: a group, a zone", () => {
    const doc = document();
    const after = turnSelection(doc, MIXED, 1, own);
    expect(after.groups[0]).toEqual(doc.groups[0]);
    expect(after.zones[0]).toEqual(doc.zones[0]);
  });

  it("puts a full circle back where it started", () => {
    const doc = document();
    let after = doc;
    for (let turn = 0; turn < 4; turn++)
      after = turnSelection(after, MIXED, 1, own);
    expect(after.actors[0]).toEqual(doc.actors[0]);
    expect(after.blueprints[0].buildings).toEqual(doc.blueprints[0].buildings);
  });
});

describe("deleting a mixed selection", () => {
  it("works through an entry highest index first, so nothing is renumbered under it", () => {
    expect(removalOrder(["base:b1#0", "base:b1#2", "base:b1#1"])).toEqual([
      "base:b1#2",
      "base:b1#1",
      "base:b1#0",
    ]);
  });

  it("keeps entries in the order they were selected", () => {
    expect(
      removalOrder(["actor:a1", "base:b1#0", "base:b1#1", "zone:z1"]),
    ).toEqual(["actor:a1", "base:b1#1", "base:b1#0", "zone:z1"]);
  });

  it("removes the buildings that were selected and not the one that was not", () => {
    const doc = document();
    const after = removeSelection(doc, ["base:b1#0", "base:b1#2"], own);
    expect(after.blueprints[0].buildings.map((one) => one.def)).toEqual([
      "armllt",
    ]);
    expect(after.blueprints[0].buildings[0].offset).toEqual({ x: 64, z: 0 });
  });

  it("removes the actor, the whole group, the building and the zone", () => {
    const doc = document();
    const after = removeSelection(doc, MIXED, own);
    expect(after.actors.map((one) => one.id)).toEqual(["a2"]);
    expect(after.groups).toEqual([]);
    expect(after.blueprints[0].buildings.map((one) => one.def)).toEqual([
      "armsolar",
      "armllt",
    ]);
    expect(after.zones).toEqual([]);
  });

  it("takes the base with its last building", () => {
    const doc = document();
    const after = removeSelection(
      doc,
      ["base:b1#0", "base:b1#1", "base:b1#2"],
      own,
    );
    expect(after.bases).toEqual([]);
  });
});

describe("one undo for a whole multi-selection edit", () => {
  /** The one funnel every change goes through, as `ScenarioEditPage` runs it:
   *  the document before the edit is what a step back hands over. */
  function applied(doc: Scenario, next: Scenario) {
    return { history: recordEdit({ past: [], future: [] }, doc, next), next };
  }

  it("puts every deleted thing back in one step", () => {
    const doc = document();
    const { history, next } = applied(doc, removeSelection(doc, MIXED, own));
    const back = undoEdit(history, next);
    expect(back?.document).toEqual(doc);
    expect(back?.history.past).toEqual([]);
  });

  it("puts every moved thing back in one step", () => {
    const doc = document();
    const { history, next } = applied(
      doc,
      moveSelection(doc, MIXED, { x: 64, z: 64 }, undefined, own),
    );
    const back = undoEdit(history, next);
    expect(back?.document).toEqual(doc);
    expect(back?.history.past).toEqual([]);
  });

  it("puts every turned thing back in one step", () => {
    const doc = document();
    const { history, next } = applied(doc, turnSelection(doc, MIXED, 1, own));
    const back = undoEdit(history, next);
    expect(back?.document).toEqual(doc);
    expect(back?.history.past).toEqual([]);
  });
});

describe("what a selection is called out loud", () => {
  it("says nothing is selected when nothing is", () => {
    expect(selectionCountWords([])).toBe("Nothing selected.");
  });

  it("names one thing without a count in front of it", () => {
    expect(selectionCountWords(["actor:a1"])).toBe("1 actor selected.");
  });

  it("leads with the total and then the shape of it", () => {
    expect(selectionCountWords(MIXED)).toBe(
      "4 selected: 1 actor, 1 group, 1 base building and 1 zone.",
    );
  });

  it("counts a group once however many of its units are in", () => {
    expect(countWords(["group:g1#0", "group:g1#1", "group:g1#2"])).toBe(
      "1 group",
    );
  });

  it("counts a base's buildings one by one, because each is placed on its own", () => {
    expect(countWords(["base:b1#0", "base:b1#1"])).toBe("2 base buildings");
  });

  it("says nothing at all about an empty selection, leaving the sentence to the caller", () => {
    expect(countWords([])).toBe("");
  });
});

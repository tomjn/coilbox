import { describe, expect, it } from "vitest";
import type { BaseBlueprint } from "@/blueprint/model";
import type { UnitDatasetEntry } from "@/content/bindings";
import { newScenario } from "../../create";
import { baseBuildings, type Scenario, type ScenarioBase } from "../../model";
import {
  addBase,
  addBuilding,
  buildableBy,
  buildingUnits,
  editBase,
  movedQueued,
  normaliseQueue,
  plusQueued,
  removeBase,
  removeBuilding,
  setOrigin,
  setQueue,
  strayDefs,
  withoutQueued,
} from "./bases";

const layout: BaseBlueprint = {
  id: "bp1",
  name: "The keep",
  buildings: [
    { def: "armlab", offset: { x: 0, z: 0 }, facing: 0 },
    { def: "armsolar", offset: { x: 128, z: 64 }, facing: 1 },
  ],
};

const base: ScenarioBase = {
  id: "b1",
  blueprint: "bp1",
  team: "p1",
  origin: { x: 1000, z: 2000 },
  buildings: [],
};

function document(): Scenario {
  return {
    ...newScenario("test"),
    blueprints: [structuredClone(layout)],
    bases: [structuredClone(base)],
  };
}

/** What a base is made of, which is the two halves read together. */
const buildingsOf = (scenario: Scenario, id = "b1") =>
  baseBuildings(
    scenario.blueprints,
    scenario.bases.find((b) => b.id === id) as ScenarioBase,
  );

const units: UnitDatasetEntry[] = [
  {
    name: "armlab",
    fullName: "Bot Lab",
    mobile: false,
    buildOptions: ["armpw", "armck"],
  },
  { name: "armsolar", fullName: "Solar Collector", mobile: false },
  { name: "armpw", fullName: "Pawn", mobile: true },
  { name: "armck", fullName: "Construction Bot", mobile: true },
];

describe("adding a base", () => {
  it("rounds the origin and every offset", () => {
    const next = addBase(newScenario("test"), "b2", "bp2", {
      team: "p0",
      origin: { x: 10.6, z: 20.2 },
      buildings: [{ def: "armsolar", offset: { x: 3.7, z: -1.2 }, facing: 2 }],
    });
    expect(next.bases[0].origin).toEqual({ x: 11, z: 20 });
    expect(next.blueprints[0].buildings[0].offset).toEqual({ x: 4, z: -1 });
  });

  /** The point of the split: what is put down is a layout plus a placement of
   *  it, so the layout is already the thing a later issue can save and reuse. */
  it("writes the layout and the placement that names it", () => {
    const next = addBase(newScenario("test"), "b2", "bp2", {
      team: "p0",
      origin: { x: 10, z: 20 },
      buildings: [
        { id: "lab", def: "armlab", offset: { x: 0, z: 0 }, facing: 0 },
      ],
    });
    expect(next.blueprints[0].buildings).toEqual([
      { def: "armlab", offset: { x: 0, z: 0 }, facing: 0 },
    ]);
    expect(next.bases[0].blueprint).toBe("bp2");
    expect(next.bases[0].buildings).toEqual([{ id: "lab" }]);
  });
});

describe("adding a building", () => {
  it("appends it to the layout with a rounded offset", () => {
    const next = addBuilding(document(), "b1", {
      def: "armwin",
      offset: { x: -63.5, z: 12.4 },
      facing: 3,
    });
    expect(next.blueprints[0].buildings).toHaveLength(3);
    expect(next.blueprints[0].buildings[2]).toEqual({
      def: "armwin",
      offset: { x: -63, z: 12 },
      facing: 3,
    });
  });

  /** The two lists are read by position, so an id landing on the wrong building
   *  is how a trigger ends up watching the wrong thing. */
  it("lines a new building's own fields up with the layout", () => {
    const next = addBuilding(document(), "b1", {
      id: "third",
      def: "armwin",
      offset: { x: 0, z: 0 },
      facing: 0,
    });
    expect(next.bases[0].buildings).toEqual([{}, {}, { id: "third" }]);
    expect(buildingsOf(next).map((b) => b.id)).toEqual([
      undefined,
      undefined,
      "third",
    ]);
  });

  it("hands the same document back when no base has that id", () => {
    const before = document();
    const after = addBuilding(before, "nope", {
      def: "armwin",
      offset: { x: 0, z: 0 },
      facing: 0,
    });
    expect(after).toBe(before);
  });
});

describe("moving a base", () => {
  it("puts the origin on the point and leaves the offsets alone", () => {
    const next = setOrigin(document(), "b1", { x: 500.4, z: 600.6 });
    expect(next.bases[0].origin).toEqual({ x: 500, z: 601 });
    expect(next.blueprints[0].buildings[1].offset).toEqual({ x: 128, z: 64 });
  });

  it("hands the same document back when no base has that id", () => {
    const before = document();
    expect(setOrigin(before, "nope", { x: 0, z: 0 })).toBe(before);
  });
});

describe("the base itself", () => {
  it("changes the team", () => {
    expect(editBase(document(), "b1", { team: "p2" }).bases[0].team).toBe("p2");
  });

  it("removes the whole base, and the layout nothing places any more", () => {
    const next = removeBase(document(), "b1");
    expect(next.bases).toEqual([]);
    expect(next.blueprints).toEqual([]);
  });

  it("hands the same document back when removing one that is not there", () => {
    const before = document();
    expect(removeBase(before, "nope")).toBe(before);
  });
});

describe("removing a building", () => {
  it("takes it out of both halves at once", () => {
    const withIds = setQueue(document(), "b1", 1, ["armpw"], false);
    const next = removeBuilding(withIds, "b1", 0);
    expect(next.blueprints[0].buildings.map((b) => b.def)).toEqual([
      "armsolar",
    ]);
    expect(next.bases[0].buildings).toEqual([{ queue: ["armpw"] }]);
  });

  it("takes the base and its layout with the last building", () => {
    const one = removeBuilding(document(), "b1", 1);
    const none = removeBuilding(one, "b1", 0);
    expect(none.bases).toEqual([]);
    expect(none.blueprints).toEqual([]);
  });

  it("hands the same document back for a building that is not there", () => {
    const before = document();
    expect(removeBuilding(before, "b1", 7)).toBe(before);
  });
});

describe("normalising a queue", () => {
  it("drops an empty queue and the repeat that goes with it", () => {
    expect(normaliseQueue([], true)).toEqual({
      queue: undefined,
      repeat: undefined,
    });
  });

  it("drops blank entries", () => {
    expect(normaliseQueue(["armpw", "  ", ""], false)).toEqual({
      queue: ["armpw"],
      repeat: undefined,
    });
  });

  it("keeps repeat only when it is on", () => {
    expect(normaliseQueue(["armpw"], true).repeat).toBe(true);
    expect(normaliseQueue(["armpw"], false).repeat).toBeUndefined();
  });
});

describe("a building's queue", () => {
  it("writes the queue and the repeat flag onto that building alone", () => {
    const next = setQueue(document(), "b1", 0, ["armpw", "armpw"], true);
    expect(buildingsOf(next)[0].queue).toEqual(["armpw", "armpw"]);
    expect(buildingsOf(next)[0].repeat).toBe(true);
    expect(buildingsOf(next)[1].queue).toBeUndefined();
  });

  /** A queue is a mission's business, not the layout's, so a saved blueprint
   *  never carries one out with it. */
  it("leaves the layout untouched", () => {
    const before = document();
    const next = setQueue(before, "b1", 0, ["armpw"], true);
    expect(next.blueprints).toEqual(before.blueprints);
  });

  it("clears the queue and the flag together", () => {
    const with_ = setQueue(document(), "b1", 0, ["armpw"], true);
    const without = setQueue(with_, "b1", 0, [], true);
    expect(buildingsOf(without)[0].queue).toBeUndefined();
    expect(buildingsOf(without)[0].repeat).toBeUndefined();
  });

  it("hands the same document back for a building that is not there", () => {
    const before = document();
    expect(setQueue(before, "b1", 7, ["armpw"], false)).toBe(before);
  });

  it("appends the same def twice rather than folding it up", () => {
    expect(plusQueued(["armpw"], "armpw")).toEqual(["armpw", "armpw"]);
  });

  it("ignores an empty def", () => {
    const queue = ["armpw"];
    expect(plusQueued(queue, "")).toBe(queue);
  });

  it("takes one entry out by index", () => {
    expect(withoutQueued(["a", "b", "c"], 1)).toEqual(["a", "c"]);
    const queue = ["a"];
    expect(withoutQueued(queue, 3)).toBe(queue);
  });

  it("moves one entry up and down the queue", () => {
    expect(movedQueued(["a", "b", "c"], 2, -1)).toEqual(["a", "c", "b"]);
    expect(movedQueued(["a", "b", "c"], 0, 1)).toEqual(["b", "a", "c"]);
  });

  it("hands the queue back at either end and for an index it does not have", () => {
    const queue = ["a", "b"];
    expect(movedQueued(queue, 0, -1)).toBe(queue);
    expect(movedQueued(queue, 1, 1)).toBe(queue);
    expect(movedQueued(queue, 5, -1)).toBe(queue);
  });
});

describe("the game's units", () => {
  it("offers only the static ones for a base", () => {
    expect(buildingUnits(units).map((u) => u.name)).toEqual([
      "armlab",
      "armsolar",
    ]);
  });

  it("keeps a unit the dataset says nothing about", () => {
    expect(buildingUnits([{ name: "mystery" }])).toHaveLength(1);
  });

  it("names the mobile defs a base already holds", () => {
    expect(
      strayDefs(units, [{ def: "armlab" }, { def: "armpw" }, { def: "armpw" }]),
    ).toEqual(["armpw"]);
  });

  it("accuses nothing while the dataset is unread", () => {
    expect(strayDefs([], [{ def: "armpw" }])).toEqual([]);
  });

  it("offers a factory its own build options", () => {
    expect(buildableBy(units, "armlab")?.map((u) => u.name)).toEqual([
      "armpw",
      "armck",
    ]);
  });

  it("says a building with no options builds nothing", () => {
    expect(buildableBy(units, "armsolar")).toEqual([]);
  });

  it("says it does not know a def the dataset has not got", () => {
    expect(buildableBy(units, "armwin")).toBeNull();
  });
});

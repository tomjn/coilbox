import { describe, expect, it } from "vitest";
import type { UnitDatasetEntry } from "@/content/bindings";
import { newScenario } from "../../create";
import type { Scenario, ScenarioPrefab } from "../../model";
import {
  addBuilding,
  addPrefab,
  buildableBy,
  buildingUnits,
  editPrefab,
  movedQueued,
  normaliseQueue,
  plusQueued,
  removePrefab,
  setOrigin,
  setQueue,
  strayDefs,
  withoutQueued,
} from "./prefabs";

const base: ScenarioPrefab = {
  id: "b1",
  team: "p1",
  origin: { x: 1000, z: 2000 },
  buildings: [
    { def: "armlab", offset: { x: 0, z: 0 }, facing: 0 },
    { def: "armsolar", offset: { x: 128, z: 64 }, facing: 1 },
  ],
};

function document(): Scenario {
  return { ...newScenario("test"), prefabs: [structuredClone(base)] };
}

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
    const next = addPrefab(newScenario("test"), "b2", {
      team: "p0",
      origin: { x: 10.6, z: 20.2 },
      buildings: [{ def: "armsolar", offset: { x: 3.7, z: -1.2 }, facing: 2 }],
    });
    expect(next.prefabs[0].origin).toEqual({ x: 11, z: 20 });
    expect(next.prefabs[0].buildings[0].offset).toEqual({ x: 4, z: -1 });
  });
});

describe("adding a building", () => {
  it("appends it with a rounded offset", () => {
    const next = addBuilding(document(), "b1", {
      def: "armwin",
      offset: { x: -63.5, z: 12.4 },
      facing: 3,
    });
    expect(next.prefabs[0].buildings).toHaveLength(3);
    expect(next.prefabs[0].buildings[2]).toEqual({
      def: "armwin",
      offset: { x: -63, z: 12 },
      facing: 3,
    });
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
    expect(next.prefabs[0].origin).toEqual({ x: 500, z: 601 });
    expect(next.prefabs[0].buildings[1].offset).toEqual({ x: 128, z: 64 });
  });

  it("hands the same document back when no base has that id", () => {
    const before = document();
    expect(setOrigin(before, "nope", { x: 0, z: 0 })).toBe(before);
  });
});

describe("the base itself", () => {
  it("changes the team", () => {
    expect(editPrefab(document(), "b1", { team: "p2" }).prefabs[0].team).toBe(
      "p2",
    );
  });

  it("removes the whole base", () => {
    expect(removePrefab(document(), "b1").prefabs).toEqual([]);
  });

  it("hands the same document back when removing one that is not there", () => {
    const before = document();
    expect(removePrefab(before, "nope")).toBe(before);
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
    expect(next.prefabs[0].buildings[0].queue).toEqual(["armpw", "armpw"]);
    expect(next.prefabs[0].buildings[0].repeat).toBe(true);
    expect(next.prefabs[0].buildings[1].queue).toBeUndefined();
  });

  it("clears the queue and the flag together", () => {
    const with_ = setQueue(document(), "b1", 0, ["armpw"], true);
    const without = setQueue(with_, "b1", 0, [], true);
    expect(without.prefabs[0].buildings[0].queue).toBeUndefined();
    expect(without.prefabs[0].buildings[0].repeat).toBeUndefined();
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
      strayDefs(units, [
        { def: "armlab", offset: { x: 0, z: 0 }, facing: 0 },
        { def: "armpw", offset: { x: 0, z: 0 }, facing: 0 },
        { def: "armpw", offset: { x: 10, z: 0 }, facing: 0 },
      ]),
    ).toEqual(["armpw"]);
  });

  it("accuses nothing while the dataset is unread", () => {
    expect(
      strayDefs([], [{ def: "armpw", offset: { x: 0, z: 0 }, facing: 0 }]),
    ).toEqual([]);
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

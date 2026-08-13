import { describe, expect, it } from "vitest";
import { BUILD_SQUARE } from "@/blueprint/footprint";
import type { BaseBlueprint } from "@/blueprint/model";
import type { UnitDatasetEntry } from "@/content/bindings";
import { newScenario } from "../../create";
import { baseBuildings, type Scenario, type ScenarioBase } from "../../model";
import {
  addBase,
  addBuilding,
  buildableBy,
  buildingUnits,
  copyName,
  editBase,
  moveBuilding,
  movedQueued,
  normaliseQueue,
  plusQueued,
  removeBase,
  removeBuilding,
  renameBlueprint,
  replaceBlueprint,
  setBlueprintOrdered,
  setOrigin,
  setQueue,
  sharingLayout,
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
  it("moves it in whole build squares, leaving the offsets alone", () => {
    // 1000 to 500 is 500 elmos, which is 31 build squares and a bit. Moving the
    // bit as well would take every building in the base off the grid it was
    // built on, so the base stops on the square instead of on the click.
    const next = setOrigin(document(), "b1", { x: 500.4, z: 600.6 });
    expect(next.bases[0].origin).toEqual({ x: 504, z: 608 });
    expect(next.blueprints[0].buildings[1].offset).toEqual({ x: 128, z: 64 });
  });

  it("keeps every building on the ground it stood on", () => {
    const before = document();
    const next = setOrigin(before, "b1", { x: 1234, z: 5678 });
    const moved = {
      x: next.bases[0].origin.x - before.bases[0].origin.x,
      z: next.bases[0].origin.z - before.bases[0].origin.z,
    };
    expect(moved.x % BUILD_SQUARE).toBe(0);
    expect(moved.z % BUILD_SQUARE).toBe(0);
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

describe("a layout two bases share", () => {
  /** The same layout placed twice, which is what a library blueprint dropped
   *  into a mission twice looks like. */
  function shared(): Scenario {
    const doc = document();
    return {
      ...doc,
      bases: [
        ...doc.bases,
        { ...structuredClone(base), id: "b2", origin: { x: 5000, z: 6000 } },
      ],
    };
  }

  const layoutOf = (scenario: Scenario, id: string) =>
    scenario.blueprints.find(
      (b) => b.id === scenario.bases.find((p) => p.id === id)?.blueprint,
    ) as BaseBlueprint;

  it("says which other bases are placed from it", () => {
    expect(sharingLayout(shared(), "b1")).toEqual(["b2"]);
    expect(sharingLayout(shared(), "b2")).toEqual(["b1"]);
    expect(sharingLayout(document(), "b1")).toEqual([]);
  });

  it("gives the edited base a layout of its own", () => {
    const next = addBuilding(shared(), "b1", {
      def: "armllt",
      offset: { x: 32, z: 32 },
      facing: 0,
    });
    expect(next.blueprints).toHaveLength(2);
    expect(next.bases[0].blueprint).not.toBe("bp1");
    expect(next.bases[1].blueprint).toBe("bp1");
    expect(layoutOf(next, "b1").buildings.map((b) => b.def)).toEqual([
      "armlab",
      "armsolar",
      "armllt",
    ]);
    expect(layoutOf(next, "b2").buildings.map((b) => b.def)).toEqual([
      "armlab",
      "armsolar",
    ]);
  });

  it("names the copy after the layout it was made from", () => {
    const once = addBuilding(shared(), "b1", {
      def: "armllt",
      offset: { x: 32, z: 32 },
      facing: 0,
    });
    expect(layoutOf(once, "b1").name).toBe("The keep copy");
  });

  it("takes a building out of the copy alone", () => {
    const next = removeBuilding(shared(), "b1", 0);
    expect(layoutOf(next, "b1").buildings.map((b) => b.def)).toEqual([
      "armsolar",
    ]);
    expect(layoutOf(next, "b2").buildings.map((b) => b.def)).toEqual([
      "armlab",
      "armsolar",
    ]);
  });

  it("writes through to every base when the author asked for that", () => {
    const next = addBuilding(
      shared(),
      "b1",
      { def: "armllt", offset: { x: 32, z: 32 }, facing: 0 },
      "shared",
    );
    expect(next.blueprints).toHaveLength(1);
    expect(layoutOf(next, "b2").buildings).toHaveLength(3);
  });

  it("edits a layout nothing else places in place", () => {
    const next = addBuilding(document(), "b1", {
      def: "armllt",
      offset: { x: 32, z: 32 },
      facing: 0,
    });
    expect(next.blueprints).toHaveLength(1);
    expect(next.bases[0].blueprint).toBe("bp1");
  });

  it("keeps the layout when one of the bases sharing it goes", () => {
    const next = removeBase(shared(), "b1");
    expect(next.bases.map((b) => b.id)).toEqual(["b2"]);
    expect(next.blueprints.map((b) => b.id)).toEqual(["bp1"]);
  });

  it("keeps the layout when a shared base loses its last building", () => {
    const one = removeBuilding(shared(), "b1", 1);
    const gone = removeBuilding(one, "b1", 0);
    expect(gone.bases.map((b) => b.id)).toEqual(["b2"]);
    expect(layoutOf(gone, "b2").buildings).toHaveLength(2);
  });
});

describe("naming a layout", () => {
  it("renames the one this base is placed from", () => {
    const next = renameBlueprint(document(), "b1", "Opening base");
    expect(next.blueprints[0].name).toBe("Opening base");
  });

  it("trims the name and refuses a blank one", () => {
    expect(
      renameBlueprint(document(), "b1", "  Keep  ").blueprints[0].name,
    ).toBe("Keep");
    const before = document();
    expect(renameBlueprint(before, "b1", "   ")).toBe(before);
    expect(renameBlueprint(before, "nope", "Keep")).toBe(before);
  });

  it("gives a shared layout's name to a copy rather than to both bases", () => {
    const doc = document();
    const two = {
      ...doc,
      bases: [...doc.bases, { ...structuredClone(base), id: "b2" }],
    };
    const next = renameBlueprint(two, "b1", "Opening base");
    expect(next.blueprints).toHaveLength(2);
    expect(next.blueprints[0].name).toBe("The keep");
    expect(next.blueprints[1].name).toBe("Opening base");
    expect(next.bases[1].blueprint).toBe("bp1");
  });

  it("renames the shared layout when the author asked for that", () => {
    const doc = document();
    const two = {
      ...doc,
      bases: [...doc.bases, { ...structuredClone(base), id: "b2" }],
    };
    const next = renameBlueprint(two, "b1", "Opening base", "shared");
    expect(next.blueprints).toHaveLength(1);
    expect(next.blueprints[0].name).toBe("Opening base");
  });

  it("names a copy something nothing else in the document is called", () => {
    expect(copyName([], "The keep")).toBe("The keep copy");
    expect(copyName(["The keep", "The keep copy"], "The keep")).toBe(
      "The keep copy 2",
    );
    expect(copyName(["The keep copy", "The keep copy 2"], "The keep")).toBe(
      "The keep copy 3",
    );
  });

  it("names a layout the editor mints rather than leaving it a UUID", () => {
    const one = addBase(newScenario("test"), "b2", "bp2", {
      team: "p0",
      origin: { x: 0, z: 0 },
      buildings: [{ def: "armsolar", offset: { x: 0, z: 0 }, facing: 0 }],
    });
    expect(one.blueprints[0].name).toBe("Layout 1");
    const two = addBase(one, "b3", "bp3", {
      team: "p0",
      origin: { x: 500, z: 0 },
      buildings: [{ def: "armsolar", offset: { x: 0, z: 0 }, facing: 0 }],
    });
    expect(two.blueprints[1].name).toBe("Layout 2");
  });
});

/**
 * Issue #1418. The array is the build order, so there is nothing to reorder but
 * the array itself, and a base's own fields are read by position and have to
 * come along.
 */
describe("a layout whose order is the build order", () => {
  it("says the order was meant, and takes it back", () => {
    const on = setBlueprintOrdered(document(), "b1", true);
    expect(on.blueprints[0].ordered).toBe(true);
    expect(setBlueprintOrdered(on, "b1", false).blueprints[0].ordered).toBe(
      undefined,
    );
  });

  it("hands the same document back when nothing changes", () => {
    const before = document();
    expect(setBlueprintOrdered(before, "b1", false)).toBe(before);
    expect(setBlueprintOrdered(before, "nope", true)).toBe(before);
  });

  it("moves a building and its mission fields together", () => {
    const doc = setQueue(document(), "b1", 1, ["armpw"], true);
    const next = moveBuilding(doc, "b1", 1, -1);
    expect(next.blueprints[0].buildings.map((b) => b.def)).toEqual([
      "armsolar",
      "armlab",
    ]);
    expect(buildingsOf(next).map((b) => b.queue)).toEqual([
      ["armpw"],
      undefined,
    ]);
  });

  it("keeps the base's list no longer than it has to be", () => {
    const doc = setQueue(document(), "b1", 0, ["armpw"], false);
    const next = moveBuilding(doc, "b1", 0, 1);
    expect(next.bases[0].buildings).toEqual([{}, { queue: ["armpw"] }]);
    expect(moveBuilding(next, "b1", 1, -1).bases[0].buildings).toEqual([
      { queue: ["armpw"] },
    ]);
  });

  it("hands the same document back at either end", () => {
    const before = document();
    expect(moveBuilding(before, "b1", 0, -1)).toBe(before);
    expect(moveBuilding(before, "b1", 1, 1)).toBe(before);
    expect(moveBuilding(before, "b1", 7, -1)).toBe(before);
    expect(moveBuilding(before, "nope", 0, 1)).toBe(before);
  });

  it("reorders a shared layout into a copy, like any other edit", () => {
    const doc = document();
    const two = {
      ...doc,
      bases: [...doc.bases, { ...structuredClone(base), id: "b2" }],
    };
    const own = moveBuilding(two, "b1", 0, 1);
    expect(own.blueprints).toHaveLength(2);
    expect(own.blueprints[0].buildings.map((b) => b.def)).toEqual([
      "armlab",
      "armsolar",
    ]);
    expect(own.blueprints[1].buildings.map((b) => b.def)).toEqual([
      "armsolar",
      "armlab",
    ]);
    const shared = moveBuilding(two, "b1", 0, 1, "shared");
    expect(shared.blueprints).toHaveLength(1);
    expect(shared.blueprints[0].buildings.map((b) => b.def)).toEqual([
      "armsolar",
      "armlab",
    ]);
    expect(setBlueprintOrdered(two, "b1", true).blueprints).toHaveLength(2);
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

describe("a layout edited as a layout", () => {
  it("replaces the one with the same id, wherever it is placed", () => {
    const doc = document();
    const edited: BaseBlueprint = {
      ...layout,
      name: "The keep, redrawn",
      buildings: [{ def: "armwin", offset: { x: 0, z: 0 }, facing: 0 }],
    };
    const next = replaceBlueprint(doc, edited);
    expect(next.blueprints).toEqual([edited]);
    expect(next.bases).toEqual(doc.bases);
  });

  it("changes every base placed from it, because it is one layout", () => {
    const doc = {
      ...document(),
      bases: [
        structuredClone(base),
        { ...structuredClone(base), id: "b2", origin: { x: 0, z: 0 } },
      ],
    };
    const next = replaceBlueprint(doc, {
      ...layout,
      buildings: [{ def: "armwin", offset: { x: 0, z: 0 }, facing: 0 }],
    });
    expect(buildingsOf(next, "b1").map((b) => b.def)).toEqual(["armwin"]);
    expect(buildingsOf(next, "b2").map((b) => b.def)).toEqual(["armwin"]);
  });

  it("takes the layout and its bases away when it is emptied", () => {
    // A layout with nothing in it draws nothing and can never be clicked on
    // again, so leaving the bases behind would leave the document holding
    // things an author cannot reach.
    const next = replaceBlueprint(document(), { ...layout, buildings: [] });
    expect(next.blueprints).toEqual([]);
    expect(next.bases).toEqual([]);
  });

  it("leaves a document that has never heard of the layout alone", () => {
    const doc = document();
    expect(replaceBlueprint(doc, { ...layout, id: "other" })).toBe(doc);
  });
});

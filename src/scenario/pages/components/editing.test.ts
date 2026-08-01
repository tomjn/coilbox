import { describe, expect, it } from "vitest";
import { newScenario } from "../../create";
import type { Scenario } from "../../model";
import {
  addActor,
  canTurn,
  clampToMap,
  dragKeys,
  isClick,
  movePlacement,
  parsePlacementKey,
  pointerNdc,
  removePlacement,
  turnFacing,
  turnPlacement,
} from "./editing";
import { scenarioPlacements } from "./placements";

/** A document with one of each shape, so the three move and delete rules can be
 *  told apart. */
function document(): Scenario {
  return {
    ...newScenario("test"),
    actors: [
      {
        id: "a1",
        unitDef: "armpw",
        team: "p0",
        pos: { x: 100, z: 200 },
        facing: 0,
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
    prefabs: [
      {
        id: "b1",
        team: "p1",
        origin: { x: 2000, z: 2000 },
        buildings: [
          { def: "armsolar", offset: { x: 0, z: 0 }, facing: 0 },
          { def: "armllt", offset: { x: 64, z: 0 }, facing: 1 },
        ],
      },
    ],
  };
}

describe("isClick", () => {
  it("counts a still pointer as a click", () => {
    expect(isClick({ x: 10, y: 10 }, { x: 12, y: 8 })).toBe(true);
  });

  it("counts a travelled pointer as a drag", () => {
    expect(isClick({ x: 10, y: 10 }, { x: 40, y: 10 })).toBe(false);
    expect(isClick({ x: 10, y: 10 }, { x: 10, y: 40 })).toBe(false);
  });
});

describe("pointerNdc", () => {
  const rect = { left: 20, top: 40, width: 200, height: 100 };

  it("puts the centre at the origin", () => {
    const at = pointerNdc({ x: 120, y: 90 }, rect);
    expect(at.x).toBeCloseTo(0);
    expect(at.y).toBeCloseTo(0);
  });

  it("puts the top left at -1, 1", () => {
    expect(pointerNdc({ x: 20, y: 40 }, rect)).toEqual({ x: -1, y: 1 });
  });

  it("survives a canvas with no size", () => {
    expect(
      pointerNdc({ x: 5, y: 5 }, { left: 0, top: 0, width: 0, height: 0 }),
    ).toEqual({ x: 0, y: 0 });
  });
});

describe("clampToMap", () => {
  it("holds a point inside the map", () => {
    expect(clampToMap({ x: -50, z: 9000 }, 4096, 4096)).toEqual({
      x: 0,
      z: 4096,
    });
  });

  it("leaves a point on the map alone", () => {
    expect(clampToMap({ x: 10, z: 20 }, 4096, 4096)).toEqual({ x: 10, z: 20 });
  });
});

describe("parsePlacementKey", () => {
  it("reads the three key shapes", () => {
    expect(parsePlacementKey("actor:a1")).toEqual({
      kind: "actor",
      id: "a1",
      index: 0,
    });
    expect(parsePlacementKey("group:g1#3")).toEqual({
      kind: "group",
      id: "g1",
      index: 3,
    });
    expect(parsePlacementKey("prefab:b1#0")).toEqual({
      kind: "prefab",
      id: "b1",
      index: 0,
    });
  });

  it("rejects anything else", () => {
    expect(parsePlacementKey("zone:z1")).toBeNull();
    expect(parsePlacementKey("group:g1")).toBeNull();
    expect(parsePlacementKey("group:g1#x")).toBeNull();
    expect(parsePlacementKey("actor:")).toBeNull();
    expect(parsePlacementKey("")).toBeNull();
  });
});

describe("dragKeys", () => {
  const placements = scenarioPlacements(document());

  it("drags an actor on its own", () => {
    expect(dragKeys(placements, "actor:a1")).toEqual(["actor:a1"]);
  });

  it("drags a whole group when one of its units is picked up", () => {
    expect(dragKeys(placements, "group:g1#1")).toEqual([
      "group:g1#0",
      "group:g1#1",
      "group:g1#2",
    ]);
  });

  it("drags one building of a prefab", () => {
    expect(dragKeys(placements, "prefab:b1#1")).toEqual(["prefab:b1#1"]);
  });

  it("has nothing to drag for a key that is not drawn", () => {
    expect(dragKeys(placements, "actor:gone")).toEqual([]);
  });
});

describe("movePlacement", () => {
  it("moves an actor and rounds it to whole elmos", () => {
    const next = movePlacement(document(), "actor:a1", { x: 10.4, z: -20.6 });
    expect(next.actors[0].pos).toEqual({ x: 110, z: 179 });
  });

  it("moves the whole group when one of its units is dragged", () => {
    const next = movePlacement(document(), "group:g1#2", { x: 100, z: 0 });
    expect(next.groups[0].pos).toEqual({ x: 1100, z: 1000 });
  });

  it("moves one prefab building by its offset, leaving the origin alone", () => {
    const next = movePlacement(document(), "prefab:b1#1", { x: 0, z: 64 });
    expect(next.prefabs[0].origin).toEqual({ x: 2000, z: 2000 });
    expect(next.prefabs[0].buildings.map((b) => b.offset)).toEqual([
      { x: 0, z: 0 },
      { x: 64, z: 64 },
    ]);
  });

  it("hands back the same document when the key names nothing", () => {
    const before = document();
    expect(movePlacement(before, "actor:gone", { x: 1, z: 1 })).toBe(before);
    expect(movePlacement(before, "prefab:b1#7", { x: 1, z: 1 })).toBe(before);
    expect(movePlacement(before, "nonsense", { x: 1, z: 1 })).toBe(before);
  });
});

describe("turning", () => {
  it("wraps a facing both ways", () => {
    expect(turnFacing(3, 1)).toBe(0);
    expect(turnFacing(0, -1)).toBe(3);
    expect(turnFacing(1, 4)).toBe(1);
  });

  it("turns an actor and a prefab building", () => {
    expect(turnPlacement(document(), "actor:a1").actors[0].facing).toBe(1);
    expect(
      turnPlacement(document(), "prefab:b1#1").prefabs[0].buildings[1].facing,
    ).toBe(2);
  });

  it("leaves a group alone, because it has no facing", () => {
    const before = document();
    expect(turnPlacement(before, "group:g1#0")).toBe(before);
    expect(canTurn("group:g1#0")).toBe(false);
    expect(canTurn("actor:a1")).toBe(true);
    expect(canTurn("prefab:b1#0")).toBe(true);
  });
});

describe("removePlacement", () => {
  it("removes an actor", () => {
    expect(removePlacement(document(), "actor:a1").actors).toEqual([]);
  });

  it("takes one off the count of the group unit that was picked", () => {
    const next = removePlacement(document(), "group:g1#0");
    expect(next.groups[0].units).toEqual([
      { def: "armpw", count: 1 },
      { def: "armrock", count: 1 },
    ]);
  });

  it("drops the entry when its last unit goes", () => {
    const next = removePlacement(document(), "group:g1#2");
    expect(next.groups[0].units).toEqual([{ def: "armpw", count: 2 }]);
  });

  it("drops the group when its last unit goes", () => {
    let doc = document();
    for (const key of ["group:g1#2", "group:g1#1", "group:g1#0"]) {
      doc = removePlacement(doc, key);
    }
    expect(doc.groups).toEqual([]);
  });

  it("removes one prefab building, and the prefab with its last", () => {
    const one = removePlacement(document(), "prefab:b1#0");
    expect(one.prefabs[0].buildings.map((b) => b.def)).toEqual(["armllt"]);
    expect(removePlacement(one, "prefab:b1#0").prefabs).toEqual([]);
  });

  it("hands back the same document when the key names nothing", () => {
    const before = document();
    expect(removePlacement(before, "actor:gone")).toBe(before);
    expect(removePlacement(before, "group:g1#9")).toBe(before);
  });
});

describe("addActor", () => {
  it("appends a rounded actor without touching the rest", () => {
    const before = document();
    const next = addActor(before, "a2", {
      unitDef: "armrock",
      team: "p0",
      pos: { x: 10.6, z: 20.2 },
      facing: 2,
    });
    expect(next.actors).toHaveLength(2);
    expect(next.actors[1]).toEqual({
      id: "a2",
      unitDef: "armrock",
      team: "p0",
      pos: { x: 11, z: 20 },
      facing: 2,
    });
    expect(before.actors).toHaveLength(1);
  });
});

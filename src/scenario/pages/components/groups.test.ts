import { describe, expect, it } from "vitest";
import { newScenario } from "../../create";
import type { Scenario, ScenarioGroup } from "../../model";
import {
  addGroup,
  addWaypoint,
  buildingTargets,
  clampCount,
  drapePoints,
  editGroup,
  groupLabel,
  groupSize,
  MAX_GROUP_COUNT,
  moveWaypoint,
  orderOfKind,
  orderWaypoints,
  parsePathKey,
  pathKey,
  plusUnit,
  removeGroup,
  removeWaypoint,
  targetLabel,
  targetOptions,
  uniqueLabels,
  withOrder,
  withoutOrder,
  withoutUnit,
  withUnit,
} from "./groups";

const raiders: ScenarioGroup = {
  id: "g1",
  team: "p1",
  units: [
    { def: "armpw", count: 3 },
    { def: "armrock", count: 2 },
  ],
  pos: { x: 1000, z: 2000 },
  orders: [
    { kind: "patrol", waypoints: [{ x: 100, z: 100 }] },
    { kind: "guard", target: "a1" },
  ],
  dormant: false,
};

function document(): Scenario {
  return {
    ...newScenario("test"),
    actors: [
      {
        id: "a1",
        unitDef: "armcom",
        team: "p0",
        pos: { x: 0, z: 0 },
        facing: 0,
      },
      {
        id: "a2",
        unitDef: "armcom",
        team: "p0",
        pos: { x: 50, z: 0 },
        facing: 0,
      },
      {
        id: "a3",
        unitDef: "armpw",
        team: "p0",
        pos: { x: 90, z: 0 },
        facing: 0,
        state: { name: "Jarmen Kell" },
      },
    ],
    groups: [raiders],
  };
}

describe("unit lists", () => {
  it("holds a count to at least one and at most the cap", () => {
    expect(clampCount(0)).toBe(1);
    expect(clampCount(-4)).toBe(1);
    expect(clampCount(3.7)).toBe(3);
    expect(clampCount(9999)).toBe(MAX_GROUP_COUNT);
    expect(clampCount(Number.NaN)).toBe(1);
  });

  it("changes one entry and leaves the rest alone", () => {
    const units = withUnit(raiders.units, 1, { count: 7 });
    expect(units).toEqual([
      { def: "armpw", count: 3 },
      { def: "armrock", count: 7 },
    ]);
    expect(raiders.units[1].count).toBe(2);
  });

  it("hands the same list back for an entry that is not there", () => {
    expect(withUnit(raiders.units, 9, { count: 1 })).toBe(raiders.units);
    expect(withoutUnit(raiders.units, 9)).toBe(raiders.units);
  });

  it("adds one more of a def the group already holds rather than a second entry", () => {
    expect(plusUnit(raiders.units, "armpw")).toEqual([
      { def: "armpw", count: 4 },
      { def: "armrock", count: 2 },
    ]);
    expect(plusUnit(raiders.units, "armflash", 2)).toEqual([
      ...raiders.units,
      { def: "armflash", count: 2 },
    ]);
  });

  it("counts what a group puts on the map", () => {
    expect(groupSize(raiders)).toBe(5);
  });
});

describe("orders", () => {
  it("keeps the path when one waypoint kind becomes another", () => {
    const patrol = raiders.orders[0];
    expect(orderOfKind("move", patrol)).toEqual({
      kind: "move",
      waypoints: [{ x: 100, z: 100 }],
    });
  });

  it("keeps the target when guard becomes attack, and drops it otherwise", () => {
    const guard = raiders.orders[1];
    expect(orderOfKind("attack", guard)).toEqual({
      kind: "attack",
      target: "a1",
    });
    expect(orderOfKind("move", guard)).toEqual({ kind: "move", waypoints: [] });
    expect(orderOfKind("guard", raiders.orders[0])).toEqual({
      kind: "guard",
      target: "",
    });
  });

  it("reads a path off an order that has one", () => {
    expect(orderWaypoints(raiders.orders[0])).toEqual([{ x: 100, z: 100 }]);
    expect(orderWaypoints(raiders.orders[1])).toBeNull();
  });

  it("replaces and removes by index", () => {
    const replaced = withOrder(raiders.orders, 1, {
      kind: "attack",
      target: "a2",
    });
    expect(replaced[1]).toEqual({ kind: "attack", target: "a2" });
    expect(withoutOrder(raiders.orders, 0)).toEqual([raiders.orders[1]]);
    expect(withoutOrder(raiders.orders, 5)).toBe(raiders.orders);
  });
});

describe("the document", () => {
  it("adds a group with its position rounded", () => {
    const next = addGroup(document(), "g2", {
      team: "p1",
      units: [{ def: "armpw", count: 2 }],
      pos: { x: 10.6, z: 20.2 },
      orders: [],
      dormant: true,
    });
    expect(next.groups).toHaveLength(2);
    expect(next.groups[1].pos).toEqual({ x: 11, z: 20 });
  });

  it("changes a group's fields", () => {
    const next = editGroup(document(), "g1", { dormant: true, team: "p2" });
    expect(next.groups[0].dormant).toBe(true);
    expect(next.groups[0].team).toBe("p2");
  });

  it("hands the same document back when the id names no group", () => {
    const before = document();
    expect(editGroup(before, "nope", { dormant: true })).toBe(before);
    expect(removeGroup(before, "nope")).toBe(before);
  });

  it("deletes a group whose last unit entry is taken away", () => {
    const before = document();
    const next = editGroup(before, "g1", { units: [] });
    expect(next.groups).toHaveLength(0);
  });

  it("removes a group without touching anything else", () => {
    const before = document();
    const next = removeGroup(before, "g1");
    expect(next.groups).toHaveLength(0);
    expect(next.actors).toBe(before.actors);
  });
});

describe("waypoint keys", () => {
  it("round-trips", () => {
    const key = pathKey("g1", 2, 3);
    expect(key).toBe("path:g1#2@3");
    expect(parsePathKey(key)).toEqual({ groupId: "g1", order: 2, waypoint: 3 });
  });

  it("reads nothing that is not a path", () => {
    expect(parsePathKey("group:g1#0")).toBeNull();
    expect(parsePathKey("zone:z1@nw")).toBeNull();
    expect(parsePathKey("path:g1#0")).toBeNull();
    expect(parsePathKey("path:#0@1")).toBeNull();
    expect(parsePathKey("path:g1#a@1")).toBeNull();
    expect(parsePathKey("path:g1#0@-1")).toBeNull();
  });
});

describe("waypoints", () => {
  it("appends a point, rounded, to the order's path", () => {
    const next = addWaypoint(document(), "g1", 0, { x: 40.4, z: 60.5 });
    expect(orderWaypoints(next.groups[0].orders[0])).toEqual([
      { x: 100, z: 100 },
      { x: 40, z: 61 },
    ]);
  });

  it("refuses to append to an order that carries a target", () => {
    const before = document();
    expect(addWaypoint(before, "g1", 1, { x: 0, z: 0 })).toBe(before);
  });

  it("moves one point by a delta", () => {
    const next = moveWaypoint(document(), pathKey("g1", 0, 0), {
      x: 25,
      z: -50,
    });
    expect(orderWaypoints(next.groups[0].orders[0])).toEqual([
      { x: 125, z: 50 },
    ]);
  });

  it("removes one point and keeps the order it belonged to", () => {
    const next = removeWaypoint(document(), pathKey("g1", 0, 0));
    expect(next.groups[0].orders[0]).toEqual({ kind: "patrol", waypoints: [] });
  });

  it("hands the same document back for a point that is not there", () => {
    const before = document();
    expect(moveWaypoint(before, pathKey("g1", 0, 4), { x: 1, z: 1 })).toBe(
      before,
    );
    expect(removeWaypoint(before, pathKey("gone", 0, 0))).toBe(before);
    expect(moveWaypoint(before, "group:g1#0", { x: 1, z: 1 })).toBe(before);
  });
});

describe("draping a path", () => {
  const line = [
    { x: 0, z: 0 },
    { x: 100, z: 0 },
  ];

  it("cuts a segment into steps no longer than the spacing", () => {
    expect(drapePoints(line, 50)).toEqual([
      { x: 0, z: 0 },
      { x: 50, z: 0 },
      { x: 100, z: 0 },
    ]);
  });

  it("leaves a short segment alone but for its ends", () => {
    expect(drapePoints(line, 400)).toEqual(line);
  });

  it("closes a loop without repeating the first point", () => {
    const loop = drapePoints(
      [
        { x: 0, z: 0 },
        { x: 100, z: 0 },
        { x: 100, z: 100 },
      ],
      100,
      true,
    );
    // The diagonal home is longer than the spacing, so it is cut in two, and
    // the first point is not repeated at the end.
    expect(loop).toEqual([
      { x: 0, z: 0 },
      { x: 100, z: 0 },
      { x: 100, z: 100 },
      { x: 50, z: 50 },
    ]);
  });

  it("has nothing to cut up when there is one point or none", () => {
    expect(drapePoints([{ x: 5, z: 5 }], 10)).toEqual([{ x: 5, z: 5 }]);
    expect(drapePoints([], 10)).toEqual([]);
  });
});

describe("names", () => {
  it("numbers repeated labels and leaves the rest alone", () => {
    expect(uniqueLabels(["armcom", "armpw", "armcom"])).toEqual([
      "armcom 1",
      "armpw",
      "armcom 2",
    ]);
  });

  it("names a group by its place in the document", () => {
    expect(groupLabel(document().groups, "g1")).toBe("Group 1");
    expect(groupLabel(document().groups, "gone")).toBe("a group that is gone");
  });

  it("offers every actor and group an order can be pointed at", () => {
    expect(targetOptions(document())).toEqual([
      { value: "a1", label: "armcom 1", description: "actor · armcom" },
      { value: "a2", label: "armcom 2", description: "actor · armcom" },
      { value: "a3", label: "Jarmen Kell", description: "actor · armpw" },
      { value: "g1", label: "Group 1", description: "group · 5 units" },
    ]);
  });

  it("leaves out the group doing the ordering", () => {
    const options = targetOptions(document(), "g1");
    expect(options.map((o) => o.value)).toEqual(["a1", "a2", "a3"]);
  });

  it("says plainly when a target names nothing", () => {
    expect(targetLabel(document(), "a3")).toBe("Jarmen Kell");
    expect(targetLabel(document(), "")).toBe("nothing yet");
    expect(targetLabel(document(), "deleted")).toBe("something that is gone");
  });

  /**
   * Issue #878. A named prefab building answers to the runtime's `units` table
   * the way an actor does, so an order can be pointed at one.
   */
  describe("prefab buildings", () => {
    const withBase = (): Scenario => ({
      ...document(),
      prefabs: [
        {
          id: "pf1",
          team: "p1",
          origin: { x: 500, z: 500 },
          buildings: [
            { id: "b1", def: "corlab", offset: { x: 0, z: 0 }, facing: 0 },
            { def: "cormex", offset: { x: 64, z: 0 }, facing: 0 },
          ],
        },
      ],
    });

    it("offers a named one and leaves an unnamed one out", () => {
      expect(buildingTargets(withBase().prefabs)).toEqual([
        { id: "b1", label: "Base 1's corlab", def: "corlab" },
      ]);
    });

    it("numbers two of a def in the same base apart", () => {
      const scenario = withBase();
      const buildings = [
        scenario.prefabs[0].buildings[0],
        {
          id: "b2",
          def: "corlab",
          offset: { x: 96, z: 0 },
          facing: 0 as const,
        },
      ];
      expect(
        buildingTargets([{ ...scenario.prefabs[0], buildings }]).map(
          (b) => b.label,
        ),
      ).toEqual(["Base 1's corlab 1", "Base 1's corlab 2"]);
    });

    it("puts them in the order picker between the actors and the groups", () => {
      expect(targetOptions(withBase()).map((o) => o.value)).toEqual([
        "a1",
        "a2",
        "a3",
        "b1",
        "g1",
      ]);
      expect(targetLabel(withBase(), "b1")).toBe("Base 1's corlab");
    });
  });
});

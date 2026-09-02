import { describe, expect, it } from "vitest";
import { newScenario } from "../../create";
import { parseExtensions } from "../../extensions";
import type { Scenario, ScenarioOrder } from "../../model";
import { pathKey } from "./groups";
import {
  movePathWaypoint,
  orderPathId,
  parseOrderPathId,
  pathLabel,
  pathPointPosition,
  removePathWaypoint,
  scenarioPaths,
} from "./orderPaths";
import { ordersParam } from "./triggers";

const patrol: ScenarioOrder = {
  kind: "patrol",
  waypoints: [
    { x: 100, z: 100 },
    { x: 500, z: 300 },
  ],
};

const march: ScenarioOrder = {
  kind: "move",
  waypoints: [{ x: 900, z: 900 }],
};

/** A document with one group that has a patrol, and one trigger that hands that
 *  group a move order. */
function document(): Scenario {
  const scenario = newScenario("paths");
  return {
    ...scenario,
    groups: [
      {
        id: "g1",
        team: "p0",
        units: [{ def: "armpw", count: 2 }],
        pos: { x: 2000, z: 1000 },
        orders: [patrol],
        dormant: false,
      },
    ],
    triggers: [
      {
        id: "trigger-1",
        name: "trigger-1",
        enabled: true,
        repeat: false,
        conditions: { op: "all", conditions: [] },
        actions: [
          {
            type: "give_orders",
            params: { group: "g1", orders: ordersParam([march]) },
          },
        ],
      },
    ],
  };
}

const held = orderPathId({
  trigger: 0,
  list: "actions",
  step: 0,
  param: "orders",
});

describe("orderPathId", () => {
  it("round-trips", () => {
    expect(held).toBe("step:0:actions:0:orders");
    expect(parseOrderPathId(held)).toEqual({
      trigger: 0,
      list: "actions",
      step: 0,
      param: "orders",
    });
  });

  it("reads nothing that is not a trigger's orders", () => {
    expect(parseOrderPathId("6f1c0e64-1a2b-4c3d-8e9f-0a1b2c3d4e5f")).toBeNull();
    expect(parseOrderPathId("step:0:units:0:orders")).toBeNull();
    expect(parseOrderPathId("step:a:actions:0:orders")).toBeNull();
    expect(parseOrderPathId("step:0:actions:0:")).toBeNull();
  });
});

describe("scenarioPaths", () => {
  it("draws a group's own orders and the ones a trigger hands out", () => {
    const paths = scenarioPaths(document());
    expect(paths.map((path) => path.id)).toEqual(["g1", held]);
    expect(paths.map((path) => path.label)).toEqual([
      "Group 1",
      "trigger-1 · Give orders",
    ]);
  });

  it("starts both paths where the group stands", () => {
    const paths = scenarioPaths(document());
    expect(paths[0].from).toEqual({ x: 2000, z: 1000 });
    expect(paths[1].from).toEqual({ x: 2000, z: 1000 });
  });

  it("carries the orders each one holds", () => {
    const paths = scenarioPaths(document());
    expect(paths[0].orders).toEqual([patrol]);
    expect(paths[1].orders).toEqual([march]);
  });

  it("starts a trigger's path nowhere when the group it orders is gone", () => {
    const scenario = document();
    const paths = scenarioPaths({ ...scenario, groups: [] });
    expect(paths).toHaveLength(1);
    expect(paths[0].from).toBeUndefined();
  });

  it("leaves out a group with nothing to do and a trigger with no orders", () => {
    const scenario = document();
    expect(
      scenarioPaths({
        ...scenario,
        groups: [{ ...scenario.groups[0], orders: [] }],
        triggers: [
          {
            ...scenario.triggers[0],
            actions: [
              {
                type: "give_orders",
                params: { group: "g1", orders: ordersParam([]) },
              },
            ],
          },
        ],
      }),
    ).toEqual([]);
  });

  it("ignores an action that carries no orders at all", () => {
    const scenario = document();
    expect(
      scenarioPaths({
        ...scenario,
        triggers: [
          {
            ...scenario.triggers[0],
            actions: [{ type: "release_group", params: { group: "g1" } }],
          },
        ],
      }).map((path) => path.id),
    ).toEqual(["g1"]);
  });
});

/**
 * A path drawn for an action the game declared rather than one coilbox knows.
 * The declaration is parsed rather than written out as a table, so what is
 * proved is the whole route a real game takes: `missions/extensions.lua` to the
 * palette to the line on the map (issue #957).
 */
describe("scenarioPaths with a game's own action", () => {
  const extensions = parseExtensions({
    actions: [
      {
        type: "sf_convoy",
        label: "Send convoy",
        params: [
          { name: "group", kind: "groupId" },
          { name: "route", kind: "orders" },
        ],
      },
    ],
  });

  /** The document with the trigger handing out its orders through the game's
   *  own action instead of `give_orders`. */
  function declared(): Scenario {
    const scenario = document();
    return {
      ...scenario,
      triggers: [
        {
          ...scenario.triggers[0],
          actions: [
            {
              type: "sf_convoy",
              params: { group: "g1", route: ordersParam([march]) },
            },
          ],
        },
      ],
    };
  }

  const route = orderPathId({
    trigger: 0,
    list: "actions",
    step: 0,
    param: "route",
  });

  it("draws its orders, starting where the group it orders stands", () => {
    const paths = scenarioPaths(declared(), extensions);
    expect(paths.map((path) => path.id)).toEqual(["g1", route]);
    expect(paths[1].orders).toEqual([march]);
    expect(paths[1].from).toEqual({ x: 2000, z: 1000 });
  });

  it("calls it what the game's declaration calls it", () => {
    const paths = scenarioPaths(declared(), extensions);
    expect(paths[1].label).toBe("trigger-1 · Send convoy");
  });

  it("draws nothing for it when the game is not known", () => {
    expect(scenarioPaths(declared()).map((path) => path.id)).toEqual(["g1"]);
  });

  it("still draws give_orders when a game declares types too", () => {
    const paths = scenarioPaths(document(), extensions);
    expect(paths.map((path) => path.id)).toEqual(["g1", held]);
  });
});

describe("pathLabel", () => {
  it("names the path a key belongs to", () => {
    const paths = scenarioPaths(document());
    expect(pathLabel(paths, held)).toBe("trigger-1 · Give orders");
  });

  it("says so when the path has gone", () => {
    expect(pathLabel([], "g1")).toBe("a path that is gone");
  });
});

/** The orders the trigger's action holds, for reading a write back out. */
function heldOrders(scenario: Scenario): ScenarioOrder[] {
  return scenario.triggers[0].actions[0].params
    .orders as unknown as ScenarioOrder[];
}

describe("movePathWaypoint", () => {
  it("moves a point of a trigger's own orders", () => {
    const moved = movePathWaypoint(document(), pathKey(held, 0, 0), {
      x: 50,
      z: -20,
    });
    expect(heldOrders(moved)).toEqual([
      { kind: "move", waypoints: [{ x: 950, z: 880 }] },
    ]);
    // The group's own path is left alone.
    expect(moved.groups[0].orders).toEqual([patrol]);
  });

  it("rounds to whole elmos", () => {
    const moved = movePathWaypoint(document(), pathKey(held, 0, 0), {
      x: 0.4,
      z: 0.6,
    });
    expect(heldOrders(moved)[0]).toEqual({
      kind: "move",
      waypoints: [{ x: 900, z: 901 }],
    });
  });

  it("still moves a point of a group's own orders", () => {
    const moved = movePathWaypoint(document(), pathKey("g1", 0, 1), {
      x: 10,
      z: 10,
    });
    expect(moved.groups[0].orders).toEqual([
      {
        kind: "patrol",
        waypoints: [
          { x: 100, z: 100 },
          { x: 510, z: 310 },
        ],
      },
    ]);
  });

  it("hands the document back when the key names nothing", () => {
    const scenario = document();
    expect(
      movePathWaypoint(scenario, pathKey(held, 0, 9), { x: 1, z: 1 }),
    ).toBe(scenario);
    expect(
      movePathWaypoint(scenario, pathKey("step:9:actions:0:orders", 0, 0), {
        x: 1,
        z: 1,
      }),
    ).toBe(scenario);
    expect(movePathWaypoint(scenario, "zone:z1", { x: 1, z: 1 })).toBe(
      scenario,
    );
  });
});

describe("pathPointPosition (issue #2314)", () => {
  it("reads a group's own point straight out of the document", () => {
    expect(pathPointPosition(document(), pathKey("g1", 0, 1))).toEqual({
      x: 500,
      z: 300,
    });
  });

  it("reads a trigger's held point the same way", () => {
    expect(pathPointPosition(document(), pathKey(held, 0, 0))).toEqual({
      x: 900,
      z: 900,
    });
  });

  it("catches up with an edit already applied to the document, rather than a stale copy of it", () => {
    const moved = movePathWaypoint(document(), pathKey("g1", 0, 1), {
      x: 10,
      z: 10,
    });
    expect(pathPointPosition(moved, pathKey("g1", 0, 1))).toEqual({
      x: 510,
      z: 310,
    });
  });

  it("is null when the key names no point the document still holds", () => {
    expect(pathPointPosition(document(), pathKey("g1", 0, 9))).toBeNull();
    expect(
      pathPointPosition(document(), pathKey("step:9:actions:0:orders", 0, 0)),
    ).toBeNull();
    expect(pathPointPosition(document(), "zone:z1")).toBeNull();
  });
});

describe("removePathWaypoint", () => {
  it("takes a point out of a trigger's orders, keeping the order", () => {
    const cut = removePathWaypoint(document(), pathKey(held, 0, 0));
    expect(heldOrders(cut)).toEqual([{ kind: "move", waypoints: [] }]);
  });

  it("still takes a point out of a group's orders", () => {
    const cut = removePathWaypoint(document(), pathKey("g1", 0, 0));
    expect(cut.groups[0].orders).toEqual([
      { kind: "patrol", waypoints: [{ x: 500, z: 300 }] },
    ]);
  });
});

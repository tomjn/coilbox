import { describe, expect, it } from "vitest";
import {
  BUILD_SQUARE,
  type Footprint,
  snapToBuildGrid,
} from "@/blueprint/footprint";
import { turnedAbout } from "@/lib/scenarioEditing/editing";
import { newScenario } from "../../create";
import type { Point, Scenario, ScenarioOrder } from "../../model";
import { positionOn } from "./mapKeyboard";
import { turnedAroundWords, turnPivot, turnSelectionAround } from "./rigidTurn";
import { turnSelection } from "./selection";

/** How an edit to a base is written in these tests: this base's own layout. */
const own = () => "own" as const;

/**
 * A document with one of everything a rigid turn has to answer for: an actor,
 * a group with a path, a base of three buildings in a line, and a box zone that
 * is longer than it is tall.
 *
 * Every position is a whole number of build squares from the origin, which is
 * what a document written by the editor holds.
 */
function document(): Scenario {
  return {
    ...newScenario("test"),
    actors: [
      {
        id: "a1",
        unitDef: "armpw",
        team: "p0",
        pos: { x: 1000, z: 1200 },
        facing: 0,
      },
    ],
    groups: [
      {
        id: "g1",
        team: "p1",
        units: [{ def: "armpw", count: 2 }],
        pos: { x: 1400, z: 1000 },
        orders: [
          {
            kind: "move",
            waypoints: [
              { x: 1600, z: 1000 },
              { x: 1800, z: 1200 },
            ],
          },
        ],
        dormant: false,
      },
    ],
    blueprints: [
      {
        id: "bp1",
        name: "The keep",
        buildings: [
          { def: "armsolar", offset: { x: 0, z: 0 }, facing: 0 },
          { def: "armllt", offset: { x: BUILD_SQUARE * 4, z: 0 }, facing: 1 },
          { def: "armllt", offset: { x: BUILD_SQUARE * 8, z: 0 }, facing: 2 },
        ],
      },
    ],
    bases: [
      {
        id: "b1",
        blueprint: "bp1",
        team: "p1",
        origin: { x: 1000, z: 1000 },
        buildings: [],
      },
    ],
    zones: [
      {
        id: "z1",
        name: "Landing",
        shape: "box",
        min: { x: 1000, z: 1000 },
        max: { x: 1400, z: 1100 },
      },
    ],
  };
}

/** Everything the document holds, which is the mixed selection every rule below
 *  is pinned against. */
const MIXED = [
  "actor:a1",
  "group:g1#0",
  "group:g1#1",
  "base:b1#0",
  "base:b1#1",
  "base:b1#2",
  "zone:z1",
  "path:g1#0@0",
  "path:g1#0@1",
];

/** Where each of a base's buildings stands, which is origin plus offset: the
 *  point the engine is asked about, and the one a turn writes. */
function buildingSpots(doc: Scenario): Point[] {
  return [0, 1, 2].map((at) => {
    const pos = positionOn(doc, `base:b1#${at}`);
    if (!pos) throw new Error(`base:b1#${at} is gone`);
    return pos;
  });
}

describe("a quarter turn about a point", () => {
  const pivot = { x: 100, z: 100 };

  it("sends what is south of the pivot east of it, the way a facing of south becomes east", () => {
    expect(turnedAbout({ x: 100, z: 180 }, pivot, 1)).toEqual({
      x: 180,
      z: 100,
    });
    expect(turnedAbout({ x: 180, z: 100 }, pivot, 1)).toEqual({
      x: 100,
      z: 20,
    });
  });

  it("leaves the pivot itself alone", () => {
    expect(turnedAbout(pivot, pivot, 1)).toEqual(pivot);
    expect(turnedAbout(pivot, pivot, -1)).toEqual(pivot);
  });

  it("comes home exactly after four of them, from anywhere", () => {
    for (const start of [
      { x: 0, z: 0 },
      { x: 3, z: -7 },
      { x: 1523, z: 2353 },
      { x: -41, z: 1 },
    ]) {
      let at = start;
      for (let turn = 0; turn < 4; turn++) at = turnedAbout(at, pivot, 1);
      expect(at).toEqual(start);
    }
  });

  it("turns back the other way for a negative step", () => {
    const there = turnedAbout({ x: 1523, z: 2353 }, pivot, 1);
    expect(turnedAbout(there, pivot, -1)).toEqual({ x: 1523, z: 2353 });
    expect(turnedAbout({ x: 1523, z: 2353 }, pivot, -1)).toEqual(
      turnedAbout({ x: 1523, z: 2353 }, pivot, 3),
    );
  });
});

describe("the pivot a selection turns about", () => {
  it("is the position of one of the selected things, so the turn cannot move it", () => {
    const doc = document();
    const pivot = turnPivot(doc, MIXED);
    const spots = [
      positionOn(doc, "actor:a1"),
      positionOn(doc, "group:g1#0"),
      positionOn(doc, "zone:z1"),
      ...buildingSpots(doc),
      positionOn(doc, "path:g1#0@0"),
      positionOn(doc, "path:g1#0@1"),
    ];
    expect(spots).toContainEqual(pivot);
  });

  it("is the same point after a turn as before it", () => {
    const doc = document();
    const before = turnPivot(doc, MIXED);
    let after = doc;
    for (let turn = 0; turn < 3; turn++) {
      after = turnSelectionAround(after, MIXED, 1, own);
      expect(turnPivot(after, MIXED)).toEqual(before);
    }
  });

  it("is nothing at all when the selection holds nothing with a position", () => {
    expect(turnPivot(document(), ["actor:gone"])).toBeNull();
    expect(turnPivot(document(), [])).toBeNull();
  });
});

describe("turning a selection as one shape", () => {
  it("comes back to exactly where it started after four quarter turns", () => {
    const doc = document();
    let after = doc;
    for (let turn = 0; turn < 4; turn++) {
      after = turnSelectionAround(after, MIXED, 1, own);
    }
    expect(after.actors).toEqual(doc.actors);
    expect(after.groups).toEqual(doc.groups);
    expect(after.zones).toEqual(doc.zones);
    expect(after.blueprints).toEqual(doc.blueprints);
    expect(after.bases).toEqual(doc.bases);
  });

  it("comes back exactly when the middle of the selection is a half elmo", () => {
    // The one case a pivot worked out from the bounding box cannot survive. An
    // odd number of elmos across puts the middle on a half elmo, a turn about a
    // half elmo puts every position on one, and rounding those away is a nudge
    // in a fixed direction that turning back does not undo.
    const doc = document();
    const orders: ScenarioOrder[] = [
      {
        kind: "move",
        waypoints: [
          { x: 1600, z: 1000 },
          { x: 1801, z: 1200 },
        ],
      },
    ];
    const odd: Scenario = {
      ...doc,
      groups: [{ ...doc.groups[0], orders }],
    };
    // The furthest east of the lot, so the selection is now an odd number of
    // elmos wide: 1000 to 1801 across, 1000 to 1200 down.
    expect((1000 + 1801 + 1000 + 1200) % 2).toBe(1);
    let after = odd;
    for (let turn = 0; turn < 4; turn++) {
      after = turnSelectionAround(after, MIXED, 1, own);
    }
    expect(after.actors).toEqual(odd.actors);
    expect(after.groups).toEqual(odd.groups);
    expect(after.blueprints).toEqual(odd.blueprints);
    expect(after.zones).toEqual(odd.zones);
  });

  it("comes back the same way round from four turns the other way", () => {
    const doc = document();
    let after = doc;
    for (let turn = 0; turn < 4; turn++) {
      after = turnSelectionAround(after, MIXED, -1, own);
    }
    expect(after.actors).toEqual(doc.actors);
    expect(after.blueprints).toEqual(doc.blueprints);
    expect(after.zones).toEqual(doc.zones);
  });

  it("is undone by turning back, which a re-snapped turn was not (issue #1523)", () => {
    const doc = document();
    const there = turnSelectionAround(doc, MIXED, 1, own);
    expect(there.blueprints).not.toEqual(doc.blueprints);
    const back = turnSelectionAround(there, MIXED, -1, own);
    expect(back.blueprints).toEqual(doc.blueprints);
    expect(back.actors).toEqual(doc.actors);
    expect(back.groups).toEqual(doc.groups);
    expect(back.zones).toEqual(doc.zones);
  });

  it("moves the buildings round each other rather than spinning each in place", () => {
    const doc = document();
    const before = buildingSpots(doc);
    const after = buildingSpots(turnSelectionAround(doc, MIXED, 1, own));
    // The three stood in a line running east. They now stand in a line running
    // north, the same distance apart, which the turn in place never does.
    expect(new Set(after.map((spot) => spot.x)).size).toBe(1);
    expect(after[1].z - after[0].z).toBe(before[0].x - before[1].x);
    expect(after[2].z - after[1].z).toBe(before[1].x - before[2].x);
  });

  it("keeps every gap in the selection the same, because a turn is a rigid motion", () => {
    const doc = document();
    const after = turnSelectionAround(doc, MIXED, 1, own);
    const gaps = (one: Scenario) => {
      const spots = [
        positionOn(one, "actor:a1"),
        positionOn(one, "group:g1#0"),
        ...buildingSpots(one),
        positionOn(one, "path:g1#0@1"),
      ] as Point[];
      return spots.flatMap((from) =>
        spots.map((to) => (from.x - to.x) ** 2 + (from.z - to.z) ** 2),
      );
    };
    expect(gaps(after)).toEqual(gaps(doc));
  });

  it("turns the facings with the positions, so a cluster keeps its shape", () => {
    const doc = document();
    const after = turnSelectionAround(doc, MIXED, 1, own);
    expect(after.actors[0].facing).toBe(1);
    expect(after.blueprints[0].buildings.map((one) => one.facing)).toEqual([
      1, 2, 3,
    ]);
  });

  it("carries a group and its path round without turning them", () => {
    const doc = document();
    const after = turnSelectionAround(doc, MIXED, 1, own);
    const pivot = turnPivot(doc, MIXED) as Point;
    expect(after.groups[0].pos).toEqual(
      turnedAbout(doc.groups[0].pos, pivot, 1),
    );
    const order = after.groups[0].orders[0];
    const was = doc.groups[0].orders[0];
    if (!("waypoints" in order) || !("waypoints" in was)) {
      throw new Error("the group's order lost its waypoints");
    }
    expect(order.waypoints).toEqual(
      was.waypoints.map((point) => turnedAbout(point, pivot, 1)),
    );
  });

  it("swaps a box zone's width and its height, because a turned box is still a box", () => {
    const doc = document();
    const after = turnSelectionAround(doc, MIXED, 1, own);
    const zone = after.zones[0];
    if (zone.shape !== "box") throw new Error("the zone stopped being a box");
    expect(zone.max.x - zone.min.x).toBe(100);
    expect(zone.max.z - zone.min.z).toBe(400);
  });

  it("turns a circle zone's centre and leaves its radius alone", () => {
    const doc = {
      ...document(),
      zones: [
        {
          id: "z1",
          name: "Landing",
          shape: "circle" as const,
          center: { x: 1000, z: 1400 },
          radius: 300,
        },
      ],
    };
    const held = ["actor:a1", "zone:z1"];
    const after = turnSelectionAround(doc, held, 1, own);
    const zone = after.zones[0];
    if (zone.shape !== "circle") throw new Error("the zone stopped being one");
    expect(zone.radius).toBe(300);
    expect(zone.center).toEqual(
      turnedAbout({ x: 1000, z: 1400 }, turnPivot(doc, held) as Point, 1),
    );
  });

  it("is the plain turn again when one thing is selected, which cannot move it", () => {
    const doc = document();
    const alone = ["actor:a1"];
    expect(turnSelectionAround(doc, alone, 1, own)).toEqual(
      turnSelection(doc, alone, 1, own),
    );
  });

  it("hands the document back when the selection names nothing it holds", () => {
    const doc = document();
    expect(turnSelectionAround(doc, ["actor:gone"], 1, own)).toBe(doc);
  });
});

/**
 * Where the engine will actually stand each of the base's buildings, which is
 * not the point the layout names: an odd span centres in the middle of a build
 * square and an even one on the corner between four, so a footprint with one of
 * each is snapped differently on each axis and differently again once it is on
 * its side.
 */
function drawnSpots(doc: Scenario, footprint: Footprint): Point[] {
  const buildings = doc.blueprints[0].buildings;
  return buildings.map((building, at) =>
    snapToBuildGrid(buildingSpots(doc)[at], footprint, building.facing),
  );
}

/** The document with every building's own point already on the build grid for
 *  the footprint and the facing it has, which is what the editor writes down
 *  when a building is placed or dragged (issue #1517). */
function snapped(doc: Scenario, footprint: Footprint): Scenario {
  const origin = doc.bases[0].origin;
  const buildings = doc.blueprints[0].buildings.map((building, at) => {
    const spot = snapToBuildGrid(
      buildingSpots(doc)[at],
      footprint,
      building.facing,
    );
    return {
      ...building,
      offset: { x: spot.x - origin.x, z: spot.z - origin.z },
    };
  });
  return { ...doc, blueprints: [{ ...doc.blueprints[0], buildings }] };
}

describe("what the engine then draws", () => {
  // A footprint with an odd side and an even one, which is the hard case: its
  // sides swap on a quarter turn, so both axes want a different grid afterwards.
  const oddAndEven: Footprint = { x: 3, z: 2 };

  it("stands the buildings in the turned shape, not a shape the grid has pulled about", () => {
    const doc = snapped(document(), oddAndEven);
    const pivot = turnPivot(doc, MIXED) as Point;
    const before = drawnSpots(doc, oddAndEven);
    const after = drawnSpots(
      turnSelectionAround(doc, MIXED, 1, own),
      oddAndEven,
    );
    // Every building is the same distance from the turned shape, so what the
    // grid did was carry the whole cluster, not bend it.
    const slips = after.map((spot, at) => {
      const want = turnedAbout(before[at], pivot, 1);
      return `${spot.x - want.x},${spot.z - want.z}`;
    });
    expect(Array.from(new Set(slips))).toEqual(["0,0"]);
  });

  it("carries the whole cluster half a square when the pivot is not on the grid the turn wants", () => {
    // A footprint with one odd side and one even one stands on x and z grids
    // half a build square out of step with each other, so a building of that
    // shape is a pivot the turned positions cannot all land on. What the grid
    // then does is the same to every building, so the cluster arrives whole and
    // half a square from where the stored points say. The middle building of
    // the three is the one nearest the middle, so it is the pivot.
    const doc = snapped(document(), oddAndEven);
    const line = ["base:b1#0", "base:b1#1", "base:b1#2"];
    const pivot = turnPivot(doc, line) as Point;
    const before = drawnSpots(doc, oddAndEven);
    const after = drawnSpots(
      turnSelectionAround(doc, line, 1, own),
      oddAndEven,
    );
    const slips = after.map((spot, at) => {
      const want = turnedAbout(before[at], pivot, 1);
      return `${spot.x - want.x},${spot.z - want.z}`;
    });
    expect(Array.from(new Set(slips))).toEqual(["8,8"]);
  });

  it("puts every building back on its own square after four turns", () => {
    const doc = document();
    let after = doc;
    for (let turn = 0; turn < 4; turn++) {
      after = turnSelectionAround(after, MIXED, 1, own);
    }
    expect(drawnSpots(after, oddAndEven)).toEqual(drawnSpots(doc, oddAndEven));
  });
});

describe("what a rigid turn says", () => {
  it("counts what turned and what only came along", () => {
    expect(turnedAroundWords(MIXED, [])).toBe(
      "Turned 5 of 8 round together. The other 3 moved with them without turning.",
    );
  });

  it("says so plainly when all of it turns", () => {
    expect(turnedAroundWords(["actor:a1", "base:b1#0"], [])).toBe(
      "Turned 2 round together.",
    );
  });

  it("says nothing turned when the selection has no facing in it", () => {
    expect(turnedAroundWords(["group:g1#0", "path:g1#0@0"], [])).toBe(
      "Swung 2 round together. Neither a group nor a path point has a facing to turn.",
    );
  });

  it("says nothing is selected when nothing is", () => {
    expect(turnedAroundWords([], [])).toBe("Nothing selected.");
  });
});

import { describe, expect, it } from "vitest";
import {
  BUILD_SQUARE,
  buildingFootprints,
  facedFootprint,
  footprintMarks,
  footprintRect,
  rectsOverlap,
  snapToBuildGrid,
  unitFootprint,
} from "./footprint";

/** Balanced Annihilation's own numbers, read out of the unit dataset, so the
 *  cases below are shapes that really exist rather than invented ones. */
const ARMMEX = { x: 3, z: 3 };
const ARMLAB = { x: 6, z: 6 };
const ARMFUS = { x: 5, z: 4 };

describe("unitFootprint", () => {
  it("reads the dataset's squares", () => {
    expect(unitFootprint({ footprintX: 5, footprintZ: 4 })).toEqual({
      x: 5,
      z: 4,
    });
  });

  it("stands a unit the dataset says nothing about on one square", () => {
    expect(unitFootprint(undefined)).toEqual({ x: 1, z: 1 });
    expect(unitFootprint({})).toEqual({ x: 1, z: 1 });
    expect(unitFootprint({ footprintX: 0, footprintZ: -2 })).toEqual({
      x: 1,
      z: 1,
    });
  });
});

describe("buildingFootprints", () => {
  it("looks a def up whatever case the document wrote it in", () => {
    const of = buildingFootprints([
      { name: "armfus", footprintX: 5, footprintZ: 4 },
    ]);
    expect(of("ARMFUS")).toEqual({ x: 5, z: 4 });
    expect(of("armfus")).toEqual({ x: 5, z: 4 });
  });

  it("gives a def the game has not got one square", () => {
    const of = buildingFootprints([]);
    expect(of("armfus")).toEqual({ x: 1, z: 1 });
  });
});

describe("facedFootprint", () => {
  it("swaps the sides on an odd facing", () => {
    expect(facedFootprint(ARMFUS, 0)).toEqual({ x: 5, z: 4 });
    expect(facedFootprint(ARMFUS, 1)).toEqual({ x: 4, z: 5 });
    expect(facedFootprint(ARMFUS, 2)).toEqual({ x: 5, z: 4 });
    expect(facedFootprint(ARMFUS, 3)).toEqual({ x: 4, z: 5 });
  });
});

describe("snapToBuildGrid", () => {
  it("centres an odd footprint in the middle of a build square", () => {
    // floor(100 / 16) * 16 + 8
    expect(snapToBuildGrid({ x: 100, z: 100 }, ARMMEX, 0)).toEqual({
      x: 104,
      z: 104,
    });
    expect(snapToBuildGrid({ x: 0, z: 0 }, ARMMEX, 0)).toEqual({ x: 8, z: 8 });
  });

  it("centres an even footprint on the corner between build squares", () => {
    // floor((100 + 8) / 16) * 16
    expect(snapToBuildGrid({ x: 100, z: 100 }, ARMLAB, 0)).toEqual({
      x: 96,
      z: 96,
    });
    expect(snapToBuildGrid({ x: 0, z: 0 }, ARMLAB, 0)).toEqual({ x: 0, z: 0 });
  });

  it("snaps each axis by the side that faces it", () => {
    // 5 by 4 turned a quarter turn is 4 by 5, so the axis that centred on a
    // square middle now centres on a corner and the other one the other way.
    expect(snapToBuildGrid({ x: 100, z: 100 }, ARMFUS, 0)).toEqual({
      x: 104,
      z: 96,
    });
    expect(snapToBuildGrid({ x: 100, z: 100 }, ARMFUS, 1)).toEqual({
      x: 96,
      z: 104,
    });
  });

  it("leaves a position it already agrees with alone", () => {
    const at = snapToBuildGrid({ x: 1000, z: 2000 }, ARMFUS, 3);
    expect(snapToBuildGrid(at, ARMFUS, 3)).toEqual(at);
  });
});

describe("footprintRect", () => {
  it("spans the squares the building stands on", () => {
    expect(footprintRect({ x: 104, z: 104 }, ARMMEX, 0)).toEqual({
      minX: 104 - 24,
      minZ: 104 - 24,
      maxX: 104 + 24,
      maxZ: 104 + 24,
    });
  });

  it("takes the turned sides on an odd facing", () => {
    expect(footprintRect({ x: 0, z: 0 }, ARMFUS, 1)).toEqual({
      minX: -32,
      minZ: -40,
      maxX: 32,
      maxZ: 40,
    });
  });
});

describe("rectsOverlap", () => {
  const at = (x: number, z: number) => footprintRect({ x, z }, ARMMEX, 0);

  it("counts two buildings sharing ground", () => {
    expect(rectsOverlap(at(0, 0), at(BUILD_SQUARE, 0))).toBe(true);
  });

  it("does not count two that only touch", () => {
    // Three squares each, so 48 elmos apart is edge against edge.
    expect(rectsOverlap(at(0, 0), at(48, 0))).toBe(false);
    expect(rectsOverlap(at(0, 0), at(0, 48))).toBe(false);
  });

  it("needs both axes to cross", () => {
    expect(rectsOverlap(at(0, 0), at(16, 96))).toBe(false);
  });
});

describe("footprintMarks", () => {
  const of = (def: string) => (def === "armfus" ? ARMFUS : ARMMEX);

  it("draws each building where the engine will put it", () => {
    const marks = footprintMarks(
      [{ key: "base:b1#0", def: "armfus", pos: { x: 100, z: 100 }, facing: 0 }],
      of,
    );
    expect(marks).toEqual([
      {
        key: "base:b1#0",
        def: "armfus",
        pos: { x: 104, z: 96 },
        facing: 0,
        footprint: { x: 5, z: 4 },
        rect: { minX: 64, minZ: 64, maxX: 144, maxZ: 128 },
        overlapping: false,
        standing: "unknown",
      },
    ]);
  });

  /** Issue #1315. Nothing here works out whether the ground will take a
   *  building, it only carries the answer beside the overlap so the map can
   *  draw both from one list. */
  it("carries a verdict on the ground each building stands on", () => {
    const marks = footprintMarks(
      [
        { key: "a", def: "armmex", pos: { x: 0, z: 0 }, facing: 0 },
        { key: "b", def: "armmex", pos: { x: 1000, z: 0 }, facing: 0 },
      ],
      of,
      (mark) => (mark.key === "a" ? "slope" : "fine"),
    );
    expect(marks.map((m) => m.standing)).toEqual(["slope", "fine"]);
  });

  it("knows nothing about the ground when nobody is asked", () => {
    const marks = footprintMarks(
      [{ key: "a", def: "armmex", pos: { x: 0, z: 0 }, facing: 0 }],
      of,
    );
    expect(marks[0].standing).toBe("unknown");
  });

  it("marks both buildings of an overlapping pair and leaves the rest", () => {
    const marks = footprintMarks(
      [
        { key: "a", def: "armmex", pos: { x: 104, z: 104 }, facing: 0 },
        { key: "b", def: "armmex", pos: { x: 120, z: 104 }, facing: 0 },
        { key: "c", def: "armmex", pos: { x: 1000, z: 1000 }, facing: 0 },
      ],
      of,
    );
    expect(marks.map((m) => m.overlapping)).toEqual([true, true, false]);
  });

  it("finds an overlap only a facing makes", () => {
    // Two 5 by 4 buildings, one north of the other. Left alone the second one's
    // four-square side faces its neighbour and the two end up edge to edge.
    // Turned a quarter turn its five-square side faces that way instead, and the
    // extra half square is enough to put it on ground the first one stands on.
    const pair = (facing: 0 | 1) => [
      { key: "a", def: "armfus", pos: { x: 200, z: 200 }, facing: 0 as const },
      { key: "b", def: "armfus", pos: { x: 200, z: 266 }, facing },
    ];
    expect(footprintMarks(pair(0), of).map((m) => m.overlapping)).toEqual([
      false,
      false,
    ]);
    expect(footprintMarks(pair(1), of).map((m) => m.overlapping)).toEqual([
      true,
      true,
    ]);
  });

  it("says nothing about a lone building", () => {
    const marks = footprintMarks(
      [{ key: "a", def: "armmex", pos: { x: 0, z: 0 }, facing: 0 }],
      of,
    );
    expect(marks[0].overlapping).toBe(false);
  });
});

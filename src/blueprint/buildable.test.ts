import { describe, expect, it } from "vitest";

import { type Ground, slopeTolerance, standsOn, unitSlopes } from "./buildable";
import { footprintMarks } from "./footprint";

/** Ground read off a function of the corner indices, with nothing lost in the
 *  reading, which is the best case a real heightmap approaches. */
function ground(at: (x: number, z: number) => number, slack = 0): Ground {
  return { cornerAt: at, slack, minHeight: -1000, maxHeight: 1000 };
}

const solar = {
  key: "s",
  def: "armsolar",
  pos: { x: 160, z: 160 },
  facing: 0 as const,
};

/** 10 degrees, near what a Beyond All Reason building declares. `40 * tan(10)`
 *  is 7.05 elmos of tolerated height difference. */
const TEN_DEGREES = slopeTolerance(10);

/** One 2 by 2 build square building, which stands on 4 by 4 heightmap
 *  squares. */
const marks = () => footprintMarks([solar], () => ({ x: 2, z: 2 }));

describe("slopeTolerance", () => {
  /** The engine's `maxHeightDif = 40 * tan(maxSlope)`, from `UnitDef.cpp`. */
  it("is the engine's tangent of the declared angle", () => {
    expect(slopeTolerance(0)).toBe(0);
    expect(slopeTolerance(10)).toBeCloseTo(40 * Math.tan(Math.PI / 18), 6);
    expect(slopeTolerance(45)).toBeCloseTo(40, 6);
  });

  it("clamps to the range the engine clamps to", () => {
    expect(slopeTolerance(-5)).toBe(0);
    expect(slopeTolerance(200)).toBeCloseTo(slopeTolerance(89), 6);
  });
});

describe("standsOn", () => {
  it("says nothing about flat ground", () => {
    expect(
      standsOn(
        marks()[0],
        ground(() => 100),
        TEN_DEGREES,
      ),
    ).toBe("fine");
  });

  /** The whole point of the issue. A wind farm laid out on the flat does not
   *  place on a slope, and 20 elmos per heightmap square is far past what the
   *  def tolerates. */
  it("marks a building straddling a real slope", () => {
    expect(
      standsOn(
        marks()[0],
        ground((x) => x * 20),
        TEN_DEGREES,
      ),
    ).toBe("slope");
  });

  it("leaves a building on a slope gentle enough for its def", () => {
    // 1 elmo per heightmap square puts every square within 2 of the height the
    // engine levels the building to, inside the 7.05 the def allows.
    expect(
      standsOn(
        marks()[0],
        ground((x) => x),
        TEN_DEGREES,
      ),
    ).toBe("fine");
  });

  /** The reference height is the engine's, taken from the ground under the
   *  middle, so a building half on a step is refused even though half of it is
   *  level. */
  it("marks a building half on a step", () => {
    const step = ground((x) => (x >= 20 ? 60 : 0));
    expect(standsOn(marks()[0], step, TEN_DEGREES)).toBe("slope");
  });

  it("says nothing when the ground cannot be read finely enough", () => {
    // 6 elmos per heightmap square puts the far corner 12 off the levelled
    // height, past the 7.05 the def allows, but ground read to within 10 elmos
    // cannot tell that from flat.
    const coarse = ground((x) => x * 6, 10);
    expect(standsOn(marks()[0], coarse, TEN_DEGREES)).toBe("fine");
    expect(
      standsOn(
        marks()[0],
        ground((x) => x * 6),
        TEN_DEGREES,
      ),
    ).toBe("slope");
  });

  /** Which of the reasons it cannot judge a building is the answer, not that it
   *  cannot judge it. A def the game has not got and a def whose entry predates
   *  the slope field are different problems with different fixes (issue
   *  #1491). */
  it("hands back the reason it has no number to judge by", () => {
    const steep = ground((x) => x * 20);
    expect(standsOn(marks()[0], steep, "no-def")).toBe("no-def");
    expect(standsOn(marks()[0], steep, "no-slope")).toBe("no-slope");
    expect(standsOn(marks()[0], steep, "no-units")).toBe("no-units");
    expect(standsOn(marks()[0], steep, "floats")).toBe("floats");
  });

  /** The bug behind issue #1483, which was invisible because a building with no
   *  ground to stand on looked like one standing on ground that was fine. */
  it("says so when there is no ground to check against", () => {
    expect(standsOn(marks()[0], null, TEN_DEGREES)).toBe("no-ground");
  });

  /** A def the game has not got is that whether or not there is a map, so the
   *  more specific reason wins. */
  it("names the missing def before the missing ground", () => {
    expect(standsOn(marks()[0], null, "no-def")).toBe("no-def");
  });

  /** A footprint turned a quarter turn covers different ground, so the verdict
   *  turns with it. */
  it("reads the footprint the way it is turned", () => {
    const long = () => ({ x: 1, z: 6 });
    const [flat] = footprintMarks([{ ...solar, facing: 0 as const }], long);
    const [turned] = footprintMarks([{ ...solar, facing: 1 as const }], long);
    // Ground climbing along x only: the side lying across x is one square wide
    // and level, the same side turned is twelve squares wide and is not.
    const climb = ground((x) => x * 6);
    expect(standsOn(flat, climb, TEN_DEGREES)).toBe("fine");
    expect(standsOn(turned, climb, TEN_DEGREES)).toBe("slope");
  });
});

describe("unitSlopes", () => {
  it("looks a def up whatever case it was written in", () => {
    const of = unitSlopes([{ name: "armsolar", maxSlope: 10 }]);
    expect(of("ARMSOLAR")).toBeCloseTo(slopeTolerance(10), 6);
  });

  it("says a def the game has not got is one it has not got", () => {
    const of = unitSlopes([{ name: "armsolar", maxSlope: 10 }]);
    expect(of("armlab")).toBe("no-def");
  });

  /** The distinction the check rests on. A dataset read by a worker that never
   *  reported the field is saying nothing, not saying zero. */
  it("keeps a def with no slope apart from one declaring zero", () => {
    expect(unitSlopes([{ name: "armsolar" }])("armsolar")).toBe("no-slope");
    expect(unitSlopes([{ name: "armsolar", maxSlope: 0 }])("armsolar")).toBe(0);
  });

  /** A floater rests on the water, so the ground under it says nothing about
   *  whether it will stand. Left unchecked rather than checked wrongly. */
  it("says a building that floats is a floater", () => {
    const of = unitSlopes([
      { name: "armfsolar", maxSlope: 20, floatOnWater: true },
    ]);
    expect(of("armfsolar")).toBe("floats");
  });

  /**
   * The reason an editor opening on a game still being read does not accuse
   * every building of being a unit the game has not got (issue #1491). An empty
   * list is a read not finished, not a game with no units in it.
   */
  it("says the units are unread rather than the defs missing", () => {
    expect(unitSlopes([])("armsolar")).toBe("no-units");
    const unread = unitSlopes([{ name: "armsolar", maxSlope: 10 }], false);
    expect(unread("armsolar")).toBe("no-units");
  });
});

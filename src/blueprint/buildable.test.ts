import { describe, expect, it } from "vitest";

import {
  type Ground,
  slopeTolerance,
  standsOn,
  type TerrainLimits,
  unitLimits,
} from "./buildable";
import { footprintMarks } from "./footprint";

/** Ground read off a function of the corner indices, with nothing lost in the
 *  reading, which is the best case a real heightmap approaches. */
function ground(at: (x: number, z: number) => number, slack = 0): Ground {
  return {
    cornerAt: at,
    slack,
    minHeight: -1000,
    maxHeight: 1000,
    hasWater: true,
  };
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

/** What a def that declares no water limits allows, which is the engine's own
 *  default band of -10e6 to +10e6: wide enough that no ground falls outside it. */
function land(tolerance: number): TerrainLimits {
  return {
    tolerance,
    floats: false,
    waterline: 0,
    minWaterDepth: -10e6,
    maxWaterDepth: 10e6,
  };
}

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
        land(TEN_DEGREES),
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
        land(TEN_DEGREES),
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
        land(TEN_DEGREES),
      ),
    ).toBe("fine");
  });

  /** The reference height is the engine's, taken from the ground under the
   *  middle, so a building half on a step is refused even though half of it is
   *  level. */
  it("marks a building half on a step", () => {
    const step = ground((x) => (x >= 20 ? 60 : 0));
    expect(standsOn(marks()[0], step, land(TEN_DEGREES))).toBe("slope");
  });

  it("says nothing when the ground cannot be read finely enough", () => {
    // 6 elmos per heightmap square puts the far corner 12 off the levelled
    // height, past the 7.05 the def allows, but ground read to within 10 elmos
    // cannot tell that from flat.
    const coarse = ground((x) => x * 6, 10);
    expect(standsOn(marks()[0], coarse, land(TEN_DEGREES))).toBe("fine");
    expect(
      standsOn(
        marks()[0],
        ground((x) => x * 6),
        land(TEN_DEGREES),
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
    expect(standsOn(marks()[0], null, land(TEN_DEGREES))).toBe("no-ground");
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
    expect(standsOn(flat, climb, land(TEN_DEGREES))).toBe("fine");
    expect(standsOn(turned, climb, land(TEN_DEGREES))).toBe("slope");
  });
});

/**
 * The depth half of `CheckTerrainConstraints` (issue #1459), which the check
 * shipped without: the ground has to lie in `[-maxWaterDepth, -minWaterDepth]`
 * under every square the footprint covers.
 */
describe("standsOn in water", () => {
  const seabed = ground(() => -50);
  const shore = ground(() => 50);

  it("marks a land building standing in the sea", () => {
    // `maxWaterDepth` 0 is what a land building declares: the ground under it
    // may not be below the water at all.
    const limits = { ...land(TEN_DEGREES), maxWaterDepth: 0 };
    expect(standsOn(marks()[0], seabed, limits)).toBe("too-deep");
    expect(standsOn(marks()[0], shore, limits)).toBe("fine");
  });

  it("marks a naval yard standing on dry land", () => {
    // `minWaterDepth` 20 is what a yard declares: it needs at least that much
    // water over the ground it sits on.
    const limits = {
      ...land(TEN_DEGREES),
      minWaterDepth: 20,
      maxWaterDepth: 1000,
    };
    expect(standsOn(marks()[0], shore, limits)).toBe("too-shallow");
    expect(standsOn(marks()[0], seabed, limits)).toBe("fine");
  });

  it("marks a yard in water too shallow for it", () => {
    const limits = {
      ...land(TEN_DEGREES),
      minWaterDepth: 20,
      maxWaterDepth: 1000,
    };
    expect(
      standsOn(
        marks()[0],
        ground(() => -5),
        limits,
      ),
    ).toBe("too-shallow");
  });

  /**
   * Issue #1552. The two ends of the engine's band are opposite problems with
   * opposite fixes, so one answer for both is an answer nobody can act on.
   */
  it("tells the two ends of the band apart", () => {
    const yard = {
      ...land(TEN_DEGREES),
      minWaterDepth: 20,
      maxWaterDepth: 60,
    };
    expect(
      standsOn(
        marks()[0],
        ground(() => -200),
        yard,
      ),
    ).toBe("too-deep");
    expect(
      standsOn(
        marks()[0],
        ground(() => -5),
        yard,
      ),
    ).toBe("too-shallow");
  });

  /** The band widens by the reading's own error, the same way the slope
   *  tolerance does, so ground that might be deep enough is treated as deep
   *  enough. */
  it("widens the band by what the reading can hide", () => {
    const limits = { ...land(TEN_DEGREES), maxWaterDepth: 0 };
    expect(
      standsOn(
        marks()[0],
        ground(() => -5, 10),
        limits,
      ),
    ).toBe("fine");
    expect(
      standsOn(
        marks()[0],
        ground(() => -5),
        limits,
      ),
    ).toBe("too-deep");
  });

  /** A def that declares nothing gets the engine's own default band, which no
   *  ground falls outside, so the depth test is silent rather than wrong. */
  it("says nothing about depth when the def declares none", () => {
    expect(standsOn(marks()[0], seabed, land(TEN_DEGREES))).toBe("fine");
    expect(standsOn(marks()[0], shore, land(TEN_DEGREES))).toBe("fine");
  });

  /** `slopeCheck |= (isFloating && groundHeight <= 0)`. A floater rests on the
   *  water, so the seabed under it can be as broken as it likes. */
  it("lets a floater sit over a seabed no building could stand on", () => {
    const limits = {
      tolerance: 0,
      floats: true,
      waterline: 5,
      minWaterDepth: 0,
      maxWaterDepth: 1000,
    };
    // A seabed stepping between -300 and -20, all of it under water. With no
    // tolerance at all, every one of those steps would be refused on land.
    const trench = ground((x) => (x % 4 < 2 ? -300 : -20));
    expect(standsOn(marks()[0], trench, limits)).toBe("fine");
    expect(standsOn(marks()[0], trench, { ...limits, floats: false })).toBe(
      "slope",
    );
  });

  it("marks a floater beached above the water", () => {
    const limits = {
      tolerance: TEN_DEGREES,
      floats: true,
      waterline: 5,
      minWaterDepth: 0,
      maxWaterDepth: 1000,
    };
    expect(standsOn(marks()[0], shore, limits)).toBe("too-shallow");
  });

  /**
   * The mapless editor's floor sits at 0, which on a map is the water's
   * surface. Reading it that way would mark every naval building in a layout
   * that is only a shape, so ground with no water in it is asked no depth
   * question at all.
   */
  it("asks nothing about depth of ground with no water in it", () => {
    const grid: Ground = {
      cornerAt: () => 0,
      slack: 0,
      minHeight: 0,
      maxHeight: 0,
      hasWater: false,
    };
    const yard = {
      ...land(TEN_DEGREES),
      minWaterDepth: 20,
      maxWaterDepth: 1000,
    };
    expect(standsOn(marks()[0], grid, yard)).toBe("fine");
  });

  /** `GetBuildHeight` levels a floater to `-waterline` rather than to the
   *  ground, so a floater half over dry land is measured against the water it
   *  sits in and not against the average of the two. */
  it("levels a floater to its waterline rather than to the ground", () => {
    const limits = {
      tolerance: TEN_DEGREES,
      floats: true,
      waterline: 5,
      minWaterDepth: -10e6,
      maxWaterDepth: 10e6,
    };
    // Half seabed, half a bank 40 elmos above the water. The dry squares are
    // 45 off the waterline, past the 7.05 the def allows.
    const bank = ground((x) => (x >= 20 ? 40 : -60));
    expect(standsOn(marks()[0], bank, limits)).toBe("slope");
  });
});

describe("unitLimits", () => {
  it("looks a def up whatever case it was written in", () => {
    const of = unitLimits([{ name: "armsolar", maxSlope: 10 }]);
    expect(of("ARMSOLAR")).toEqual(land(slopeTolerance(10)));
  });

  it("says a def the game has not got is one it has not got", () => {
    const of = unitLimits([{ name: "armsolar", maxSlope: 10 }]);
    expect(of("armlab")).toBe("no-def");
  });

  /** The distinction the check rests on. A dataset read by a worker that never
   *  reported the field is saying nothing, not saying zero. */
  it("keeps a def with no slope apart from one declaring zero", () => {
    expect(unitLimits([{ name: "armsolar" }])("armsolar")).toBe("no-slope");
    expect(unitLimits([{ name: "armsolar", maxSlope: 0 }])("armsolar")).toEqual(
      land(0),
    );
  });

  it("reads the water a def declares", () => {
    const of = unitLimits([
      {
        name: "armfmkr",
        maxSlope: 10,
        minWaterDepth: 8,
        maxWaterDepth: 1000,
        waterline: 0,
      },
    ]);
    expect(of("armfmkr")).toEqual({
      tolerance: slopeTolerance(10),
      floats: false,
      waterline: 0,
      minWaterDepth: 8,
      maxWaterDepth: 1000,
    });
  });

  /** A floater can be judged once its waterline is known, because that is what
   *  the engine levels it to. Before that there is nothing to measure it
   *  against, so the ground stays unasked. */
  it("judges a floater that carries a waterline", () => {
    const of = unitLimits([
      {
        name: "armfsolar",
        maxSlope: 20,
        floatOnWater: true,
        waterline: 5,
        minWaterDepth: 0,
        maxWaterDepth: 1000,
      },
    ]);
    expect(of("armfsolar")).toEqual({
      tolerance: slopeTolerance(20),
      floats: true,
      waterline: 5,
      minWaterDepth: 0,
      maxWaterDepth: 1000,
    });
  });

  it("still says nothing about a floater with no waterline", () => {
    const of = unitLimits([
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
    expect(unitLimits([])("armsolar")).toBe("no-units");
    const unread = unitLimits([{ name: "armsolar", maxSlope: 10 }], false);
    expect(unread("armsolar")).toBe("no-units");
  });
});

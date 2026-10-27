/**
 * Each expected height here is worked out by hand from Zero-K's
 * `LuaRules/Gadgets/unit_terraform.lua`, and each test names the lines it
 * follows. The two wall profiles marked #4789 were measured in a real match.
 */

import { describe, expect, it } from "vitest";
import { heightGrid } from "@/placement/terrain";
import type { Rect } from "./footprint";
import type { TerrainStep } from "./model";
import {
  type GroundHeights,
  gridFromGround,
  groundFromGrid,
  type LayoutPlacement,
  terraform,
} from "./terraform";

/** A 1024 elmo square map, 129 corners a side. */
function ground(height: (x: number, z: number) => number): GroundHeights {
  const width = 129;
  const heights = new Float32Array(width * width);
  for (let r = 0; r < width; r++) {
    for (let c = 0; c < width; c++)
      heights[r * width + c] = height(c * 8, r * 8);
  }
  return { width, height: width, heights };
}

const FLAT = ground(() => 0);
/** Rising 4 elmos every 8 eastward, so 256 at x = 512. */
const EAST_SLOPE = ground((x) => x / 2);
/** Rising 2 elmos every 8 southward, so 128 at z = 512. */
const SOUTH_SLOPE = ground((_x, z) => z / 4);

const AT_CENTRE: LayoutPlacement = { at: { x: 512, z: 512 }, quarters: 0 };

function heightAt(g: GroundHeights, x: number, z: number): number {
  return g.heights[(z / 8) * g.width + x / 8];
}

/** Within a hundredth. A ramp's end is nudged 0.1 elmos off its
 *  axis (line 674), which puts its heights a little off whole numbers. */
function expectClose(actual: number[], expected: number[]): void {
  expect(actual).toHaveLength(expected.length);
  actual.forEach((h, i) => {
    expect(h).toBeCloseTo(expected[i], 2);
  });
}

/** Heights every 8 elmos from a point, along a direction. */
function profile(
  g: GroundHeights,
  from: { x: number; z: number },
  step: { x: number; z: number },
  count: number,
): number[] {
  return Array.from({ length: count }, (_, i) =>
    heightAt(g, from.x + step.x * i, from.z + step.z * i),
  );
}

/** A wall along x through the placement, 256 elmos long. */
function wall(height: number, before = 0): TerrainStep {
  return {
    kind: "raise",
    shape: "wall",
    points: [
      { x: -128, z: 0 },
      { x: 128, z: 0 },
    ],
    height,
    before,
  };
}

/** A 128 elmo square outline centred on the placement. */
function pad(kind: "level" | "raise", height: number): TerrainStep {
  return {
    kind,
    shape: "area",
    points: [
      { x: -64, z: -64 },
      { x: 64, z: -64 },
      { x: 64, z: 64 },
      { x: -64, z: 64 },
    ],
    height,
    before: 0,
  };
}

const SOUTH = { x: 0, z: 8 };
const NORTH = { x: 0, z: -8 };
const EAST = { x: 8, z: 0 };
const CENTRE = { x: 512, z: 512 };

describe("a raised wall", () => {
  // Lines 1188-1189 raise the 5 by 5 corners round each wall point, so the top
  // is 32 elmos across. Lines 2663-2721 drop the first square out by 28, lines
  // 2785-2873 and `GetHeightDiffLocal` (2563-2569) another 28 a square, and
  // lines 2741-2777 and 2875-2910 leave a 4 elmo lip where the slope meets the
  // ground.
  it("raised by 112 has the slope measured in a Zero-K match (#4789)", () => {
    const { ground: g } = terraform(FLAT, [wall(112)], AT_CENTRE, []);
    const measured = [112, 112, 112, 84, 56, 28, 4, 0];
    expect(profile(g, CENTRE, SOUTH, 8)).toEqual(measured);
    expect(profile(g, CENTRE, NORTH, 8)).toEqual(measured);
  });

  it("raised by 70 has the slope measured in a Zero-K match (#4789)", () => {
    const { ground: g } = terraform(FLAT, [wall(70)], AT_CENTRE, []);
    expect(profile(g, CENTRE, SOUTH, 7)).toEqual([70, 70, 70, 42, 14, 4, 0]);
  });

  it("slopes off its ends as well as its sides", () => {
    // The east end snaps to x = 640 and its top reaches 16 further, line 1101.
    const { ground: g } = terraform(FLAT, [wall(70)], AT_CENTRE, []);
    expect(profile(g, { x: 656, z: 512 }, EAST, 5)).toEqual([70, 42, 14, 4, 0]);
  });

  it("reports the slope it added as corners outside the step", () => {
    const { steps } = terraform(FLAT, [wall(70)], AT_CENTRE, []);
    const slope = steps[0].slope;
    expect(slope).toContainEqual({ x: 512, z: 536 });
    expect(slope).toContainEqual({ x: 512, z: 552 });
    expect(slope).not.toContainEqual({ x: 512, z: 528 });
    expect(steps[0].shape).toContainEqual({ x: 512, z: 528 });
  });
});

describe("a dug trench", () => {
  // A dug point is not a pyramid (line 2666), so its first square only rises 8
  // (`maxHeightDiffDownInner`, lines 2689 and 112), and the squares after rise
  // 28 each from there (`GetHeightDiffLocal` with an inner edge, lines
  // 2554-2561). The lip is 4 (lines 2748-2751 and 2882-2885).
  it("slopes up gently at first and then at 28 a square", () => {
    const { ground: g } = terraform(FLAT, [wall(-50)], AT_CENTRE, []);
    const expected = [-50, -50, -50, -42, -14, -4, 0];
    expect(profile(g, CENTRE, SOUTH, 7)).toEqual(expected);
    expect(profile(g, CENTRE, NORTH, 7)).toEqual(expected);
  });
});

describe("level", () => {
  it("sets an area to the height above the pivot, on flat ground", () => {
    // Line 1796. The outline snaps down to 16 (line 1499), and each inside cell
    // fills its far edges too (lines 1668-1707), so the pad runs from 448 to
    // 592. Then 40 - 28 = 12, and a lip of 4.
    const { ground: g } = terraform(FLAT, [pad("level", 40)], AT_CENTRE, []);
    expect(profile(g, { x: 432, z: 512 }, EAST, 24)).toEqual([
      4,
      12,
      ...Array(19).fill(40),
      12,
      4,
      0,
    ]);
  });

  it("raises the low side and cuts into the high side, on a slope", () => {
    // The pivot's ground is 256, so the pad levels to 256. West of it the pad
    // is raised (a pyramid, line 2666): 256 - 28 = 228 at x = 440, then 256
    // against 216 is within 56, and 216 is not below 212 + 4, so no lip. East
    // it is cut (lines 2689 and 2556): 256 + 8 = 264 at 600, 256 + 36 = 292 at
    // 608, then the ground at 616 is within 64 and no lip, because 308 is not
    // above 312 - 4.
    const { ground: g } = terraform(
      EAST_SLOPE,
      [pad("level", 0)],
      AT_CENTRE,
      [],
    );
    expect(profile(g, { x: 424, z: 512 }, EAST, 4)).toEqual([
      212, 216, 228, 256,
    ]);
    expect(heightAt(g, 592, 512)).toBe(256);
    expect(profile(g, { x: 600, z: 512 }, EAST, 4)).toEqual([
      264, 292, 308, 312,
    ]);
  });
});

describe("raise", () => {
  // Zero-K builds a slope up gradually and reads the ground again at each
  // update. The lip (lines 2741-2777) goes in first, so by the time the slope
  // would drop to less than the lip, the ground there is already the lip's 4
  // and the slope's check (line 2693) measures from that. A pad raised by 40
  // would put its diagonal corner at 40 - 28 * sqrt 2 = 0.4. The match
  // measured 4 (#4805).
  it("keeps the 4 elmo foot on the diagonal of a pad raised by 40 (#4805)", () => {
    const { ground: g } = terraform(FLAT, [pad("raise", 40)], AT_CENTRE, []);
    for (const [x, z] of [
      [440, 440],
      [600, 440],
      [440, 600],
      [600, 600],
    ]) {
      expect(heightAt(g, x, z)).toBe(4);
    }
    // straight out from an edge it is 12, then the foot
    expect(profile(g, { x: 432, z: 512 }, EAST, 4)).toEqual([4, 12, 40, 40]);
  });

  it("adds its height to the ground under each point, on a slope", () => {
    // Line 1807: each point's own ground plus 40. West, 264 - 28 = 236 over
    // ground of 220 at x = 440. At 432, 264 is within 56 of 216, and 216 is
    // not below the next ground, 212, plus 4, so no lip. East, 336 - 28 = 308
    // over 300 at 600, and 304 + 4 is not below 308, so no lip at 608.
    const { ground: g } = terraform(
      EAST_SLOPE,
      [pad("raise", 40)],
      AT_CENTRE,
      [],
    );
    expect(profile(g, { x: 432, z: 512 }, EAST, 4)).toEqual([
      216, 236, 264, 268,
    ]);
    expect(heightAt(g, 592, 512)).toBe(336);
    expect(profile(g, { x: 600, z: 512 }, EAST, 3)).toEqual([308, 304, 308]);
  });
});

describe("a level or ramp that only raises or only lowers (#4804)", () => {
  // `checkPointCreation`, lines 523-535, with the order's volume selection: a
  // point that would move the other way is never made, so it is not in the step.
  // A rock of 30 stands in the pad's south-east, clear of the pivot at 512.
  const rock = ground((x, z) =>
    x >= 520 && x <= 584 && z >= 520 && z <= 584 ? 30 : 0,
  );
  const plaza = (only?: "raise" | "lower"): TerrainStep => ({
    kind: "level",
    shape: "area",
    points: [
      { x: -96, z: -96 },
      { x: 96, z: -96 },
      { x: 96, z: 96 },
      { x: -96, z: 96 },
    ],
    height: 5,
    before: 0,
    ...(only ? { only } : {}),
  });

  it("with no choice cuts the rock down to the plaza, line 523", () => {
    const { ground: g } = terraform(rock, [plaza()], AT_CENTRE, []);
    expect(heightAt(g, 552, 552)).toBe(5);
    expect(heightAt(g, 480, 480)).toBe(5);
  });

  it("only raise fills the low ground and leaves the rock standing", () => {
    const { ground: g } = terraform(rock, [plaza("raise")], AT_CENTRE, []);
    expect(heightAt(g, 480, 480)).toBe(5);
    expect(heightAt(g, 512, 512)).toBe(5);
    expect(heightAt(g, 552, 552)).toBe(30);
  });

  it("only lower cuts the rock and leaves the low ground alone", () => {
    const { ground: g } = terraform(rock, [plaza("lower")], AT_CENTRE, []);
    expect(heightAt(g, 552, 552)).toBe(5);
    expect(heightAt(g, 480, 480)).toBe(0);
    expect(heightAt(g, 512, 512)).toBe(0);
  });

  it("skips a point already at the height, line 527", () => {
    const flat = ground(() => 5);
    for (const only of ["raise", "lower"] as const) {
      const { ground: g, metal } = terraform(
        flat,
        [{ ...plaza(only), height: 0 }],
        AT_CENTRE,
        [],
      );
      expect(g.heights.every((h) => h === 5)).toBe(true);
      expect(metal).toBe(0);
    }
  });

  it("costs only the ground it changes", () => {
    const both = terraform(rock, [plaza()], AT_CENTRE, []).metal;
    const raise = terraform(rock, [plaza("raise")], AT_CENTRE, []).metal;
    const lower = terraform(rock, [plaza("lower")], AT_CENTRE, []).metal;
    expect(raise).toBeLessThan(both);
    expect(lower).toBeLessThan(both);
  });

  it("applies to a ramp: only raise leaves ground the ramp would cut", () => {
    // The pivot's ground is 40 and the ramp climbs from 40 to 104 over ground
    // that is 100 from x = 560 on.
    const hill = ground((x) => (x >= 560 ? 100 : 40));
    const ramp: TerrainStep = {
      kind: "ramp",
      shape: "wall",
      points: [
        { x: -128, z: 0 },
        { x: 128, z: 0 },
      ],
      heights: [0, 64],
      width: 64,
      before: 0,
    };
    const both = terraform(hill, [ramp], AT_CENTRE, []).ground;
    const raise = terraform(hill, [{ ...ramp, only: "raise" }], AT_CENTRE, []);
    const lower = terraform(hill, [{ ...ramp, only: "lower" }], AT_CENTRE, []);
    // At x = 576 the ramp is at 40 + 64 * 192 / 256 = 88, under the ground's 100.
    expect(heightAt(both, 576, 512)).toBeCloseTo(88, 1);
    expect(heightAt(raise.ground, 576, 512)).toBe(100);
    expect(heightAt(lower.ground, 576, 512)).toBeCloseTo(88, 1);
    // Where the ramp is above the flat 40, only lower has nothing to do.
    expect(heightAt(both, 448, 512)).toBeCloseTo(56, 1);
    expect(heightAt(raise.ground, 448, 512)).toBeCloseTo(56, 1);
    expect(heightAt(lower.ground, 448, 512)).toBe(40);
  });
});

describe("ramp", () => {
  const ramp: TerrainStep = {
    kind: "ramp",
    shape: "wall",
    points: [
      { x: -128, z: 0 },
      { x: 128, z: 0 },
    ],
    heights: [0, 64],
    width: 64,
    before: 0,
  };

  it("climbs evenly from one end's height to the other's, on flat ground", () => {
    // `pointHeight`, line 489, along the band of `TerraformRamp`, lines
    // 800-872. Past the high end, 64 - 28 = 36, 64 - 56 = 8, then a lip of 4.
    const { ground: g } = terraform(FLAT, [ramp], AT_CENTRE, []);
    expectClose(
      profile(g, { x: 384, z: 512 }, { x: 32, z: 0 }, 9),
      [0, 8, 16, 24, 32, 40, 48, 56, 64],
    );
    expectClose(profile(g, { x: 648, z: 512 }, EAST, 4), [36, 8, 4, 0]);
  });

  it("measures its heights from the pivot's ground, on a slope", () => {
    // The pivot's ground is 128, so the ends are 128 and 192, whatever the
    // ground does across the ramp.
    const { ground: g } = terraform(SOUTH_SLOPE, [ramp], AT_CENTRE, []);
    expectClose(
      profile(g, { x: 384, z: 512 }, { x: 64, z: 0 }, 5),
      [128, 144, 160, 176, 192],
    );
    // At x = 512 the ramp is 160 from z = 488 to 544. North, 160 - 28 = 132
    // over ground of 120 at 480, then a lip at 472 of the next ground, 116,
    // plus 4. South, 160 is within 28 of the ground's 138 at 552, so there is
    // only a lip: the next ground, 140, plus 4.
    expectClose(
      profile(g, { x: 512, z: 472 }, SOUTH, 13),
      [120, 132, 160, 160, 160, 160, 160, 160, 160, 160, 144, 140, 142],
    );
  });

  it("is refused when shorter than 64 elmos, line 679", () => {
    const short = { ...ramp, points: [ramp.points[0], { x: -80, z: 0 }] };
    const result = terraform(FLAT, [short], AT_CENTRE, []);
    expect(result.steps[0]).toMatchObject({ outcome: "refused", metal: 0 });
    expect(result.ground.heights.every((h) => h === 0)).toBe(true);
  });
});

describe("smooth", () => {
  it("sets each point to the average of the 5 by 5 corners round it", () => {
    // Lines 1329-1339, on ground that steps from 0 to 40 at x = 512. The wall
    // covers x = 496 to 528. At 496 one column of five is 40, so 8, and so on
    // up to 40. West of it the lip is 4, east the ground is already 40.
    const steps = ground((x) => (x >= 512 ? 40 : 0));
    const smooth: TerrainStep = {
      kind: "smooth",
      shape: "wall",
      points: [
        { x: 0, z: -64 },
        { x: 0, z: 64 },
      ],
      before: 0,
    };
    const { ground: g } = terraform(steps, [smooth], AT_CENTRE, []);
    expect(profile(g, { x: 480, z: 512 }, EAST, 8)).toEqual([
      0, 4, 8, 16, 24, 32, 40, 40,
    ]);
  });

  it("changes nothing and costs nothing on flat ground, line 1892", () => {
    const smooth: TerrainStep = {
      kind: "smooth",
      shape: "area",
      points: pad("level", 0).points,
      before: 0,
    };
    const result = terraform(FLAT, [smooth], AT_CENTRE, []);
    expect(result.metal).toBe(0);
    expect(result.ground.heights.every((h) => h === 0)).toBe(true);
  });
});

describe("a slope meeting a building", () => {
  // South of the wall, its top edge is 16 rows of corners from the building,
  // whose north edge is at z = 544 (`RegisterStructure`, lines 3527-3563).
  const building: Rect = { minX: 448, maxX: 576, minZ: 544, maxZ: 608 };

  it("cuts the wall back so its slope ends at the building", () => {
    // The slope from z = 528 would need the corner at 544 raised, so that
    // point is dropped (lines 2857-2865) and the slope worked out again
    // (lines 3179-3192). The same happens to the row at 520. From 512 the
    // slope is 72, 44, 16 and the building's edge is left at 0.
    const { ground: g } = terraform(FLAT, [wall(100, 1)], AT_CENTRE, [
      building,
    ]);
    expect(profile(g, CENTRE, SOUTH, 5)).toEqual([100, 72, 44, 16, 0]);
    expect(profile(g, CENTRE, NORTH, 8)).toEqual([
      100, 100, 100, 72, 44, 16, 4, 0,
    ]);
  });

  it("ignores a building that comes after the step", () => {
    // A building blocks terraform once it exists, lines 3582-3622.
    const { ground: g } = terraform(FLAT, [wall(100, 0)], AT_CENTRE, [
      building,
    ]);
    expect(profile(g, CENTRE, SOUTH, 8)).toEqual([
      100, 100, 100, 72, 44, 16, 4, 0,
    ]);
  });

  it("leaves the ground under a building inside the step alone", () => {
    // `SetupPointStructure`, lines 425-435.
    const under: Rect = { minX: 496, maxX: 528, minZ: 496, maxZ: 528 };
    const { ground: g } = terraform(FLAT, [wall(20, 1)], AT_CENTRE, [under]);
    expect(heightAt(g, 512, 512)).toBe(0);
    expect(heightAt(g, 560, 512)).toBe(20);
  });
});

describe("two steps", () => {
  it("do not add up where they overlap", () => {
    // A raise aims at the ground when it was ordered plus its height (line
    // 1319), and every step is ordered when the blueprint is placed. So where
    // two walls of 40 cross, the second aims at 40 too.
    const across: TerrainStep = {
      ...wall(40),
      points: [
        { x: 0, z: -128 },
        { x: 0, z: 128 },
      ],
    };
    const { ground: g } = terraform(FLAT, [wall(40), across], AT_CENTRE, []);
    expect(heightAt(g, 512, 512)).toBe(40);
    expect(heightAt(g, 512, 600)).toBe(40);
    expect(heightAt(g, 600, 512)).toBe(40);
  });

  it("are built in build order, and a later one works on the ground before it", () => {
    // The trench comes first in build order though second in the list, and
    // leaves -30, -22 and a lip of -4. The wall then aims at the original 0 +
    // 30 (line 1319) and works its slope out on the trench's ground (line
    // 2419): 30 - 28 = 2 over the trench's -22, then -4 is within 56 of 30,
    // so the lip is the next square's ground, 0, plus 4.
    const trench = { ...wall(-30), before: 0 };
    const raised = { ...wall(30), before: 1 };
    const result = terraform(FLAT, [raised, trench], AT_CENTRE, []);
    expect(result.steps.map((s) => s.index)).toEqual([1, 0]);
    expect(profile(result.ground, CENTRE, SOUTH, 6)).toEqual([
      30, 30, 30, 2, 4, 0,
    ]);
  });
});

describe("a turned and flipped layout", () => {
  const east: TerrainStep = {
    ...wall(40),
    points: [
      { x: 0, z: 0 },
      { x: 128, z: 0 },
    ],
  };

  it("raises the wall where the turn puts it", () => {
    // A quarter turn sends (128, 0) to (0, -128), as the widget's `place.lua`.
    const { ground: g } = terraform(
      FLAT,
      [east],
      { at: CENTRE, quarters: 1 },
      [],
    );
    expect(heightAt(g, 512, 448)).toBe(40);
    expect(heightAt(g, 576, 512)).toBe(0);
  });

  it("raises the wall where the flip puts it", () => {
    const { ground: g } = terraform(
      FLAT,
      [east],
      { at: CENTRE, quarters: 0, flip: { x: true } },
      [],
    );
    expect(heightAt(g, 448, 512)).toBe(40);
    expect(heightAt(g, 576, 512)).toBe(0);
  });

  it("turns before it flips", () => {
    const { ground: g } = terraform(
      FLAT,
      [east],
      { at: CENTRE, quarters: 1, flip: { z: true } },
      [],
    );
    expect(heightAt(g, 512, 576)).toBe(40);
    expect(heightAt(g, 512, 448)).toBe(0);
  });

  it("turns about the layout's origin", () => {
    const { ground: g } = terraform(
      FLAT,
      [east],
      { at: CENTRE, origin: { x: 64, z: 0 }, quarters: 2 },
      [],
    );
    // (0, 0) and (128, 0) about (64, 0) by half a turn swap, then land with
    // (64, 0) on the centre: the wall runs from 448 to 576.
    expect(heightAt(g, 448, 512)).toBe(40);
    expect(heightAt(g, 576, 512)).toBe(40);
  });
});

describe("metal", () => {
  const one: TerrainStep = { ...wall(100), points: [{ x: 0, z: 0 }] };

  it("is the gadget's own estimate for a terraunit", () => {
    // One point raises 25 corners by 100, one terraunit (lines 1294-1410).
    // Volume: 2500 x 0.0128 x 0.5 = 16. Perimeter: 4 corners at 1.4 and 12
    // sides at 1, each times min(100, 10), is 176, times 0.15 x 0.5 = 13.2.
    // Base 6. Slope estimate, lines 1399-1404: for each of the 16 edge
    // corners, ((100 - 16) x (3 - 1) x 0.5 + 3 x 16) x 0.0064 = 0.8448.
    // 16 + 13.2 + 6 + 13.5168 = 48.7168.
    const result = terraform(FLAT, [one], AT_CENTRE, []);
    expect(result.metal).toBeCloseTo(48.7168, 9);
    expect(result.steps[0].metal).toBeCloseTo(48.7168, 9);
  });

  it("scales by the terracostmult mod option, but not the base cost", () => {
    // Lines 157-166: 32 + 26.4 + 6 + 27.0336.
    const result = terraform(FLAT, [one], AT_CENTRE, [], { costMult: 2 });
    expect(result.metal).toBeCloseTo(91.4336, 9);
  });

  it("adds up across steps", () => {
    const result = terraform(FLAT, [one, one], AT_CENTRE, []);
    expect(result.metal).toBeCloseTo(2 * 48.7168, 9);
  });
});

describe("grid conversion", () => {
  it("reads a grid's words as elmos the way cornerGround does", () => {
    const bytes = new Uint16Array([0, 32768, 65535, 16384]).buffer;
    const grid = heightGrid(bytes, 2, 2);
    if (!grid) throw new Error("grid did not read");
    const g = groundFromGrid(grid, -100, 412);
    expect(Array.from(g.heights)).toEqual([
      -100,
      156,
      -100 + (65535 * 512) / 65536,
      28,
    ]);
  });

  it("writes ground back with a range that holds it", () => {
    const g: GroundHeights = {
      width: 2,
      height: 2,
      heights: Float32Array.from([-20, 0, 100, 300]),
    };
    const back = gridFromGround(g);
    expect(back.minHeight).toBe(-20);
    expect(back.grid.words[0]).toBe(0);
    expect(back.grid.words[3]).toBe(65535);
    const again = groundFromGrid(back.grid, back.minHeight, back.maxHeight);
    for (let i = 0; i < 4; i++) {
      expect(again.heights[i]).toBeCloseTo(g.heights[i], 2);
    }
  });
});

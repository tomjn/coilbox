import { describe, expect, it } from "vitest";
import { slopeTolerance, standsOn } from "@/blueprint/buildable";
import {
  areas,
  type BuildingSpec,
  buildableShare,
  buildingSpecs,
  clearance,
  type Heights,
  type MoveClassSpec,
  maxSlopeValue,
  measurePlayability,
  moveClassSpecs,
  passableCells,
  slopeMap,
} from "./playability";

/** A map of `squares` by `squares` with corner heights from `at`, in elmos,
 *  over a 0..1000 range so a word is a sixty-fifth of an elmo. */
function heights(
  squares: number,
  at: (x: number, z: number) => number,
  squaresZ = squares,
): Heights {
  const width = squares + 1;
  const height = squaresZ + 1;
  const words = new Uint16Array(width * height);
  for (let z = 0; z < height; z++)
    for (let x = 0; x < width; x++)
      words[z * width + x] = Math.round(((at(x, z) + 500) / 1000) * 65536);
  return { words, width, height, minHeight: -500, maxHeight: 500 };
}

const kbot = (maxSlope: number, depth = 1e6): MoveClassSpec => ({
  name: "kbot",
  kind: "kbot",
  footprint: 2,
  maxSlope,
  depth,
});

const building = (over: Partial<BuildingSpec> = {}): BuildingSpec => ({
  name: "b",
  defs: 1,
  footprintX: 2,
  footprintZ: 2,
  maxSlope: 10,
  minWaterDepth: -10e6,
  maxWaterDepth: 10e6,
  ...over,
});

describe("maxSlopeValue", () => {
  it("is DegreesToMaxSlope: clamp to 60, times 1.5, 1 - cos", () => {
    expect(maxSlopeValue(0)).toBe(0);
    expect(maxSlopeValue(60)).toBeCloseTo(1, 12);
    expect(maxSlopeValue(90)).toBeCloseTo(1, 12);
    expect(maxSlopeValue(20)).toBeCloseTo(1 - Math.cos(Math.PI / 6), 12);
  });
});

describe("slopeMap", () => {
  it("is zero on flat ground", () => {
    const map = slopeMap(heights(8, () => 10));
    expect(map.cellsX).toBe(4);
    expect(Math.max(...map.slope)).toBeCloseTo(0, 6);
    expect(map.top[0]).toBeCloseTo(10, 1);
  });

  it("matches 1 - ny on an even ramp, where every face agrees", () => {
    // A rise of 8 elmos per 8 elmo square is 45 degrees.
    const map = slopeMap(heights(8, (x) => x * 8));
    expect(map.slope[5]).toBeCloseTo(1 - Math.SQRT1_2, 3);
  });
});

describe("passability", () => {
  // A ridge two squares wide down the middle, 200 elmos high.
  const ridge = (gapFrom = -1, gapTo = -1) =>
    heights(32, (x, z) =>
      x >= 15 && x <= 17 && !(z >= gapFrom && z <= gapTo) ? 200 : 0,
    );

  it("splits a map in two at a cliff a kbot cannot climb", () => {
    const r = measurePlayability({
      heights: ridge(),
      classes: [kbot(30)],
      buildings: [],
      starts: [],
    });
    const c = r.classes[0];
    expect(c.areas).toBe(2);
    expect(c.largest).toBeLessThan(0.5);
    const westEast = c.ways[0];
    expect(westEast.width).toBeNull();
    // North to south runs down either side.
    expect(c.ways[1].width).not.toBeNull();
  });

  it("measures the gap in the cliff as the narrowest point", () => {
    // Corners 8..19 are low, which leaves cells 4..8 clear of the ridge's
    // faces: five cells, 80 elmos.
    const r = measurePlayability({
      heights: ridge(8, 19),
      classes: [kbot(30)],
      buildings: [],
      starts: [],
    });
    const c = r.classes[0];
    expect(c.areas).toBe(1);
    expect(c.ways[0].width).toBe(5 * 16);
    // Either of the two cells in the gap's middle column pair.
    expect([7 * 16 + 8, 8 * 16 + 8]).toContain(c.ways[0].x);
    expect(c.ways[0].z).toBe(6 * 16 + 8);
  });

  it("joins start positions across the gap and not across the cliff", () => {
    const starts = [
      { x: 40, z: 40 },
      { x: 220, z: 40 },
    ];
    const open = measurePlayability({
      heights: ridge(8, 19),
      classes: [kbot(30)],
      buildings: [],
      starts,
    });
    expect(open.classes[0].ways).toHaveLength(1);
    expect(open.classes[0].ways[0].width).toBe(80);
    expect(open.classes[0].ways[0].from).toEqual({ kind: "start", index: 0 });
    const shut = measurePlayability({
      heights: ridge(),
      classes: [kbot(30)],
      buildings: [],
      starts,
    });
    expect(shut.classes[0].ways[0].width).toBeNull();
  });

  it("does not count the ground beside a start as the narrow point", () => {
    // Open flat ground, with both starts one cell in from the middle of the
    // west and east edges.
    const r = measurePlayability({
      heights: heights(64, () => 0),
      classes: [kbot(30)],
      buildings: [],
      starts: [
        { x: 8, z: 256 },
        { x: 500, z: 256 },
      ],
    });
    // The widest way runs through the middle of the 32 cell map, 31 cells
    // wide by the odd gap rule.
    expect(r.classes[0].ways[0].width).toBeGreaterThanOrEqual(30 * 16);
  });

  it("lets a class with a steep enough maxSlope over the cliff", () => {
    const r = measurePlayability({
      heights: ridge(),
      classes: [kbot(60)],
      buildings: [],
      starts: [],
    });
    expect(r.classes[0].passable).toBe(1);
    expect(r.classes[0].areas).toBe(1);
  });

  it("tests water per kind, as GetPosSpeedMod does", () => {
    // A sea 50 elmos deep down the middle.
    // The shore is a gentle 5 elmos a square, so slope stops nothing.
    const map = slopeMap(
      heights(32, (x) =>
        Math.min(10, Math.max(-50, Math.abs(x - 16) * 5 - 50)),
      ),
    );
    const count = (pass: Uint8Array) => pass.reduce((a, b) => a + b, 0);
    const deepKbot = passableCells(map, kbot(30));
    const shallowKbot = passableCells(map, kbot(30, 20));
    const hover = passableCells(map, {
      ...kbot(30),
      kind: "hover",
    });
    const ship = passableCells(map, {
      ...kbot(0),
      kind: "ship",
      maxSlope: null,
      depth: 10,
    });
    expect(count(deepKbot)).toBe(256);
    expect(count(shallowKbot)).toBeLessThan(256);
    expect(count(hover)).toBe(256);
    expect(count(ship) + count(shallowKbot)).toBeLessThanOrEqual(256);
    expect(count(ship)).toBeGreaterThan(0);
  });
});

describe("clearance", () => {
  it("is the exact squared distance to the nearest wall or edge", () => {
    const cellsX = 23;
    const cellsZ = 17;
    let seed = 7;
    const rand = () => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31;
      return seed / 2 ** 31;
    };
    const pass = new Uint8Array(cellsX * cellsZ).map(() =>
      rand() < 0.85 ? 1 : 0,
    );
    const d2 = clearance(pass, cellsX, cellsZ);
    for (let z = 0; z < cellsZ; z++) {
      for (let x = 0; x < cellsX; x++) {
        let best = Infinity;
        for (let bz = -1; bz <= cellsZ; bz++) {
          for (let bx = -1; bx <= cellsX; bx++) {
            const inside = bx >= 0 && bz >= 0 && bx < cellsX && bz < cellsZ;
            if (inside && pass[bz * cellsX + bx]) continue;
            best = Math.min(best, (bx - x) ** 2 + (bz - z) ** 2);
          }
        }
        expect(d2[z * cellsX + x]).toBe(pass[z * cellsX + x] ? best : 0);
      }
    }
  });
});

describe("areas", () => {
  it("joins cells corner to corner", () => {
    const pass = Uint8Array.from([1, 0, 0, 1]);
    expect(areas(pass, 2, 2).sizes).toEqual([2]);
  });
});

describe("buildableShare", () => {
  it("takes every position on flat ground", () => {
    const r = buildableShare(
      heights(16, () => 0),
      building(),
    );
    // 8 build squares a side, a footprint of 2: 7 by 7 positions.
    expect(r.positions).toBe(49);
    expect(r.buildable).toBe(1);
  });

  it("takes nothing on hummocks a kbot walks over", () => {
    // 40 elmo bumps every other corner: passable at maxSlope 60, buildable
    // nowhere at 10 degrees, which tolerates about 7 elmos.
    const h = heights(16, (x, z) =>
      (Math.floor(x / 2) + Math.floor(z / 2)) % 2 ? 40 : 0,
    );
    expect(buildableShare(h, building()).buildable).toBe(0);
    const r = measurePlayability({
      heights: h,
      classes: [kbot(60)],
      buildings: [],
      starts: [],
    });
    expect(r.classes[0].passable).toBe(1);
  });

  it("refuses ground outside the def's water band", () => {
    const r = buildableShare(
      heights(16, () => -30),
      building({ maxWaterDepth: 20 }),
    );
    expect(r.buildable).toBe(0);
  });

  it("agrees with standsOn at every position on rough ground", () => {
    let seed = 11;
    const rand = () => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31;
      return seed / 2 ** 31;
    };
    const h = heights(32, () => Math.round(rand() * 6) * 6);
    const step = (h.maxHeight - h.minHeight) / 65536;
    const ground = {
      cornerAt: (x: number, z: number) => {
        const cx = Math.min(h.width - 1, Math.max(0, x));
        const cz = Math.min(h.height - 1, Math.max(0, z));
        return h.minHeight + h.words[cz * h.width + cx] * step;
      },
      slack: 0,
      minHeight: h.minHeight,
      maxHeight: h.maxHeight,
      hasWater: false,
    };
    for (const spec of [
      building({ footprintX: 3, footprintZ: 2, maxSlope: 15 }),
      building({ footprintX: 4, footprintZ: 4, maxSlope: 25 }),
    ]) {
      let fine = 0;
      let positions = 0;
      for (let z = 0; z + spec.footprintZ <= 16; z++) {
        for (let x = 0; x + spec.footprintX <= 16; x++) {
          positions++;
          const pos = {
            x: (2 * x + spec.footprintX) * 8,
            z: (2 * z + spec.footprintZ) * 8,
          };
          const standing = standsOn(
            {
              pos,
              facing: 0,
              footprint: { x: spec.footprintX, z: spec.footprintZ },
            },
            ground,
            {
              tolerance: slopeTolerance(spec.maxSlope),
              floats: false,
              waterline: 0,
              minWaterDepth: spec.minWaterDepth,
              maxWaterDepth: spec.maxWaterDepth,
            },
          );
          if (standing === "fine") fine++;
        }
      }
      const r = buildableShare(h, spec);
      expect(r.positions).toBe(positions);
      expect(r.buildable).toBeCloseTo(fine / positions, 12);
      expect(fine).toBeGreaterThan(0);
      expect(fine).toBeLessThan(positions);
    }
  });
});

describe("game specs", () => {
  it("reads movement classes with the engine's defaults", () => {
    expect(
      moveClassSpecs([
        { name: "TANK3", footprintx: 3, maxslope: 18, maxwaterdepth: 22 },
        { name: "HOVER2" },
        { name: "BOAT4", minwaterdepth: 8 },
        { name: "KBOT1" },
        { footprintx: 2 },
      ]),
    ).toEqual([
      { name: "TANK3", kind: "tank", footprint: 3, maxSlope: 18, depth: 22 },
      { name: "HOVER2", kind: "hover", footprint: 1, maxSlope: 15, depth: 1e6 },
      { name: "BOAT4", kind: "ship", footprint: 1, maxSlope: null, depth: 8 },
      { name: "KBOT1", kind: "kbot", footprint: 1, maxSlope: 60, depth: 1e6 },
    ]);
  });

  it("picks the commonest building shape and the largest", () => {
    const specs = buildingSpecs({
      mex: { footprintx: 3, footprintz: 3, maxslope: 30 },
      solar: { footprintx: 3, footprintz: 3, maxslope: 30 },
      wall: { footprintx: 3, footprintz: 3, maxslope: 30 },
      factory: { footprintx: 7, footprintz: 6, maxslope: 15 },
      tank: { footprintx: 3, footprintz: 3, movementclass: "TANK3" },
      plane: { footprintx: 3, footprintz: 3, canfly: true },
      buoy: { footprintx: 5, footprintz: 5, floater: true },
    });
    expect(specs.map((s) => [s.name, s.defs])).toEqual([
      ["mex", 3],
      ["factory", 1],
    ]);
    expect(specs[1].maxSlope).toBe(15);
  });
});

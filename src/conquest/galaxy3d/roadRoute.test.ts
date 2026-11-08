import { describe, expect, it } from "vitest";
import {
  cheapestCells,
  type MapXY,
  markRivers,
  markRoad,
  ROUTE_MAX_CELLS,
  roundCorners,
  routeGrid,
  routeRoad,
  SEA_LEVEL,
  simplifyLine,
} from "./roadRoute";
import type { HeightGrid } from "./terrain";

const SIZE = 64;
/** A grid of heights from a function of the pixel. */
const grid = (at: (x: number, y: number) => number): HeightGrid => {
  const data = new Float32Array(SIZE * SIZE);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) data[y * SIZE + x] = at(x, y);
  }
  return { data, width: SIZE, height: SIZE };
};

// A map 630 map units across, so a cell is 10 map units.
const MAP = (SIZE - 1) * 10;
// Low land with a steep ridge across the middle row band, broken by a pass
// at the left.
const ridge = routeGrid(
  MAP,
  MAP,
  64,
  1,
  grid((x, y) => (Math.abs(y - 32) < 3 && x > 12 ? 1 : 0.1)),
);
// Low land with a lake in the middle.
const lake = routeGrid(
  MAP,
  MAP,
  64,
  1,
  grid((x, y) => (Math.hypot(x - 32, y - 32) < 12 ? 0 : 0.1)),
);
const flat = routeGrid(MAP, MAP, 64, 1);

const heightAt = (g: typeof ridge, [x, y]: MapXY) =>
  g.height[Math.round(y / g.stepY) * g.cols + Math.round(x / g.stepX)];
const length = (line: MapXY[]) =>
  line.reduce(
    (sum, p, k) =>
      k === 0
        ? 0
        : sum + Math.hypot(p[0] - line[k - 1][0], p[1] - line[k - 1][1]),
    0,
  );

describe("routeGrid", () => {
  it("reads a heightmap at no more than the cell cap, keeping its shape", () => {
    const wide: HeightGrid = {
      data: new Float32Array(1024 * 512),
      width: 1024,
      height: 512,
    };
    const g = routeGrid(2000, 1000, 64, 1, wide);
    expect(g.cols).toBe(ROUTE_MAX_CELLS);
    expect(g.rows).toBe(ROUTE_MAX_CELLS / 2);
    expect(g.stepX).toBeCloseTo(2000 / (ROUTE_MAX_CELLS - 1));
  });

  it("gives a map with no heightmap a flat grid", () => {
    expect(flat.cols).toBeGreaterThan(1);
    expect(flat.height.every((h) => h === 0)).toBe(true);
    // All land, though every height is 0, which is the sea on a heightmap.
    expect(flat.hasSea).toBe(false);
    expect(ridge.hasSea).toBe(true);
  });
});

describe("cheapestCells", () => {
  it("goes round a steep ridge through the pass", () => {
    const cells = cheapestCells(ridge, [400, 100], [400, 520]);
    expect(Math.max(...cells.map((c) => heightAt(ridge, c)))).toBeLessThan(0.5);
    // Through the gap at the left.
    expect(Math.min(...cells.map((c) => c[0]))).toBeLessThan(130);
  });

  it("goes round water", () => {
    const cells = cheapestCells(lake, [100, 320], [540, 320]);
    expect(cells.every((c) => heightAt(lake, c) >= SEA_LEVEL)).toBe(true);
  });

  it("runs close to straight over flat ground", () => {
    const cells = cheapestCells(flat, [20, 20], [600, 400]);
    expect(length(cells)).toBeLessThan(Math.hypot(580, 380) * 1.15);
  });
});

describe("routeRoad", () => {
  const road = routeRoad(ridge, [403, 97], [398, 523]);

  it("starts and ends on its two positions exactly", () => {
    expect(road[0]).toEqual([403, 97]);
    expect(road[road.length - 1]).toEqual([398, 523]);
  });

  it("is the same route every time", () => {
    expect(routeRoad(ridge, [403, 97], [398, 523])).toEqual(road);
  });

  it("draws its wander from the seed", () => {
    expect(routeGrid(MAP, MAP, 64, 1).wander).toEqual(flat.wander);
    expect(routeGrid(MAP, MAP, 64, 2).wander).not.toEqual(flat.wander);
  });

  it("keeps within a cell of low ground once smoothed", () => {
    // Rounding may brush the edge of the cliff the route hugs, never more.
    const lowNear = ([x, y]: MapXY) =>
      [-1, 0, 1].some((i) =>
        [-1, 0, 1].some((j) => heightAt(ridge, [x + i * 10, y + j * 10]) < 0.5),
      );
    expect(road.filter((p) => !lowNear(p))).toHaveLength(0);
  });
});

describe("simplifyLine and roundCorners", () => {
  const stairs: MapXY[] = Array.from({ length: 21 }, (_, k) => [
    Math.ceil(k / 2),
    Math.floor(k / 2),
  ]);

  it("turns a staircase into the straight run it stands for", () => {
    expect(simplifyLine(stairs, 1)).toEqual([stairs[0], stairs[20]]);
  });

  it("rounds a corner and keeps the ends", () => {
    const corner: MapXY[] = [
      [0, 0],
      [10, 0],
      [10, 10],
    ];
    const round = roundCorners(corner, 2);
    expect(round[0]).toEqual([0, 0]);
    expect(round[round.length - 1]).toEqual([10, 10]);
    // The corner itself is cut off.
    expect(round).not.toContainEqual([10, 0]);
    expect(round.length).toBeGreaterThan(corner.length);
  });
});

describe("markRoad", () => {
  it("keeps a later road off an earlier one between the same towns", () => {
    const g = routeGrid(MAP, MAP, 64, 1);
    const first = routeRoad(g, [20, 300], [610, 300]);
    markRoad(g, first);
    const second = routeRoad(g, [20, 310], [610, 310]);
    // Points every map unit along a line.
    const dense = (line: MapXY[]) =>
      line.flatMap((p, k): MapXY[] => {
        if (k === 0) return [p];
        const [qx, qy] = line[k - 1];
        const n = Math.ceil(Math.hypot(p[0] - qx, p[1] - qy));
        return Array.from(
          { length: n },
          (_, s): MapXY => [
            qx + ((p[0] - qx) * (s + 1)) / n,
            qy + ((p[1] - qy) * (s + 1)) / n,
          ],
        );
      });
    const a = dense(first);
    // Away from the towns, the second road runs clear of the first.
    const middle = dense(second).filter((p) => p[0] > 150 && p[0] < 480);
    const nearest = Math.min(
      ...middle.map((p) =>
        Math.min(...a.map((q) => Math.hypot(p[0] - q[0], p[1] - q[1]))),
      ),
    );
    expect(middle.length).toBeGreaterThan(100);
    // More than the three cells either side that count as beside a road.
    expect(nearest).toBeGreaterThan(3 * g.stepY);
  });
});

describe("markRivers", () => {
  it("routes a road across a river once and straight over", () => {
    const g = routeGrid(
      MAP,
      MAP,
      64,
      1,
      grid(() => 0.1),
    );
    // A river down the middle, bending left then right, 16 map units wide.
    const course: MapXY[] = [
      [300, 0],
      [280, 300],
      [340, MAP],
    ];
    markRivers(g, [new Float32Array(course.flatMap(([x, y]) => [x, y, 8]))]);
    const line = routeRoad(g, [100, 200], [500, 420]);
    const inRiver = ([px, py]: MapXY) =>
      course.slice(1).some(([bx, by], k) => {
        const [ax, ay] = course[k];
        const dx = bx - ax;
        const dy = by - ay;
        const t = Math.max(
          0,
          Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)),
        );
        return Math.hypot(ax + dx * t - px, ay + dy * t - py) < 8;
      });
    // Walked a map unit at a time, since the route keeps only its corners.
    let crossings = 0;
    let wet = 0;
    let was = false;
    for (let k = 1; k < line.length; k++) {
      const [ax, ay] = line[k - 1];
      const [bx, by] = line[k];
      const n = Math.ceil(Math.hypot(bx - ax, by - ay));
      for (let j = 0; j < n; j++) {
        const on = inRiver([
          ax + ((bx - ax) * j) / n,
          ay + ((by - ay) * j) / n,
        ]);
        if (on) wet++;
        if (on && !was) crossings++;
        was = on;
      }
    }
    expect(crossings).toBe(1);
    // Straight over is 16 map units. At a slant it would be well over 22.
    expect(wet).toBeLessThanOrEqual(22);
  });

  it("leaves a grid with no rivers alone", () => {
    const g = routeGrid(
      MAP,
      MAP,
      64,
      1,
      grid(() => 0.1),
    );
    markRivers(g, []);
    expect(g.river?.every((v) => v === 0)).toBe(true);
  });
});

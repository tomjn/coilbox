import { describe, expect, it } from "vitest";
import { crossingSpan, dashPolyline, sharedBorderLines } from "./cueLines";
import type { WorldPos } from "./layout";
import {
  type BorderPiece,
  createProvinceIndex,
  provinceBorders,
  type Ring,
} from "./provinces";

const square = (x: number, y: number, size: number): Ring => [
  [x, y],
  [x + size, y],
  [x + size, y + size],
  [x, y + size],
];

const length = (line: WorldPos[]) => {
  let sum = 0;
  for (let i = 1; i < line.length; i++) {
    sum += Math.hypot(line[i][0] - line[i - 1][0], line[i][2] - line[i - 1][2]);
  }
  return sum;
};

describe("dashPolyline", () => {
  it("cuts a straight line into dashes with gaps between", () => {
    const dashes = dashPolyline(
      [
        [0, 0, 0],
        [10, 0, 0],
      ],
      2,
      1,
    );
    expect(dashes.map((d) => [d[0][0], d[d.length - 1][0]])).toEqual([
      [0, 2],
      [3, 5],
      [6, 8],
      [9, 10],
    ]);
  });

  it("drops a last dash shorter than half a dash", () => {
    const dashes = dashPolyline(
      [
        [0, 0, 0],
        [6.5, 0, 0],
      ],
      2,
      1,
    );
    expect(dashes).toHaveLength(2);
  });

  it("carries the pattern round a corner and keeps the corner", () => {
    // 3 along x, then 3 along z. The second dash starts at 3 and turns there.
    const dashes = dashPolyline(
      [
        [0, 0, 0],
        [3, 0, 0],
        [3, 0, 3],
      ],
      2,
      0.5,
    );
    expect(dashes).toHaveLength(3);
    expect(dashes[1]).toEqual([
      [2.5, 0, 0],
      [3, 0, 0],
      [3, 0, 1.5],
    ]);
    for (const d of dashes.slice(0, 2)) expect(length(d)).toBeCloseTo(2);
  });

  it("dashes a line of stretches each shorter than a dash", () => {
    const points: WorldPos[] = [];
    for (let i = 0; i <= 100; i++) points.push([i * 0.1, 0, 0]);
    const dashes = dashPolyline(points, 2, 1);
    expect(dashes).toHaveLength(4);
    expect(length(dashes[0])).toBeCloseTo(2);
  });

  it("follows the height of the line it is cut from", () => {
    const [dash] = dashPolyline(
      [
        [0, 0, 0],
        [4, 8, 0],
      ],
      2,
      1,
    );
    expect(dash[1]).toEqual([2, 4, 0]);
  });

  it("returns nothing for a line with no length", () => {
    expect(dashPolyline([[1, 0, 1]], 2, 1)).toEqual([]);
    expect(
      dashPolyline(
        [
          [1, 0, 1],
          [1, 0, 1],
        ],
        2,
        1,
      ),
    ).toEqual([]);
  });
});

describe("crossingSpan", () => {
  // Two provinces 40 apart, with their anchors at their centres.
  const index = createProvinceIndex([
    { outline: [square(0, 0, 30)] },
    { outline: [square(70, 0, 30)] },
    {},
  ]);

  it("keeps the stretch over the gap between two provinces", () => {
    const [from, to] = crossingSpan(index, 0, 1, [15, 15], [85, 15], 1, 5);
    // Within one step of each coast.
    expect(from[0]).toBeGreaterThan(28);
    expect(from[0]).toBeLessThanOrEqual(30);
    expect(to[0]).toBeGreaterThanOrEqual(70);
    expect(to[0]).toBeLessThan(72);
    expect(from[1]).toBe(15);
  });

  it("gives the same stretch from either end", () => {
    const [from, to] = crossingSpan(index, 1, 0, [85, 15], [15, 15], 1, 5);
    expect(from[0]).toBeGreaterThanOrEqual(70);
    expect(to[0]).toBeLessThanOrEqual(30);
  });

  it("starts at the anchor of a point location", () => {
    const [from, to] = crossingSpan(index, -1, 1, [50, 15], [85, 15], 1, 5);
    expect(from).toEqual([50, 15]);
    expect(to[0]).toBeLessThan(72);
  });

  it("keeps the whole line when there are no provinces", () => {
    expect(crossingSpan(undefined, -1, -1, [0, 0], [10, 0], 1, 5)).toEqual([
      [0, 0],
      [10, 0],
    ]);
  });

  it("widens a gap with no length to the least length", () => {
    const touching = createProvinceIndex([
      { outline: [square(0, 0, 50)] },
      { outline: [square(50, 0, 50)] },
    ]);
    const [from, to] = crossingSpan(touching, 0, 1, [25, 25], [75, 25], 1, 10);
    expect(to[0] - from[0]).toBeCloseTo(10);
    expect((from[0] + to[0]) / 2).toBeGreaterThan(48);
    expect((from[0] + to[0]) / 2).toBeLessThan(52);
  });

  it("never widens past the anchors", () => {
    const [from, to] = crossingSpan(index, 0, 1, [29, 15], [71, 15], 1, 500);
    expect(from).toEqual([29, 15]);
    expect(to).toEqual([71, 15]);
  });
});

describe("sharedBorderLines", () => {
  // West and east share the line x = 50. South lies under both.
  const index = createProvinceIndex([
    { outline: [square(0, 0, 50)] },
    { outline: [square(50, 0, 50)] },
    {
      outline: [
        [
          [0, 50],
          [100, 50],
          [100, 100],
          [0, 100],
        ],
      ],
    },
  ]);
  const pieces = provinceBorders(index, 0.25);

  it("returns the edge two provinces share, from the layer's own pieces", () => {
    const lines = sharedBorderLines(pieces, 0, 1);
    expect(lines).toHaveLength(1);
    const [line] = lines;
    for (const [x] of line) expect(x).toBe(50);
    const ys = line.map(([, y]) => y);
    expect(Math.min(...ys)).toBe(0);
    expect(Math.max(...ys)).toBe(50);
  });

  it("is the same whichever province is named first", () => {
    expect(sharedBorderLines(pieces, 1, 0)).toEqual(
      sharedBorderLines(pieces, 0, 1),
    );
  });

  it("returns nothing for two provinces that do not touch", () => {
    const apart = createProvinceIndex([
      { outline: [square(0, 0, 30)] },
      { outline: [square(70, 0, 30)] },
    ]);
    expect(sharedBorderLines(provinceBorders(apart, 0.25), 0, 1)).toEqual([]);
  });

  it("joins pieces that meet end to end and splits those that do not", () => {
    const piece = (
      a: [number, number],
      b: [number, number],
      neighbour = 1,
    ): BorderPiece => ({ a, b, province: 0, neighbour });
    const lines = sharedBorderLines(
      [
        piece([0, 0], [1, 0]),
        piece([1, 0], [2, 1]),
        piece([2, 1], [3, 1], 2),
        piece([5, 5], [6, 5]),
      ],
      0,
      1,
    );
    expect(lines).toEqual([
      [
        [0, 0],
        [1, 0],
        [2, 1],
      ],
      [
        [5, 5],
        [6, 5],
      ],
    ]);
  });
});

import { describe, expect, it } from "vitest";
import { packOrders } from "./orderPointsFixture";
import {
  decodeOrderPoints,
  orderHeatPoints,
  sourceCounts,
} from "./replayOrderPoints";

const sample = packOrders([
  { x: 100.5, z: 200, frame: 30, team: 2, player: 4, kind: 1, source: 0 },
  { x: 8000, z: 6144, frame: -1, team: -1, player: 255, kind: 4, source: 1 },
  { x: 0, z: 0, frame: 70000, team: 7, player: 9, kind: 2, source: 2 },
]);

describe("unpacking the order columns", () => {
  it("gives each order back across the parallel columns", () => {
    const got = decodeOrderPoints(sample);
    expect(got.count).toBe(3);
    expect([...got.x]).toEqual([100.5, 8000, 0]);
    expect([...got.z]).toEqual([200, 6144, 0]);
    expect([...got.frame]).toEqual([30, -1, 70000]);
    expect([...got.team]).toEqual([2, -1, 7]);
    expect([...got.player]).toEqual([4, 255, 9]);
    expect([...got.kind]).toEqual([1, 4, 2]);
    expect([...got.source]).toEqual([0, 1, 2]);
  });

  it("refuses a column that does not line up with the count", () => {
    expect(() => decodeOrderPoints({ ...sample, count: 4 })).toThrowError(
      /order column x holds 12 bytes, expected 16/,
    );
  });

  it("holds the arrays where React's development build cannot walk them", () => {
    const got = decodeOrderPoints(sample);
    expect(Object.keys(got)).not.toContain("x");
    expect(Object.keys(got)).not.toContain("frame");
    expect(Object.keys(got)).toContain("count");
  });

  it("makes density points of x then z for each order", () => {
    const { positions } = orderHeatPoints(decodeOrderPoints(sample));
    expect([...(positions as Float32Array)]).toEqual([
      100.5, 200, 8000, 6144, 0, 0,
    ]);
  });

  it("counts the orders each sender gave", () => {
    expect(sourceCounts(decodeOrderPoints(sample))).toEqual({
      selection: 1,
      lua: 1,
      ai: 1,
    });
  });

  it("unpacks an empty replay", () => {
    const got = decodeOrderPoints(packOrders([]));
    expect(got.count).toBe(0);
    expect(got.x.length).toBe(0);
  });
});

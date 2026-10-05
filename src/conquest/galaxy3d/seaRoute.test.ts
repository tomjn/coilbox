import { describe, expect, it } from "vitest";
import type { MapPoint } from "./provinces";
import { seaCurve, seaRoute } from "./seaRoute";

/** Land west of x = 30 and east of x = 70, sea between. */
const twoShores = (x: number) => x < 30 || x > 70;

describe("seaRoute", () => {
  it("lands on each coast where the straight line meets it", () => {
    const route = seaRoute([10, 50], [90, 50], twoShores, 1);
    if (!route) throw new Error("no route");
    expect(route.jettyA[0]).toEqual([10, 50]);
    expect(route.jettyB[1]).toEqual([90, 50]);
    // The landing points sit on the coast, to within a step.
    expect(route.jettyA[1][0]).toBeCloseTo(30, 1);
    expect(route.jettyB[0][0]).toBeCloseTo(70, 1);
    // The curve starts and ends on them.
    expect(route.sea[0]).toEqual(route.jettyA[1]);
    expect(route.sea[route.sea.length - 1]).toEqual(route.jettyB[0]);
  });

  it("puts every point of the curve between it on the water", () => {
    const route = seaRoute([10, 50], [90, 50], twoShores, 1);
    for (const [x] of route?.sea.slice(1, -1) ?? []) {
      expect(twoShores(x)).toBe(false);
    }
  });

  it("bows the curve gently rather than running straight", () => {
    const route = seaRoute([10, 50], [90, 50], twoShores, 1);
    const ys = route?.sea.map(([, y]) => y) ?? [];
    const bow = Math.max(...ys.map((y) => Math.abs(y - 50)));
    // The chord is 40 long. A gentle bow stands off it by a few units.
    expect(bow).toBeGreaterThan(1);
    expect(bow).toBeLessThan(4);
  });

  it("keeps a location already at sea as its own landing point", () => {
    const route = seaRoute([50, 50], [90, 50], twoShores, 1);
    expect(route?.jettyA).toEqual([
      [50, 50],
      [50, 50],
    ]);
    expect(route?.jettyB[0][0]).toBeCloseTo(70, 1);
  });

  it("finds no route when the line never reaches the sea", () => {
    expect(seaRoute([10, 50], [90, 50], () => true, 1)).toBeUndefined();
  });

  it("finds no route between two points that are one", () => {
    expect(seaRoute([10, 50], [10, 50], twoShores, 1)).toBeUndefined();
  });

  it("runs from the first coast it leaves to the last it reaches", () => {
    // An island from x = 45 to 55 in the middle of the strait.
    const island = (x: number) => twoShores(x) || (x > 45 && x < 55);
    const route = seaRoute([10, 50], [90, 50], island, 1);
    expect(route?.jettyA[1][0]).toBeCloseTo(30, 1);
    expect(route?.jettyB[0][0]).toBeCloseTo(70, 1);
  });
});

describe("seaCurve", () => {
  const a: MapPoint = [30, 50];
  const b: MapPoint = [70, 50];
  const offsetOf = (points: MapPoint[]) =>
    points.reduce(
      (m, [, y]) => (Math.abs(y - 50) > Math.abs(m) ? y - 50 : m),
      0,
    );

  it("rounds an island that stands on the straight line", () => {
    // A round island at the middle of the line, radius 5.
    const isle = (x: number, y: number) => Math.hypot(x - 50, y - 50) < 5;
    const points = seaCurve(a, b, isle, 0.5);
    for (const [x, y] of points.slice(1, -1)) expect(isle(x, y)).toBe(false);
    expect(Math.abs(offsetOf(points))).toBeGreaterThan(5);
  });

  it("bows away from land that lies to one side", () => {
    // Land on the left of travel east, which is smaller y.
    const left = (_x: number, y: number) => y < 48;
    const points = seaCurve(a, b, left, 0.5);
    for (const [x, y] of points.slice(1, -1)) expect(left(x, y)).toBe(false);
    expect(offsetOf(points)).toBeGreaterThan(0);
  });

  it("draws the same route for the same map", () => {
    const isle = (x: number, y: number) => Math.hypot(x - 50, y - 50) < 5;
    expect(seaCurve(a, b, isle, 0.5)).toEqual(seaCurve(a, b, isle, 0.5));
  });

  it("takes the curve with the least land when none is clear", () => {
    const all = () => true;
    const points = seaCurve(a, b, all, 0.5);
    expect(points[0]).toEqual(a);
    expect(points[points.length - 1]).toEqual(b);
    // Every curve crosses the same land, so the gentlest wins.
    expect(Math.abs(offsetOf(points))).toBeLessThan(4);
  });
});

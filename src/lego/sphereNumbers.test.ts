import { describe, expect, it } from "vitest";
import type { LegoShape } from "./shapes";
import { sphereAnchors, sphereNumbers, withSphereNumber } from "./sphereShape";

const ball: LegoShape = {
  kind: "sphere",
  size: [2, 4, 6],
  swatch: "green",
  options: { keep: 0, rings: 4, sides: 12 },
};
const dome: LegoShape = {
  ...ball,
  size: [2, 4, 6],
  options: { keep: 1, rings: 4, sides: 12 },
};

function applied(shape: LegoShape, name: never, value: number): LegoShape {
  const result = withSphereNumber(shape, name, value);
  if ("problem" in result) throw new Error(result.problem);
  return result.shape;
}

describe("sphereNumbers", () => {
  it("reads three radii from a whole sphere's box", () => {
    expect(sphereNumbers(ball)).toMatchObject({
      radiusX: 1,
      radiusY: 2,
      radiusZ: 3,
      keep: 0,
    });
  });

  it("reads a dome's height as its vertical radius", () => {
    expect(sphereNumbers(dome)).toMatchObject({ radiusY: 4, keep: 1 });
  });
});

describe("withSphereNumber", () => {
  it("sets a radius as half the box, or the dome's whole height", () => {
    expect(applied(ball, "radiusY" as never, 5).size).toEqual([2, 10, 6]);
    expect(applied(dome, "radiusY" as never, 5).size).toEqual([2, 5, 6]);
  });

  it("keeps the vertical radius when what is kept changes", () => {
    expect(applied(ball, "keep" as never, 1).size).toEqual([2, 2, 6]);
    expect(applied(dome, "keep" as never, 0).size).toEqual([2, 8, 6]);
    expect(applied(dome, "keep" as never, 2).options?.keep).toBe(2);
  });

  it("refuses what it cannot draw, with a reason", () => {
    expect(withSphereNumber(ball, "radiusX", 0)).toEqual({
      problem: "Radius X must be above 0.",
    });
    expect(withSphereNumber(ball, "rings", 1)).toEqual({
      problem: "Rings must be a whole number, 2 or more.",
    });
    expect(withSphereNumber(ball, "sides", 2.5)).toEqual({
      problem: "Sides must be a whole number, 3 or more.",
    });
    expect(withSphereNumber(ball, "keep", 3)).toHaveProperty("problem");
  });
});

describe("sphereAnchors", () => {
  const bounds = { min: [-1, -2, -3], max: [1, 2, 3] } as Parameters<
    typeof sphereAnchors
  >[0];
  const outs = (shape: LegoShape) =>
    sphereAnchors(bounds, shape).map(
      (anchor) => anchor.out?.join(",") ?? "mid",
    );

  it("gives a whole sphere the middle of every face and no corners", () => {
    expect(outs(ball).sort()).toEqual(
      ["-1,0,0", "1,0,0", "0,-1,0", "0,1,0", "0,0,-1", "0,0,1", "mid"].sort(),
    );
  });

  it("gives a dome only its base and its apex", () => {
    expect(outs(dome).sort()).toEqual(["0,-1,0", "0,1,0", "mid"].sort());
  });
});

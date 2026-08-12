import { describe, expect, it } from "vitest";
import { buildOrderText } from "./order";

const buildings = [
  { def: "armlab", offset: { x: 0, z: 0 }, facing: 0 as const },
  { def: "armsolar", offset: { x: 128, z: 0 }, facing: 0 as const },
  { def: "armsolar", offset: { x: 192, z: 0 }, facing: 0 as const },
];

describe("a blueprint as a plain build order", () => {
  it("strips the positions and leaves the sequence of names", () => {
    expect(buildOrderText({ ordered: true, buildings })).toBe(
      "armlab\narmsolar\narmsolar",
    );
  });

  it("has nothing to say about a layout whose order was not meant", () => {
    expect(buildOrderText({ buildings })).toBe("");
    expect(buildOrderText({ ordered: true, buildings: [] })).toBe("");
  });
});

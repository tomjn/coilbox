import { describe, expect, it } from "vitest";
import { type LegoProject, newProject } from "./model";
import type { LegoPartInfo, LoadedPack } from "./pack";
import { coneAnchors, roundNumbers, withRoundNumber } from "./roundShape";
import { DEFAULT_CYLINDER_SIDES, type LegoShape } from "./shapes";
import { localAnchors } from "./snapping";

const SWATCHES = ["green", "tan", "grey"].map((id) => ({
  id,
  uv: { min: [0, 0] as [number, number], max: [0.1, 0.1] as [number, number] },
  tile: 1.56,
}));

function pack(swatches = SWATCHES): Pick<LoadedPack, "manifest" | "byId"> {
  const parts = [
    { id: "g", colourway: "green" },
    { id: "t", colourway: "tan" },
  ] as LegoPartInfo[];
  return {
    manifest: { swatches } as LoadedPack["manifest"],
    byId: new Map(parts.map((part) => [part.id, part])),
  };
}

function unit(partIds: string[]): LegoProject {
  const base = newProject({
    id: "p",
    rootPieceId: "root",
    name: "u",
    packId: "lego",
    packVersion: "1",
    now: "2026-10-17T00:00:00Z",
  });
  return {
    ...base,
    pieces: [
      ...base.pieces,
      ...partIds.map((partId, i) => ({
        id: `p${i}`,
        name: `p${i}`,
        parentId: "root",
        partId,
        position: [0, 0, 0] as [number, number, number],
        rotation: [0, 0, 0] as [number, number, number],
        scale: [1, 1, 1] as [number, number, number],
      })),
    ],
  };
}

describe("withRoundNumber", () => {
  const cylinder: LegoShape = {
    kind: "cylinder",
    size: [2, 3, 2],
    swatch: "grey",
    options: { axis: 1, sides: 12 },
  };
  const tube: LegoShape = {
    kind: "tube",
    size: [2, 3, 2],
    swatch: "grey",
    options: { axis: 1, sides: 12, inner: 0.75 },
  };
  const shapeOf = (result: ReturnType<typeof withRoundNumber>) => {
    if ("problem" in result) throw new Error(result.problem);
    return result.shape;
  };

  it("sets the size across from the radius and along from the length", () => {
    expect(shapeOf(withRoundNumber(cylinder, "radius", 0.5)).size).toEqual([
      1, 3, 1,
    ]);
    expect(shapeOf(withRoundNumber(cylinder, "length", 5)).size).toEqual([
      2, 5, 2,
    ]);
  });

  it("turns the size with the axis", () => {
    const lying = shapeOf(withRoundNumber(cylinder, "axis", 0));
    expect(lying.size).toEqual([3, 2, 2]);
    expect(roundNumbers(lying)).toMatchObject({
      axis: 0,
      radius: 1,
      length: 3,
    });
  });

  it("keeps a tube's wall when its radius changes", () => {
    const wider = shapeOf(withRoundNumber(tube, "radius", 2));
    expect(roundNumbers(wider).wall).toBeCloseTo(0.25, 9);
    expect(wider.options?.inner).toBeCloseTo(1.75, 9);
  });

  it("refuses a wall that is not above 0 and below the radius", () => {
    expect(withRoundNumber(tube, "wall", 0)).toEqual({
      problem: "Wall must be above 0 and below the radius.",
    });
    expect(withRoundNumber(tube, "wall", 1)).toEqual({
      problem: "Wall must be above 0 and below the radius.",
    });
    expect(withRoundNumber(tube, "radius", 0.2)).toEqual({
      problem: "Wall must be above 0 and below the radius.",
    });
  });

  it("refuses sizes and side counts it cannot draw", () => {
    expect("problem" in withRoundNumber(cylinder, "radius", 0)).toBe(true);
    expect("problem" in withRoundNumber(cylinder, "length", -1)).toBe(true);
    expect("problem" in withRoundNumber(cylinder, "sides", 2)).toBe(true);
    expect("problem" in withRoundNumber(cylinder, "sides", 7.5)).toBe(true);
    expect(shapeOf(withRoundNumber(cylinder, "sides", 24)).options?.sides).toBe(
      24,
    );
  });
});

describe("cones (#3329)", () => {
  const cone: LegoShape = {
    kind: "cone",
    size: [2, 3, 2],
    swatch: "grey",
    options: { axis: 1, sides: 12, top: 0.5 },
  };
  const shapeOf = (result: ReturnType<typeof withRoundNumber>) => {
    if ("problem" in result) throw new Error(result.problem);
    return result.shape;
  };

  it("reads its numbers back, the bottom radius from the box", () => {
    expect(roundNumbers(cone)).toEqual({
      axis: 1,
      radius: 1,
      length: 3,
      sides: 12,
      top: 0.5,
    });
  });

  it("sets the top radius, and a top of 0 is a cone", () => {
    expect(shapeOf(withRoundNumber(cone, "top", 0.8)).options?.top).toBe(0.8);
    expect(shapeOf(withRoundNumber(cone, "top", 0)).options?.top).toBe(0);
  });

  it("tells the user to use a cylinder for a top as wide as the bottom", () => {
    expect(withRoundNumber(cone, "top", 1)).toEqual({
      problem:
        "A top as wide as the bottom is a cylinder. Add a cylinder instead.",
    });
    expect(withRoundNumber(cone, "radius", 0.5)).toEqual({
      problem:
        "A top as wide as the bottom is a cylinder. Add a cylinder instead.",
    });
  });

  it("refuses a top wider than the bottom or below 0", () => {
    const problem = "Top radius must be 0 or more and below the bottom radius.";
    expect(withRoundNumber(cone, "top", 1.5)).toEqual({ problem });
    expect(withRoundNumber(cone, "top", -0.1)).toEqual({ problem });
    expect(withRoundNumber(cone, "radius", 0.2)).toEqual({ problem });
  });

  it("keeps the top when the axis or length changes", () => {
    const lying = shapeOf(withRoundNumber(cone, "axis", 0));
    expect(roundNumbers(lying)).toMatchObject({ axis: 0, top: 0.5 });
    expect(shapeOf(withRoundNumber(cone, "length", 5)).options?.top).toBe(0.5);
  });

  it("has no corner anchors, and its side anchors sit on the slope at mid height", () => {
    const bounds = { min: [-1, -1.5, -1], max: [1, 1.5, 1] } as const;
    const anchors = coneAnchors(
      { min: [...bounds.min], max: [...bounds.max] },
      cone,
    );
    expect(anchors.some((a) => a.kind === "corner")).toBe(false);
    const east = anchors.find((a) => a.out?.[0] === 1);
    // Halfway up, the radius is halfway between 1 and the top, 0.5.
    expect(east?.position).toEqual([0.75, 0, 0]);
    const top = anchors.find((a) => a.out?.[1] === 1);
    expect(top?.position).toEqual([0, 1.5, 0]);
    const plain = localAnchors(
      { min: [...bounds.min], max: [...bounds.max] },
      true,
    );
    expect(anchors).toHaveLength(plain.length);
  });

  it("puts the anchors of a cone lying along x on its own axes", () => {
    const lying: LegoShape = {
      ...cone,
      size: [3, 2, 2],
      options: { axis: 0, top: 0 },
    };
    const anchors = coneAnchors(
      { min: [-1.5, -1, -1], max: [1.5, 1, 1] },
      lying,
    );
    expect(anchors.find((a) => a.out?.[1] === 1)?.position).toEqual([
      0, 0.5, 0,
    ]);
    expect(anchors.find((a) => a.out?.[0] === 1)?.position).toEqual([
      1.5, 0, 0,
    ]);
  });
});

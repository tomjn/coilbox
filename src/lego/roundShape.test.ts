import { describe, expect, it } from "vitest";
import { type LegoProject, newProject } from "./model";
import type { LegoPartInfo, LoadedPack } from "./pack";
import { newRoundShape, roundNumbers, withRoundNumber } from "./roundShape";
import { DEFAULT_CYLINDER_SIDES, type LegoShape } from "./shapes";

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

describe("newRoundShape", () => {
  it("takes the colourway most of the unit's parts use", () => {
    expect(
      newRoundShape("cylinder", unit(["t", "g", "t"]), pack())?.swatch,
    ).toBe("tan");
  });

  it("takes the first swatch when no part has one", () => {
    expect(newRoundShape("cylinder", unit([]), pack())?.swatch).toBe("green");
  });

  it("is upright with the default sides, and a tube has a wall", () => {
    const tube = newRoundShape("tube", unit([]), pack());
    if (!tube) throw new Error("no shape");
    expect(roundNumbers(tube)).toEqual({
      axis: 1,
      radius: 0.5,
      length: 1,
      sides: DEFAULT_CYLINDER_SIDES,
      wall: 0.25,
    });
  });

  it("offers nothing when the pack lists no swatches", () => {
    expect(newRoundShape("tube", unit([]), pack([]))).toBeNull();
  });
});

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

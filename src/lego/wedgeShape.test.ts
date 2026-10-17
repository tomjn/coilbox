import { describe, expect, it } from "vitest";
import { type LegoProject, newProject } from "./model";
import type { LoadedPack } from "./pack";
import type { LegoShape } from "./shapes";
import {
  newWedgeShape,
  wedgeAnchors,
  wedgeNumbers,
  withWedgeNumber,
} from "./wedgeShape";

const SWATCHES = ["green", "tan"].map((id) => ({
  id,
  uv: { min: [0, 0] as [number, number], max: [0.1, 0.1] as [number, number] },
  tile: 1.56,
}));

function pack(swatches = SWATCHES): Pick<LoadedPack, "manifest" | "byId"> {
  return {
    manifest: { swatches } as LoadedPack["manifest"],
    byId: new Map(),
  };
}

function unit(): LegoProject {
  return newProject({
    id: "p",
    rootPieceId: "root",
    name: "u",
    packId: "lego",
    packVersion: "1",
    now: "2026-10-17T00:00:00Z",
  });
}

const ramp: LegoShape = {
  kind: "wedge",
  size: [2, 4, 3],
  swatch: "green",
  options: { low: 1 },
};

describe("newWedgeShape", () => {
  it("is a pure wedge, high at the back, in the first swatch", () => {
    const shape = newWedgeShape(unit(), pack());
    expect(shape?.kind).toBe("wedge");
    expect(shape?.swatch).toBe("green");
    expect(wedgeNumbers(shape as LegoShape)).toMatchObject({
      low: 0,
      flip: false,
    });
  });

  it("is offered nowhere when the pack lists no swatches", () => {
    expect(newWedgeShape(unit(), pack([]))).toBeNull();
  });
});

describe("wedgeNumbers and withWedgeNumber", () => {
  it("reads width, depth, height and the low end from the size and options", () => {
    expect(wedgeNumbers(ramp)).toEqual({
      width: 2,
      depth: 3,
      height: 4,
      low: 1,
      flip: false,
    });
  });

  it("sets a size on its own axis", () => {
    const next = withWedgeNumber(ramp, "depth", 5);
    expect("shape" in next && next.shape.size).toEqual([2, 4, 5]);
  });

  it("sets the low end and keeps it as an option", () => {
    const next = withWedgeNumber(ramp, "low", 2);
    expect("shape" in next && next.shape.options?.low).toBe(2);
  });

  it("flips without touching the size", () => {
    const next = withWedgeNumber(ramp, "flip", 1);
    expect("shape" in next && next.shape.size).toEqual([2, 4, 3]);
    expect("shape" in next && wedgeNumbers(next.shape).flip).toBe(true);
  });

  it("refuses a size of zero or less, and says which", () => {
    expect(withWedgeNumber(ramp, "width", 0)).toEqual({
      problem: "Width must be above 0.",
    });
    expect(withWedgeNumber(ramp, "height", -1)).toEqual({
      problem: "Height must be above 0.",
    });
  });

  it("refuses a low end above the height or below zero", () => {
    expect(withWedgeNumber(ramp, "low", 5)).toEqual({
      problem: "Low end must be between 0 and the height.",
    });
    expect(withWedgeNumber(ramp, "low", -1)).toEqual({
      problem: "Low end must be between 0 and the height.",
    });
  });

  it("refuses a height below the low end", () => {
    expect(withWedgeNumber(ramp, "height", 0.5)).toEqual({
      problem: "Low end must be between 0 and the height.",
    });
  });
});

describe("wedgeAnchors", () => {
  const box = { min: [-1, -2, -1.5] as const, max: [1, 2, 1.5] as const };
  const bounds = { min: [...box.min], max: [...box.max] } as Parameters<
    typeof wedgeAnchors
  >[0];

  it("drops the two corners above the slope of a pure wedge", () => {
    const corners = wedgeAnchors(bounds, {
      ...ramp,
      options: { low: 0 },
    }).filter((a) => a.kind === "corner");
    expect(corners).toHaveLength(6);
    // None at the top of the low (front, +z) end.
    expect(
      corners.some((a) => a.position[1] === 2 && a.position[2] === 1.5),
    ).toBe(false);
  });

  it("drops them from a ramp too, and from a flipped one at the other end", () => {
    const flipped = wedgeAnchors(bounds, {
      ...ramp,
      options: { low: 1, flip: 1 },
    }).filter((a) => a.kind === "corner");
    expect(flipped).toHaveLength(6);
    expect(
      flipped.some((a) => a.position[1] === 2 && a.position[2] === -1.5),
    ).toBe(false);
  });

  it("keeps all eight corners of a ramp as high as its high end", () => {
    const anchors = wedgeAnchors(bounds, { ...ramp, options: { low: 4 } });
    expect(anchors.filter((a) => a.kind === "corner")).toHaveLength(8);
  });

  it("leaves the faces to the shape's connectors", () => {
    expect(wedgeAnchors(bounds, ramp).some((a) => a.kind === "face")).toBe(
      false,
    );
  });

  it("keeps the middle of the box", () => {
    expect(
      wedgeAnchors(bounds, ramp).some(
        (a) => a.kind === "centre" && a.position.every((v) => v === 0),
      ),
    ).toBe(true);
  });
});

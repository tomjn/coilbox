import { describe, expect, it } from "vitest";

import {
  derivedCollisionVolume,
  effectiveCollisionVolume,
  engineScales,
  isIgnoredByEngine,
  MIN_COLLISION_SIZE,
  resizeCollisionFace,
} from "./collisionVolume";
import { type LegoProject, newProject } from "./model";
import type { UnitBounds } from "./s3oBuild";

function bounds(
  sizeX: number,
  sizeY: number,
  sizeZ: number,
  mid: [number, number, number] = [0, 0, 0],
): UnitBounds {
  return { mid, sizeX, sizeY, sizeZ };
}

function project(): LegoProject {
  return newProject({
    id: "p",
    rootPieceId: "root",
    name: "probe",
    packId: "lego",
    packVersion: "1",
    now: "2026-07-30T00:00:00Z",
  });
}

describe("derivedCollisionVolume", () => {
  it("is the model's own bounding box, centred on the middle", () => {
    expect(derivedCollisionVolume(bounds(40, 12, 88))).toEqual({
      type: "box",
      scales: [40, 12, 88],
      offsets: [0, 0, 0],
    });
  });

  it("stays centred however far the unit is built from the origin", () => {
    // Offsets are measured from the model's middle, so moving the unit moves
    // the point they start from with it.
    expect(
      derivedCollisionVolume(bounds(4, 4, 4, [30, 9, -12])).offsets,
    ).toEqual([0, 0, 0]);
  });
});

describe("effectiveCollisionVolume", () => {
  it("derives one for a unit that has none, so an old document still exports", () => {
    expect(effectiveCollisionVolume(project(), bounds(4, 6, 8))).toEqual({
      type: "box",
      scales: [4, 6, 8],
      offsets: [0, 0, 0],
    });
  });

  it("leaves a unit's own volume exactly as it was saved", () => {
    const volume = {
      type: "cylz" as const,
      scales: [10, 10, 40] as [number, number, number],
      offsets: [0, 2, 0] as [number, number, number],
    };

    expect(
      effectiveCollisionVolume(
        { ...project(), collisionVolume: volume },
        bounds(4, 6, 8),
      ),
    ).toEqual(volume);
  });
});

describe("engineScales", () => {
  it("leaves a box as it was written", () => {
    expect(
      engineScales({ type: "box", scales: [4, 6, 8], offsets: [0, 0, 0] }),
    ).toEqual([4, 6, 8]);
  });

  it("makes a sphere uniform at its largest axis, as the engine does", () => {
    expect(
      engineScales({ type: "sphere", scales: [4, 6, 8], offsets: [0, 0, 0] }),
    ).toEqual([8, 8, 8]);
  });

  it("makes a cylinder round at the larger of the two axes across it", () => {
    expect(
      engineScales({ type: "cyly", scales: [4, 20, 8], offsets: [0, 0, 0] }),
    ).toEqual([8, 20, 8]);
    expect(
      engineScales({ type: "cylx", scales: [20, 4, 8], offsets: [0, 0, 0] }),
    ).toEqual([20, 8, 8]);
    expect(
      engineScales({ type: "cylz", scales: [4, 8, 20], offsets: [0, 0, 0] }),
    ).toEqual([8, 8, 20]);
  });

  it("leaves an ellipsoid stretched, since it is the one shape that can be", () => {
    expect(
      engineScales({
        type: "ellipsoid",
        scales: [4, 6, 8],
        offsets: [0, 0, 0],
      }),
    ).toEqual([4, 6, 8]);
  });
});

describe("resizeCollisionFace", () => {
  const box = {
    type: "box" as const,
    scales: [10, 10, 10] as [number, number, number],
    offsets: [0, 0, 0] as [number, number, number],
  };

  it("puts the dragged face where it was dragged to and leaves the other one", () => {
    const grown = resizeCollisionFace(box, 0, 1, 12);
    expect(grown.scales).toEqual([17, 10, 10]);
    expect(grown.offsets).toEqual([3.5, 0, 0]);
    // The face that was not dragged has not moved: it was at -5 and still is.
    expect(grown.offsets[0] - grown.scales[0] / 2).toBe(-5);
  });

  it("drags the low face the other way round", () => {
    const grown = resizeCollisionFace(box, 2, -1, -8);
    expect(grown.scales).toEqual([10, 10, 13]);
    expect(grown.offsets[2] + grown.scales[2] / 2).toBe(5);
  });

  it("holds a minimum size rather than turning the volume inside out", () => {
    const crushed = resizeCollisionFace(box, 1, 1, -30);
    expect(crushed.scales).toEqual([10, MIN_COLLISION_SIZE, 10]);
    // Still hanging off the same fixed face.
    expect(crushed.offsets[1] - crushed.scales[1] / 2).toBe(-5);
  });

  it("keeps a cylinder round, sizing both cross-section axes together", () => {
    const cylinder = {
      type: "cyly" as const,
      scales: [4, 20, 2] as [number, number, number],
      offsets: [0, 0, 0] as [number, number, number],
    };
    // Drawn 4 across, so the z face being dragged starts at 2, not at 1.
    const wider = resizeCollisionFace(cylinder, 2, 1, 6);
    expect(wider.scales).toEqual([8, 20, 8]);
    expect(wider.offsets).toEqual([0, 0, 2]);
    // Along the cylinder, only its length changes.
    expect(resizeCollisionFace(cylinder, 1, 1, 15).scales).toEqual([4, 25, 2]);
  });

  it("keeps a sphere round, whichever face is dragged", () => {
    const sphere = {
      type: "sphere" as const,
      scales: [6, 6, 6] as [number, number, number],
      offsets: [0, 0, 0] as [number, number, number],
    };
    expect(resizeCollisionFace(sphere, 0, -1, -5).scales).toEqual([8, 8, 8]);
  });

  it("lands the face on the pointer for every shape, not just the box", () => {
    for (const type of ["box", "ellipsoid", "sphere", "cylz"] as const) {
      const from = {
        type,
        scales: [6, 9, 3] as [number, number, number],
        offsets: [1, 0, -2] as [number, number, number],
      };
      const dragged = resizeCollisionFace(from, 0, 1, 11);
      expect(dragged.offsets[0] + engineScales(dragged)[0] / 2).toBeCloseTo(11);
    }
  });
});

describe("isIgnoredByEngine", () => {
  it("flags a volume the engine would read as none at all", () => {
    expect(
      isIgnoredByEngine({ type: "box", scales: [1, 1, 1], offsets: [0, 0, 0] }),
    ).toBe(true);
    expect(isIgnoredByEngine(derivedCollisionVolume(bounds(0, 0, 0)))).toBe(
      true,
    );
  });

  it("passes a volume with any axis wider than an elmo", () => {
    expect(
      isIgnoredByEngine({
        type: "box",
        scales: [1, 1, 1.5],
        offsets: [0, 0, 0],
      }),
    ).toBe(false);
  });
});

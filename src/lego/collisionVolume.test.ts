import { describe, expect, it } from "vitest";

import {
  derivedCollisionVolume,
  effectiveCollisionVolume,
  engineScales,
  isIgnoredByEngine,
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

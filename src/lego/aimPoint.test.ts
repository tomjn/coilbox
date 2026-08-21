import { describe, expect, it } from "vitest";

import { aimPoint } from "./aimPoint";
import { type LegoProject, newProject } from "./model";
import type { UnitBounds } from "./s3oBuild";

function bounds(mid: [number, number, number]): UnitBounds {
  return { mid, sizeX: 10, sizeY: 40, sizeZ: 10 };
}

function project(over: Partial<LegoProject> = {}): LegoProject {
  return {
    ...newProject({
      id: "p",
      rootPieceId: "root",
      name: "probe",
      packId: "lego",
      packVersion: "1",
      now: "2026-08-21T00:00:00Z",
    }),
    ...over,
  };
}

describe("aimPoint", () => {
  it("is the middle of the bounding box for a unit that has not been given one", () => {
    expect(aimPoint(project(), bounds([0, 20, 0]))).toEqual([0, 20, 0]);
  });

  /** A tall unit's box centre is halfway up a mast nobody would aim at. The
   *  point the unit carries wins. */
  it("is the point the unit carries once it has been given one", () => {
    expect(aimPoint(project({ mid: [0, 6, 0] }), bounds([0, 20, 0]))).toEqual([
      0, 6, 0,
    ]);
  });

  it("keeps following the box while no point has been given", () => {
    const doc = project();
    expect(aimPoint(doc, bounds([1, 2, 3]))).toEqual([1, 2, 3]);
    expect(aimPoint(doc, bounds([4, 5, 6]))).toEqual([4, 5, 6]);
  });
});

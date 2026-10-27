import { describe, expect, it } from "vitest";

import type { TerrainStep } from "@/blueprint/model";
import type { Point } from "@/scenario/model";
import { finishedGround } from "./finishedGround";
import { GRID_EXTENT, GRID_ORIGIN } from "./ground";
import { fieldFromGrid, groundHeight } from "./terrain";

/** Where a building at this offset stands, as the units layer reads it. */
function standsAt(terrain: TerrainStep[], offset: Point): number {
  const built = finishedGround({ terrain });
  if (!built) return 0;
  return groundHeight(
    fieldFromGrid(built.grid),
    GRID_ORIGIN.x + offset.x,
    GRID_ORIGIN.z + offset.z,
    GRID_EXTENT,
    GRID_EXTENT,
    built.minHeight,
    built.maxHeight,
  );
}

const pad: TerrainStep = {
  kind: "level",
  shape: "area",
  points: [
    { x: -128, z: -128 },
    { x: 128, z: -128 },
    { x: 128, z: 128 },
    { x: -128, z: 128 },
  ],
  height: 80,
  before: 0,
};

const trench: TerrainStep = {
  kind: "raise",
  shape: "wall",
  points: [
    { x: -160, z: 0 },
    { x: 160, z: 0 },
  ],
  height: -40,
  before: 0,
};

describe("the ground a blueprint's buildings stand on", () => {
  it("is the flat for a layout with no steps", () => {
    expect(finishedGround({})).toBeNull();
  });

  it("stands a building inside a +80 level step at +80", () => {
    expect(standsAt([pad], { x: 0, z: 0 })).toBeCloseTo(80, 0);
  });

  it("leaves a building beside a -40 trench at 0", () => {
    expect(standsAt([trench], { x: 0, z: 0 })).toBeCloseTo(-40, 0);
    expect(standsAt([trench], { x: 0, z: 160 })).toBeCloseTo(0, 0);
  });
});

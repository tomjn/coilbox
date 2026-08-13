import { describe, expect, it } from "vitest";

import type { Footprint } from "./footprint";
import type { BlueprintBuilding } from "./model";
import { offGridBuildings, onBuildGrid } from "./offGrid";

/** A square building spanning two build squares, which centres on the corner
 *  where four of them meet, and a one square one, which centres in the middle
 *  of a square. The two snap differently, which is the whole trap. */
const FOOTPRINTS: Record<string, Footprint> = {
  armsolar: { x: 2, z: 2 },
  armllt: { x: 1, z: 1 },
};

const footprintOf = (def: string) => FOOTPRINTS[def] ?? { x: 1, z: 1 };

const solar = (x: number, z: number): BlueprintBuilding => ({
  def: "armsolar",
  offset: { x, z },
  facing: 0,
});

describe("offGridBuildings", () => {
  it("says nothing about a layout the engine will build where it says", () => {
    expect(offGridBuildings([solar(0, 0), solar(32, 16)], footprintOf)).toEqual(
      [],
    );
  });

  it("names a building the grid will move, and where it will move it to", () => {
    expect(offGridBuildings([solar(0, 0), solar(5, 0)], footprintOf)).toEqual([
      { index: 1, def: "armsolar", from: { x: 5, z: 0 }, to: { x: 0, z: 0 } },
    ]);
  });

  /** Where the layout stands changes which of its numbers the grid disagrees
   *  with, so the base's own origin is part of the question. */
  it("asks about the ground the base is standing on", () => {
    const buildings = [solar(0, 0)];
    expect(offGridBuildings(buildings, footprintOf, { x: 0, z: 0 })).toEqual(
      [],
    );
    expect(offGridBuildings(buildings, footprintOf, { x: 8, z: 0 })).toEqual([
      { index: 0, def: "armsolar", from: { x: 0, z: 0 }, to: { x: 8, z: 0 } },
    ]);
  });

  it("counts an odd footprint from the middle of a square", () => {
    const llt: BlueprintBuilding = {
      def: "armllt",
      offset: { x: 0, z: 0 },
      facing: 0,
    };
    expect(offGridBuildings([llt], footprintOf)).toEqual([
      { index: 0, def: "armllt", from: { x: 0, z: 0 }, to: { x: 8, z: 8 } },
    ]);
  });
});

describe("onBuildGrid", () => {
  it("hands back nothing when there is nothing to move", () => {
    expect(onBuildGrid([solar(0, 0)], footprintOf)).toBeNull();
  });

  it("writes the drawn positions into the layout", () => {
    const moved = onBuildGrid([solar(0, 0), solar(5, 5)], footprintOf);
    expect(moved).toEqual([solar(0, 0), solar(0, 0)]);
  });

  it("moves the numbers and nothing else", () => {
    const turned: BlueprintBuilding = {
      def: "armsolar",
      offset: { x: 5, z: 0 },
      facing: 1,
      originalName: "Solar Collector",
    };
    expect(onBuildGrid([turned], footprintOf)).toEqual([
      { ...turned, offset: { x: 0, z: 0 } },
    ]);
  });
});

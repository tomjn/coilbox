import { describe, expect, it } from "vitest";

import type { BlueprintPayload } from "@/blueprint/payload";
import {
  BUILDING_GAP,
  blueprintShape,
  planLabel,
  WALL_THICKNESS,
} from "./preview";

function payload(fields: Partial<BlueprintPayload>): BlueprintPayload {
  return { name: "A layout", buildings: [], footprints: {}, ...fields };
}

const AT_ORIGIN = { offset: { x: 0, z: 0 }, facing: 0 as const };

const WALL = {
  kind: "raise" as const,
  shape: "wall" as const,
  points: [
    { x: 0, z: 0 },
    { x: 160, z: 0 },
  ],
  height: 16,
  before: 0,
};

describe("blueprintShape with terrain steps", () => {
  it("gives a layout of walls and no buildings a shape that fills its frame", () => {
    const shape = blueprintShape(payload({ terrain: [WALL] }));

    expect(shape).not.toBeNull();
    expect(shape?.squares).toEqual([]);
    expect(shape?.terrain).toHaveLength(1);
    // 160 elmos is 10 build squares, plus half the thickness at each end.
    expect(shape?.width).toBeCloseTo(10 + WALL_THICKNESS);
    expect(shape?.height).toBeCloseTo(WALL_THICKNESS);
  });

  it("still has no shape with neither buildings nor steps", () => {
    expect(blueprintShape(payload({}))).toBeNull();
    expect(blueprintShape(payload({ terrain: [] }))).toBeNull();
  });

  it("fits the frame to steps as well as buildings", () => {
    const shape = blueprintShape(
      payload({
        buildings: [{ def: "armsolar", ...AT_ORIGIN }],
        terrain: [
          {
            kind: "level",
            shape: "area",
            points: [
              { x: -80, z: -80 },
              { x: 80, z: -80 },
              { x: 80, z: 80 },
              { x: -80, z: 80 },
            ],
            height: 0,
            before: 0,
          },
        ],
      }),
    );

    expect(shape?.width).toBeCloseTo(10);
    expect(shape?.height).toBeCloseTo(10);
    // The building stands in the middle of the pad, not in a corner of the box.
    expect(shape?.squares[0].x).toBeCloseTo(5 - 0.5 + BUILDING_GAP);
    expect(shape?.terrain[0].points[0]).toEqual({ x: 0, y: 0 });
  });

  it("keeps the frame to the buildings when there are no steps", () => {
    const shape = blueprintShape(
      payload({ buildings: [{ def: "armsolar", ...AT_ORIGIN }] }),
    );
    expect(shape?.width).toBeCloseTo(1);
    expect(shape?.terrain).toEqual([]);
  });

  it("draws raised, dug and level ground in different tones", () => {
    const shape = blueprintShape(
      payload({
        terrain: [
          WALL,
          { ...WALL, height: -16 },
          { ...WALL, kind: "smooth", height: undefined },
          { ...WALL, kind: "level", height: 0 },
        ],
      }),
    );

    expect(shape?.terrain.map((step) => step.tone)).toEqual([
      "up",
      "down",
      "even",
      "even",
    ]);
  });

  it("draws a ramp as a band with an arrow pointing uphill", () => {
    const ramp = (heights: [number, number]) => {
      const shape = blueprintShape(
        payload({
          terrain: [
            {
              kind: "ramp",
              shape: "wall",
              points: [
                { x: 0, z: 0 },
                { x: 80, z: 0 },
              ],
              heights,
              width: 32,
              before: 0,
            },
          ],
        }),
      );
      if (!shape) throw new Error("no shape");
      return shape;
    };

    const up = ramp([0, 20]).terrain[0];
    expect(up.band).toHaveLength(4);
    // 32 elmos across is 2 build squares.
    const ys = (up.band ?? []).map((corner) => corner.y);
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(2);
    expect(up.tone).toBe("up");
    expect(up.arrow?.[1].x).toBeGreaterThan(up.arrow?.[0].x ?? 0);

    const down = ramp([20, 0]).terrain[0];
    expect(down.arrow?.[1].x).toBeLessThan(down.arrow?.[0].x ?? 0);

    expect(ramp([5, 5]).terrain[0].arrow).toBeNull();
    // The frame holds the band, which is wider than the path.
    expect(ramp([0, 20]).height).toBeCloseTo(2);
  });

  it("takes the tone of a ramp from the mean of its two heights", () => {
    const shape = blueprintShape(
      payload({
        terrain: [
          {
            kind: "ramp",
            shape: "wall",
            points: [
              { x: 0, z: 0 },
              { x: 80, z: 0 },
            ],
            heights: [-30, 10],
            width: 32,
            before: 0,
          },
        ],
      }),
    );
    expect(shape?.terrain[0].tone).toBe("down");
  });
});

describe("planLabel with terrain steps", () => {
  it("says nothing new about a layout without steps", () => {
    const shape = blueprintShape(
      payload({ buildings: [{ def: "armsolar", ...AT_ORIGIN }] }),
    );
    expect(shape && planLabel(shape)).toBe(
      "1 building over 1 by 1 build squares",
    );
  });

  it("counts steps, and needs no buildings", () => {
    const shape = blueprintShape(payload({ terrain: [WALL, WALL] }));
    expect(shape && planLabel(shape)).toBe(
      "No buildings, 2 terrain changes over 11 by 1 build squares",
    );
  });
});

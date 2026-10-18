import { describe, expect, it } from "vitest";

import { BIPED, projectFromPlan } from "./bodyPlans";
import type { LegoProject } from "./model";
import { plantedFeet } from "./plantedFeet";
import { at, CREATED, type ScriptEvent } from "./scriptPlayback";
import { fittedParams } from "./walkFit";

const FPS = 30;

let ids = 0;
function walker(speed?: number): LegoProject {
  const unit = projectFromPlan(BIPED, {
    id: "unit",
    rootPieceId: "root",
    name: "Biped",
    packId: "lego",
    packVersion: "1",
    now: "2026-10-18T00:00:00Z",
    newId: () => {
      ids += 1;
      return `id${ids}`;
    },
  });
  return {
    ...unit,
    ...(speed === undefined ? {} : { movement: { moveClass: "BOT2", speed } }),
    animations: [{ presetId: "walk.biped", params: {} }],
  };
}

const START = at(0.5);
const WALKING: ScriptEvent[] = [
  ...CREATED,
  { frame: START, callin: "StartMoving" },
];
const FRAMES = 300;

describe("the planted foot markers (#3350)", () => {
  const unit = walker(40);
  const params = fittedParams(unit, "walk.biped", {});
  const lap = Math.round(params.period * FPS);
  const down = Math.round((params.duty / 100) * lap);
  const half = lap / 2;
  const thigh = (name: string) => {
    const piece = unit.pieces.find((entry) => entry.name === name);
    if (!piece) throw new Error(`no ${name}`);
    return piece;
  };
  const feet = [
    { name: "lthigh", offset: 0 },
    { name: "rthigh", offset: half },
  ];

  it("marks each foot on every frame it is down and on none it is in the air", () => {
    const planted = plantedFeet(unit, WALKING, FRAMES);
    expect(planted).not.toBeNull();
    for (const { name, offset } of feet) {
      const piece = thigh(name);
      let downFrames = 0;
      let airFrames = 0;
      for (let frame = START + lap; frame < FRAMES; frame++) {
        const turn = (((frame - START - offset) % lap) + lap) % lap;
        const mark = planted?.[frame].get(piece.id);
        if (turn <= down) {
          downFrames++;
          expect(mark?.[0]).toBeCloseTo(piece.position[0], 9);
          // Half the sweep ahead of the hip when it lands, half behind as it
          // lifts, moving back at the unit's speed in between.
          const halfSweep = (40 * params.period * params.duty) / 100 / 2;
          expect(mark?.[1]).toBeCloseTo(
            piece.position[2] + halfSweep * (1 - (2 * turn) / down),
            9,
          );
        } else {
          airFrames++;
          expect(mark).toBeUndefined();
        }
      }
      expect(downFrames).toBeGreaterThan(0);
      expect(airFrames).toBeGreaterThan(0);
    }
  });

  it("marks nothing on the first lap, which starts from rest, or once the unit stops", () => {
    const stop = START + lap * 3;
    const planted = plantedFeet(
      unit,
      [...WALKING, { frame: stop, callin: "StopMoving" }],
      FRAMES,
    );
    for (let frame = 0; frame < START + lap; frame++) {
      expect(planted?.[frame].size).toBe(0);
    }
    expect(planted?.[stop - 1].size).toBeGreaterThan(0);
    for (let frame = stop; frame < FRAMES; frame++) {
      expect(planted?.[frame].size).toBe(0);
    }
  });

  it("marks nothing for a walk the solve does not apply to", () => {
    // No speed, so the walk is not fitted.
    expect(plantedFeet(walker(), WALKING, FRAMES)).toBeNull();
    // A script of the game maker's own, which the presets do not write.
    expect(
      plantedFeet({ ...unit, script: "-- mine" }, WALKING, FRAMES),
    ).toBeNull();
    // A unit that never starts moving.
    expect(plantedFeet(unit, CREATED, FRAMES)).toBeNull();
  });
});

import * as THREE from "three";
import { describe, expect, it } from "vitest";

import {
  ENGINE_ROTATION_ORDER,
  type TrackDelta,
  WALK_BIPED,
  WALK_LEGS,
  WALK_PAIRS,
} from "./animPresets";
import { fitWalk } from "./walkFit";

const FPS = 30;

/** A walker with the plans' default leg, split as they split it (#3350). */
const BODY = {
  legLength: 18.8,
  speed: 45,
  thighLength: 18.8 * 0.395,
  shinLength: 18.8 * (1 - 0.395),
};

function turn(delta: TrackDelta | null): THREE.Matrix4 {
  const [x, y, z] = delta?.rotation ?? [0, 0, 0];
  return new THREE.Matrix4().makeRotationFromEuler(
    new THREE.Euler(x, y, z, ENGINE_ROTATION_ORDER),
  );
}

/** Where a leg's ankle is from its hip, and the foot's turn in the unit,
 *  with the shin hanging the thigh's length below the hip and the foot the
 *  shin's length below the knee. */
function leg(
  params: Record<string, number>,
  side: "l" | "r",
  t: number,
  preset = WALK_BIPED,
  pair = 1,
) {
  const at = (segment: string) =>
    turn(preset.track(t, params, `leg.${side}${pair}.${segment}`));
  const thigh = at("thigh");
  const shin = thigh.clone().multiply(at("shin"));
  const ankle = new THREE.Vector3(0, -BODY.thighLength, 0)
    .applyMatrix4(thigh)
    .add(new THREE.Vector3(0, -BODY.shinLength, 0).applyMatrix4(shin));
  return {
    ankle,
    thighOut: preset.track(t, params, `leg.${side}${pair}.thigh`)
      ?.rotation?.[2],
    foot: shin.multiply(at("foot")),
  };
}

function frames(params: Record<string, number>): number[] {
  return Array.from(
    { length: Math.round(params.period * FPS) },
    (_, frame) => frame / FPS,
  );
}

describe("a walk that swings its legs out (#4487)", () => {
  const straight = fitWalk(BODY, {});
  const out = fitWalk(BODY, { splay: 20 });

  it("swings each foot out to its own side in the air, most at the middle", () => {
    // The left foot comes down at 0 and is in the air for the second half.
    const midAir = 0.75 * out.period;
    expect(leg(out, "l", midAir).ankle.x).toBeGreaterThan(1);
    expect(leg(out, "r", midAir - out.period / 2).ankle.x).toBeLessThan(-1);
    expect(leg(out, "l", midAir).thighOut).toBeCloseTo(20 * (Math.PI / 180));
  });

  it("does not move a foot on the ground at all", () => {
    let grounded = 0;
    for (const t of frames(out)) {
      for (const side of ["l", "r"] as const) {
        const swung = leg(out, side, t);
        if (swung.thighOut) continue;
        grounded++;
        expect(swung.ankle.toArray()).toEqual(
          leg(straight, side, t).ankle.toArray(),
        );
      }
    }
    // Half the time on the ground, two legs, plus the frames they land on.
    expect(grounded).toBeGreaterThanOrEqual(frames(out).length);
  });

  it("brings the leg back in before the foot lands", () => {
    const landing = out.period;
    expect(leg(out, "l", landing - 1 / FPS).thighOut ?? 0).toBeLessThan(
      leg(out, "l", 0.75 * out.period).thighOut ?? 0,
    );
    expect(leg(out, "l", landing).ankle.x).toBeCloseTo(0, 12);
  });

  it("keeps the foot level while the leg is out", () => {
    for (const t of frames(out)) {
      const { foot } = leg(out, "l", t);
      const level = new THREE.Vector3(0, 1, 0).applyMatrix4(foot);
      expect(level.x).toBeCloseTo(0, 9);
      expect(level.y).toBeCloseTo(1, 9);
      expect(level.z).toBeCloseTo(0, 9);
    }
  });

  it("swings out on every pair of a walk with more legs", () => {
    const six = fitWalk(BODY, { splay: 20, [WALK_PAIRS]: 3 });
    for (const pair of [1, 2, 3]) {
      const widest = Math.max(
        ...frames(six).map((t) => leg(six, "l", t, WALK_LEGS, pair).ankle.x),
      );
      expect(widest).toBeGreaterThan(1);
    }
  });

  it("leaves a walk with no outward swing as it was, turning about x alone", () => {
    for (const t of frames(straight)) {
      for (const segment of ["thigh", "shin", "foot"]) {
        const rotation = WALK_BIPED.track(
          t,
          straight,
          `leg.l1.${segment}`,
        )?.rotation;
        expect(rotation?.slice(1)).toEqual([0, 0]);
      }
    }
  });

  it("keeps the game maker's swing through the fit", () => {
    expect(fitWalk(BODY, { splay: 12 }).splay).toBe(12);
  });
});

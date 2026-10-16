import { describe, expect, it } from "vitest";
import { PREVIEW_FRAMES } from "./scriptPlayback";
import {
  anchorFor,
  DEFAULT_TARGET,
  TARGET_PATHS,
  type TargetMotion,
  type TargetScale,
  targetAt,
  targetTrack,
} from "./targetMotion";

/** A stand-in 5 elmos across beside a unit that moves an elmo a frame, which is
 *  what the preview tells a script its unit moves at unless told otherwise. */
const SCALE: TargetScale = { radius: 5, unitSpeed: 1, nearest: 3 };

function motion(over: Partial<TargetMotion>): TargetMotion {
  return { ...DEFAULT_TARGET, ...over };
}

/** Elmos between one frame's position and the next. */
function step(m: TargetMotion, frame: number, scale = SCALE): number {
  const a = targetAt(m, frame, scale).at;
  const b = targetAt(m, frame + 1, scale).at;
  return Math.hypot(b[0] - a[0], b[1] - a[1]) * scale.radius;
}

const PATHS = TARGET_PATHS.map((path) => path.value);

describe("a moving target", () => {
  /** The fixed track this replaces held still at two spots for most of the
   *  preview, so the weapon only had to chase it in between. */
  it.each(PATHS)("never holds still while %s", (path) => {
    for (let frame = 0; frame < PREVIEW_FRAMES; frame++) {
      expect(step(motion({ path }), frame)).toBeGreaterThan(0);
    }
  });

  /** A turn at the end of a crossing, or the start of the next approach, is
   *  the only frame allowed to differ: a turn covers less ground, and a new
   *  approach starts back where the last one did. */
  it.each(PATHS)("moves at the unit's speed times its own when %s", (path) => {
    for (const speed of [0.5, 1, 3]) {
      const m = motion({ path, speed });
      const steps = Array.from({ length: PREVIEW_FRAMES }, (_, frame) =>
        step(m, frame),
      );
      const atSpeed = steps.filter(
        (elmos) => Math.abs(elmos / (speed * SCALE.unitSpeed) - 1) < 1e-3,
      );
      expect(atSpeed.length).toBeGreaterThanOrEqual(PREVIEW_FRAMES * 0.9);
    }
  });

  it("follows the unit's own speed rather than a fixed one", () => {
    const fast = { ...SCALE, unitSpeed: 2 };
    expect(step(motion({ path: "circling" }), 10, fast)).toBeCloseTo(2);
    expect(step(motion({ path: "circling" }), 10)).toBeCloseTo(1);
  });

  it("holds at its anchor at no speed, facing the unit", () => {
    const still = motion({ speed: 0, anchor: [3, 4] });
    expect(targetAt(still, 0, SCALE).at).toEqual([3, 4]);
    expect(targetAt(still, 200, SCALE).at).toEqual([3, 4]);
    expect(targetAt(still, 0, SCALE).heading).toBeCloseTo(Math.atan2(-3, -4));
  });

  it("crosses side to side in front of the unit, through its anchor", () => {
    const m = motion({ path: "crossing", anchor: [0, 10] });
    const xs = Array.from(
      { length: PREVIEW_FRAMES },
      (_, frame) => targetAt(m, frame, SCALE).at,
    );
    for (const [, z] of xs) expect(z).toBeCloseTo(10);
    expect(Math.min(...xs.map(([x]) => x))).toBeLessThan(-3);
    expect(Math.max(...xs.map(([x]) => x))).toBeGreaterThan(3);
    expect(targetAt(m, 0, SCALE).at).toEqual([0, 10]);
  });

  it("circles at the anchor's distance", () => {
    const m = motion({ path: "circling", anchor: [6, 8] });
    for (const frame of [0, 50, 300]) {
      const [x, z] = targetAt(m, frame, SCALE).at;
      expect(Math.hypot(x, z)).toBeCloseTo(10);
    }
  });

  it("comes closer when approaching and goes away when retreating", () => {
    const distance = (m: TargetMotion, frame: number) =>
      Math.hypot(...targetAt(m, frame, SCALE).at);
    const closer = motion({ path: "approaching" });
    const away = motion({ path: "retreating" });
    expect(distance(closer, 5)).toBeLessThan(distance(closer, 0));
    expect(distance(away, 5)).toBeGreaterThan(distance(away, 0));
  });

  it("never approaches nearer than the unit allows", () => {
    const m = motion({ path: "approaching", anchor: [0, 1], speed: 2 });
    for (let frame = 0; frame < PREVIEW_FRAMES; frame++) {
      expect(Math.hypot(...targetAt(m, frame, SCALE).at)).toBeGreaterThan(
        SCALE.nearest - 1e-9,
      );
    }
  });

  it("faces the way it is going", () => {
    for (const path of PATHS) {
      const m = motion({ path });
      const a = targetAt(m, 20, SCALE);
      const b = targetAt(m, 21, SCALE).at;
      const heading = Math.atan2(b[0] - a.at[0], b[1] - a.at[1]);
      expect(Math.cos(heading - a.heading)).toBeCloseTo(1, 3);
    }
  });

  /** The stand-in snaps back to frame 0 when the preview loops, so a crossing
   *  and an approach are fitted to whole passes to make that no jump at all. */
  it.each([
    "crossing",
    "approaching",
    "retreating",
  ] as const)("ends where it began when %s", (path) => {
    for (const speed of [0.25, 1, 2.5]) {
      const m = motion({ path, speed });
      const first = targetAt(m, 0, SCALE).at;
      const last = targetAt(m, PREVIEW_FRAMES, SCALE).at;
      expect(last[0]).toBeCloseTo(first[0], 6);
      expect(last[1]).toBeCloseTo(first[1], 6);
    }
  });
});

describe("targetTrack", () => {
  it("keys every frame of the preview on the ground", () => {
    const track = targetTrack(DEFAULT_TARGET, SCALE);
    expect(track.keys).toHaveLength(PREVIEW_FRAMES + 1);
    expect(track.keys.map((key) => key.frame)).toEqual(
      Array.from({ length: PREVIEW_FRAMES + 1 }, (_, frame) => frame),
    );
    for (const key of track.keys) expect(key.pos[1]).toBe(0);
  });
});

describe("anchorFor", () => {
  /** A target let go mid-path carries on from where it was put, which is
   *  what makes a drag something the game maker can aim. */
  it.each(PATHS)("puts a %s target where it was let go", (path) => {
    for (const frame of [0, 37, 210]) {
      const m = motion({ path });
      const put: [number, number] = [-4, 9];
      const moved = { ...m, anchor: anchorFor(m, put, frame, SCALE) };
      const [x, z] = targetAt(moved, frame, SCALE).at;
      expect(x).toBeCloseTo(put[0], 6);
      expect(z).toBeCloseTo(put[1], 6);
    }
  });

  it("is where it was put for a target that is not moving", () => {
    expect(anchorFor(motion({ speed: 0 }), [2, 3], 99, SCALE)).toEqual([2, 3]);
  });
});

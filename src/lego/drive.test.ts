import { describe, expect, it } from "vitest";
import { withWorld } from "./aimResolver";
import {
  type DriveMotion,
  driveAlong,
  driveMotion,
  ENGINE_MIN_SCRIPT_CHANGE_HEADING,
  headingFromVector,
  pathPoints,
} from "./drive";
import { groundHeight, groundNormal } from "./environment";
import type { LegoProject } from "./model";
import { PREVIEW_FRAMES } from "./scriptPlayback";

/** Two elmos a frame and 600 heading units a frame, which is a little over
 *  three degrees. */
const MOTION: DriveMotion = { speed: 2, turnRate: 600 };

function drive(
  points: [number, number][],
  options: Partial<Parameters<typeof driveAlong>[2]> = {},
) {
  return driveAlong(points, MOTION, {
    start: 15,
    frames: PREVIEW_FRAMES,
    ground: null,
    tilts: false,
    minScriptChangeHeading: 1,
    ...options,
  });
}

describe("headingFromVector", () => {
  /** `GetHeadingFromVector`: 0 faces +z, a quarter circle is +x, which is
   *  the unit's left. */
  it("counts 65536 to a circle from +z towards +x", () => {
    expect(headingFromVector(0, 1)).toBe(0);
    expect(headingFromVector(1, 0)).toBe(16384);
    expect(headingFromVector(-1, 0)).toBe(-16384);
  });

  it("does not turn straight behind into straight ahead", () => {
    expect(Math.abs(headingFromVector(0, -1))).toBe(32767);
    expect(Math.abs(headingFromVector(-0, -1))).toBe(32767);
  });
});

describe("driveAlong", () => {
  /** `StartMoving` on the order's frame, told it is not reversing, then
   *  `StopMoving` on the frame it arrives (`Unit.cpp:953-955`,
   *  `GroundMoveType.cpp:2436,2455`). */
  it("starts moving, then stops when it arrives", () => {
    const run = drive(pathPoints("straight", MOTION, []));
    const callins = run.events.map((event) => event.callin);

    expect(run.events[0]).toEqual({
      frame: 15,
      callin: "StartMoving",
      args: [0],
    });
    expect(callins.at(-1)).toBe("StopMoving");
    // Eight seconds of travel at its own speed, 480 elmos at two a frame,
    // less the goal radius it stops inside.
    expect(run.arrived).toBe(15 + 237);
    expect(run.events.at(-1)?.frame).toBe(run.arrived);
  });

  /** Straight ahead needs no turn, so nothing changes heading. */
  it("drives straight ahead without turning", () => {
    const run = drive(pathPoints("straight", MOTION, []));
    expect(run.events.filter((e) => e.callin === "ChangeHeading")).toEqual([]);
    expect(run.frames.every((frame) => frame.heading === 0)).toBe(true);
    // Not moving before the order or after arriving, its speed while it does.
    expect(run.frames[15].speed).toBe(0);
    expect(run.frames[16].speed).toBe(2);
    expect(run.frames[16].pos).toEqual([0, 0, 2]);
    expect(run.frames[run.arrived ?? 0].speed).toBe(0);
  });

  /**
   * The engine's turn inertia: a ground unit's turn speed grows by a third of
   * its turn rate a frame, truncated to a whole heading unit, and never
   * passes the turn rate (`IPathController.cpp:66-94`,
   * `GroundMoveType.cpp:519`). A turn right is negative.
   */
  it("turns into a bend at the engine's rate, sending each frame's turn", () => {
    const run = drive(pathPoints("bend", MOTION, []));
    const turns = run.events.filter((e) => e.callin === "ChangeHeading");
    const deltas = turns.map((event) => event.args?.[0] ?? 0);

    expect(turns.length).toBeGreaterThan(0);
    expect(deltas.slice(0, 4)).toEqual([-199, -399, -599, -600]);
    expect(deltas.every((delta) => Math.abs(delta) <= 600)).toBe(true);
    // Each frame's heading is the last one's plus the turn sent on it.
    for (const event of turns) {
      const before = run.frames[event.frame - 1].heading;
      expect(run.frames[event.frame].heading).toBe(
        before + (event.args?.[0] ?? 0),
      );
    }
    // It ends up facing about -x, a quarter turn right. Not exactly: it cut
    // the corner, as a unit in the game does, so it comes at the end of the
    // path from a little to its left.
    const last = run.frames[run.arrived ?? 0].heading;
    expect(Math.abs(last + 16384)).toBeLessThan(4096);
    // In the engine's order: started, turned, stopped.
    expect(run.events[0].callin).toBe("StartMoving");
    expect(run.events.at(-1)?.callin).toBe("StopMoving");
    expect(turns[0].frame).toBeGreaterThan(15);
  });

  /** Slower the further it has to turn, down to a tenth of its speed, then
   *  back to full once it faces the way it is going
   *  (`GroundMoveType.cpp:1332-1347`). */
  it("slows for a corner and speeds up again after it", () => {
    const run = drive(pathPoints("bend", MOTION, []));
    const turning = run.events.find((e) => e.callin === "ChangeHeading");
    const speeds = run.frames.map((frame) => frame.speed);
    const slowest = Math.min(...speeds.filter((speed) => speed > 0));
    expect(slowest).toBeCloseTo(0.2, 9);
    expect(speeds[(turning?.frame ?? 0) - 1]).toBe(2);
    expect(speeds[(run.arrived ?? 0) - 40]).toBe(2);
  });

  /** The engine's own threshold is more than any frame can turn, so a unit
   *  nothing has lowered it for is never sent `ChangeHeading`. */
  it("sends no ChangeHeading at the engine's default threshold", () => {
    const run = drive(pathPoints("circle", MOTION, []), {
      minScriptChangeHeading: ENGINE_MIN_SCRIPT_CHANGE_HEADING,
    });
    expect(ENGINE_MIN_SCRIPT_CHANGE_HEADING).toBe(32767);
    expect(run.events.map((e) => e.callin)).toEqual([
      "StartMoving",
      "StopMoving",
    ]);
    // It still turns all the way round.
    expect(new Set(run.frames.map((f) => Math.sign(f.heading))).size).toBe(3);
  });

  /** The circle comes back to where it started, inside the preview. */
  it("drives a circle round to where it started", () => {
    const run = drive(pathPoints("circle", MOTION, []));
    expect(run.arrived).not.toBeNull();
    expect(run.arrived ?? PREVIEW_FRAMES).toBeLessThan(PREVIEW_FRAMES);
    const [x, , z] = run.frames[run.arrived ?? 0].pos;
    expect(Math.hypot(x, z)).toBeLessThanOrEqual(8);
  });

  /** On a slope it is on the ground wherever it is, and a unit that tilts
   *  stands on the slope's normal there. */
  it("follows the ground and tilts to it", () => {
    const ground = { kind: "uneven" as const, degrees: 20, width: 64 };
    const run = drive(pathPoints("bend", MOTION, []), { ground, tilts: true });
    for (const frame of [40, 120, 200]) {
      const { pos, up } = run.frames[frame];
      expect(pos[1]).toBeCloseTo(groundHeight(ground, pos[0], pos[2]), 9);
      expect(up).toEqual(groundNormal(ground, pos[0], pos[2]));
    }
    const upright = drive(pathPoints("bend", MOTION, []), {
      ground,
      tilts: false,
    });
    expect(upright.frames[120].up).toBeNull();
  });

  it("stands still with no path to drive", () => {
    const run = drive([]);
    expect(run.events).toEqual([]);
    expect(run.frames.every((f) => f.speed === 0)).toBe(true);
  });
});

describe("driveMotion", () => {
  const project = (extra: Partial<LegoProject>) =>
    ({ pieces: [], ...extra }) as unknown as LegoProject;

  /** Speed in elmos a second and turn rate a frame, as the definition
   *  carries them. */
  it("reads the movement section the next export would write", () => {
    const source = driveMotion(
      project({ movement: { moveClass: "TANK2", speed: 60, turnRate: 450 } }),
    );
    expect(source).toEqual({
      motion: { speed: 2, turnRate: 450 },
      speed: "movement",
      turnRate: "movement",
    });
  });

  it("reads a game unit's own definition when the unit has no movement", () => {
    const source = driveMotion(
      project({ gameUnitDef: { speed: 45, turnrate: 30000000 } }),
    );
    expect(source.motion).toEqual({ speed: 1.5, turnRate: 32767 });
    expect(source.speed).toBe("definition");
  });

  /** One elmo a frame, the preview's own, and the engine's floor of 1 for a
   *  turn rate nothing sets. */
  it("falls back to the preview's speed and the engine's least turn", () => {
    expect(driveMotion(project({}))).toEqual({
      motion: { speed: 1, turnRate: 1 },
      speed: "preview",
      turnRate: "none",
    });
  });
});

describe("withWorld on a drive", () => {
  /** Every event carries the unit's pose on its frame, and on a shaped ground
   *  the up it stands on there rather than the one at the origin. */
  it("tells each frame where the unit is", () => {
    const ground = { kind: "uneven" as const, degrees: 20, width: 64 };
    const run = drive(pathPoints("bend", MOTION, []), { ground, tilts: true });
    const events = withWorld([{ frame: 100, ambient: true }], null, {
      radius: 0,
      self: { radius: 10, height: 12 },
      attachPiece: () => null,
      ground: { shape: ground, up: [0, 1, 0] },
      drive: { frames: run.frames, maxSpeed: 2 },
    });
    const world = events[0].world;
    expect(world?.drive).toEqual({
      pos: run.frames[100].pos,
      heading: run.frames[100].heading,
      speed: 2,
      maxSpeed: 2,
    });
    expect(world?.ground?.up).toEqual(run.frames[100].up);
  });
});

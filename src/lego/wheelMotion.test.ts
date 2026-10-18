import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

import { PRESETS, ROLES } from "./animPresets";
import {
  type DriveFrame,
  type DriveMotion,
  driveAlong,
  pathPoints,
} from "./drive";
import { buildLuaScript } from "./luaScript";
import { type LegoPiece, type LegoProject, newProject } from "./model";
import { scenarioById } from "./scriptPlayback";
import { soloScenario } from "./soloPreset";
import { frontWheels, wheelRadius } from "./wheelFit";

const DEG = Math.PI / 180;
const FPS = 30;
/** The engine's `COBSCALE`, what `CURRENT_SPEED` is multiplied by. */
const COBSCALE = 65536;
/** The radius of the test wheels: a cylinder 6 across. */
const RADIUS = 3;

function wheel(
  name: string,
  x: number,
  z: number,
  extra: Partial<LegoPiece> = {},
): LegoPiece {
  return {
    id: name,
    name,
    parentId: "root",
    partId: null,
    // A cylinder whose axle runs along x, 2 long and 6 across.
    shape: {
      kind: "cylinder",
      size: [2, 2 * RADIUS, 2 * RADIUS],
      options: { axis: 0 },
    },
    position: [x, 0, z],
    rotation: [0, 0, 0],
    // The right hand wheel of a pair is the left one mirrored, which is a
    // negative scale on x and nothing else (`mirror.ts`).
    scale: [x < 0 ? -1 : 1, 1, 1],
    role: "wheel",
    ...extra,
  };
}

/** Two axles of two wheels, the right hand ones mirror twins of the left. */
function pieces(): LegoPiece[] {
  return [
    {
      id: "body",
      name: "body",
      parentId: "root",
      partId: null,
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
      role: "base",
    },
    wheel("wheel_fl", 10, 12),
    wheel("wheel_fr", -10, 12),
    wheel("wheel_rl", 10, -12),
    wheel("wheel_rr", -10, -12),
  ];
}

function unit(
  presetId: string,
  params: Record<string, number> = {},
  options: {
    pieces?: LegoPiece[];
    movement?: LegoProject["movement"];
  } = {},
): LegoProject {
  const base = newProject({
    id: "car",
    rootPieceId: "root",
    name: "Car",
    packId: "lego",
    packVersion: "1",
    now: "2026-10-18T00:00:00Z",
  });
  return {
    ...base,
    pieces: [...base.pieces, ...(options.pieces ?? pieces())],
    animations: [{ presetId, params }],
    ...(options.movement ? { movement: options.movement } : {}),
  };
}

interface Call {
  frame: number;
  call: "Spin" | "StopSpin" | "Turn";
  piece: string;
  axis: number;
  value: number;
}

/** What the unit is doing on one frame. `speed` is elmos a frame. */
interface Moment {
  speed: number;
  reversing?: boolean;
  heading?: number;
}

/**
 * Runs the unit's script under luajit with the engine calls stubbed, one
 * frame at a time. `moment(frame)` is what `GetUnitValue` answers, as the
 * engine scales it. `StartMoving` fires on `start` and `StopMoving` on `stop`.
 * Threads sleep, wake and are killed by `Signal` as the framework's do.
 */
function callsOver(
  lua: string,
  moments: Moment[],
  start: number,
  stop: number,
): Call[] {
  const speeds = moments.map((m) => Math.trunc(m.speed * COBSCALE));
  const reversing = moments.map((m) => (m.reversing ? 1 : 0));
  const headings = moments.map((m) => m.heading ?? 0);
  const harness = `
x_axis, y_axis, z_axis = 1, 2, 3
COB = { CURRENT_SPEED = 29, REVERSING = 109, HEADING = 82 }
local frame = 0
local speeds = {${speeds.join(",")}}
local reversing = {${reversing.join(",")}}
local headings = {${headings.join(",")}}
local log = {}
local threads = {}
local current = nil
function piece(name) return name end
function GetUnitValue(id)
  if id == COB.CURRENT_SPEED then return speeds[frame + 1] end
  if id == COB.REVERSING then return reversing[frame + 1] end
  if id == COB.HEADING then return headings[frame + 1] end
  error("read value " .. tostring(id))
end
local function record(call, p, axis, value)
  log[#log + 1] = frame .. " " .. call .. " " .. p .. " " .. axis .. " " .. string.format("%.9g", value)
end
function Turn(p, axis, angle, speed)
  assert(type(speed) == "number", "Turn needs a speed")
  record("Turn", p, axis, angle)
end
function Spin(p, axis, speed, accel) record("Spin", p, axis, speed) end
function StopSpin(p, axis) record("StopSpin", p, axis, 0) end
function Move() end
function Explode() end
function WaitForTurn() end
function WaitForMove() end
function SetSignalMask(mask) current.mask = mask end
function Signal(mask)
  for _, t in ipairs(threads) do
    if t.mask == mask then t.dead = true end
  end
end
function Sleep(ms) coroutine.yield(math.floor(ms / 33)) end
local function resume(t)
  current = t
  local ok, wait = coroutine.resume(t.co)
  assert(ok, wait)
  t.wake = frame + (wait or 0)
end
function StartThread(fn, ...)
  local t = { co = coroutine.create(fn), mask = nil }
  threads[#threads + 1] = t
  resume(t)
end
SFX = { SHATTER = 1 }
script = {}
local chunk = assert(loadstring(io.read("*a")))
chunk()
if script.Create then script.Create() end
for f = 0, ${moments.length - 1} do
  frame = f
  if f == ${start} then script.StartMoving(reversing[f + 1] == 1) end
  if f == ${stop} then script.StopMoving() end
  for _, t in ipairs(threads) do
    if not t.dead and coroutine.status(t.co) == "suspended" and t.wake <= f then
      resume(t)
    end
  end
end
for _, line in ipairs(log) do io.write(line .. "\\n") end
`;
  const result = spawnSync("luajit", ["-e", harness], { input: lua });
  if (result.status !== 0) {
    throw new Error(`luajit failed: ${result.stderr.toString()}`);
  }
  return result.stdout
    .toString()
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [frame, call, piece, axis, value] = line.split(" ");
      return {
        frame: Number(frame),
        call: call as Call["call"],
        piece,
        axis: Number(axis),
        // Plus 0 turns a -0 into 0.
        value: Number(value) + 0,
      };
    });
}

const START = 10;

/** A drive along a straight line, as the preview plays one. */
function drive(
  path: "bend" | "straight" | "circle" | "behind",
  motion: DriveMotion,
  frames = 450,
) {
  const run = driveAlong(pathPoints(path, motion, []), motion, {
    start: START,
    frames,
    ground: null,
    tilts: false,
    minScriptChangeHeading: 1,
  });
  const moments: Moment[] = run.frames.map((frame: DriveFrame) => ({
    speed: frame.speed,
    reversing: frame.reversing,
    heading: frame.heading,
  }));
  return { run, moments, stop: run.arrived ?? frames - 1 };
}

const MOTION: DriveMotion = { speed: 2, turnRate: 600 };

function play(
  project: LegoProject,
  path: "bend" | "straight" | "circle" | "behind" = "straight",
  motion: DriveMotion = MOTION,
) {
  const { moments, stop, run } = drive(path, motion);
  const calls = callsOver(buildLuaScript(project), moments, START, stop);
  return { calls, moments, stop, run };
}

describe("the wheel roles and presets", () => {
  it("adds wheels.steer and body.rock, each needing the one role it moves", () => {
    const steer = PRESETS.find((p) => p.id === "wheels.steer");
    const rock = PRESETS.find((p) => p.id === "body.rock");
    expect(steer?.requires).toEqual([{ role: "wheel", count: 1 }]);
    expect(rock?.requires).toEqual([{ role: "base", count: 1 }]);
    expect(steer?.params.map((p) => p.id)).toEqual(["max"]);
    expect(rock?.params.map((p) => p.id)).toEqual(["strength"]);
    expect(ROLES.some((r) => r.id === "wheel")).toBe(true);
  });

  it("plays the new presets, and wheels turning, under a drive", () => {
    for (const id of ["wheels.roll", "wheels.steer", "body.rock"]) {
      expect(soloScenario(id), id).toBe("driving");
      expect(scenarioById("driving")?.drive).toBe(true);
    }
  });

  it("reads speed and direction with GetUnitValue", () => {
    const lua = buildLuaScript(unit("wheels.roll"));
    expect(lua).toContain("GetUnitValue(COB.CURRENT_SPEED)");
    expect(lua).toContain("GetUnitValue(COB.REVERSING)");
  });
});

describe("measuring the wheels", () => {
  it("takes the radius from half the cylinder's width across its axle", () => {
    const project = unit("wheels.roll");
    for (const name of ["wheel_fl", "wheel_fr"]) {
      expect(wheelRadius(project, name)).toBeCloseTo(RADIUS, 9);
    }
  });

  it("reads a mirror twin's radius the same as the original's", () => {
    const project = unit("wheels.roll");
    const right = project.pieces.find((p) => p.name === "wheel_fr");
    expect(right?.scale[0]).toBe(-1);
    expect(wheelRadius(project, "wheel_fr")).toBe(
      wheelRadius(project, "wheel_fl"),
    );
  });

  it("follows the piece's scale, and takes the biggest cylinder under it", () => {
    const hub = wheel("hub", 0, 0, {
      parentId: "tyre",
      role: undefined,
      shape: { kind: "cylinder", size: [2, 4, 4], options: { axis: 0 } },
    });
    const tyre = wheel("tyre", 10, 12, { scale: [1, 2, 2] });
    const project = unit("wheels.roll", {}, { pieces: [tyre, hub] });
    // The tyre is 6 across and scaled by 2. The hub inside it is 4 across, 8
    // once the tyre's scale reaches it.
    expect(wheelRadius(project, "tyre")).toBeCloseTo(2 * RADIUS, 9);
  });

  it("has no radius for a piece with no cylinder, or one that is not on x", () => {
    const plain = wheel("plain", 10, 12, { shape: undefined, partId: "x" });
    const sideways = wheel("sideways", 10, 12, {
      shape: { kind: "cylinder", size: [6, 6, 6], options: { axis: 1 } },
    });
    const project = unit("wheels.roll", {}, { pieces: [plain, sideways] });
    expect(wheelRadius(project, "plain")).toBeNull();
    expect(wheelRadius(project, "sideways")).toBeNull();
  });

  it("calls the wheels ahead of the middle of the wheels the front ones", () => {
    const project = unit("wheels.steer");
    expect(frontWheels(project).sort()).toEqual(["wheel_fl", "wheel_fr"]);
  });

  it("steers only the first axle of three", () => {
    const three = [
      wheel("a_l", 10, 20),
      wheel("a_r", -10, 20),
      wheel("b_l", 10, 0),
      wheel("b_r", -10, 0),
      wheel("c_l", 10, -20),
      wheel("c_r", -10, -20),
    ];
    const project = unit("wheels.steer", {}, { pieces: three });
    expect(frontWheels(project).sort()).toEqual(["a_l", "a_r"]);
  });

  it("steers nothing when every wheel is on one axle", () => {
    const one = [wheel("l", 10, 4), wheel("r", -10, 4)];
    expect(frontWheels(unit("wheels.steer", {}, { pieces: one }))).toEqual([]);
  });
});

describe("wheels turning at the unit's speed", () => {
  /** The rate a wheel of radius `r` turns at to roll at `speed` elmos a frame. */
  const rollRate = (speed: number, r = RADIUS) => (speed * FPS) / r;

  /**
   * `CURRENT_SPEED` reaches the script in whole 65536ths of an elmo a frame,
   * so a rate is as exact as one of them: `30 / 65536 / radius` rad/s. The
   * script's constant is written to six significant figures, which adds a
   * millionth of the rate. Both together are well inside this.
   */
  const tolerance = (rate: number, r = RADIUS) =>
    FPS / COBSCALE / r + rate * 1e-6;

  it("turns every wheel at speed over radius when cruising", () => {
    const { calls, moments, stop } = play(unit("wheels.roll"));
    const cruise = moments.findIndex((m) => m.speed === MOTION.speed);
    expect(cruise).toBeGreaterThan(START);
    const spins = calls.filter((c) => c.call === "Spin" && c.frame < stop);
    const last = new Map(spins.map((c) => [c.piece, c.value]));
    expect([...last.keys()].sort()).toEqual([
      "wheel_fl",
      "wheel_fr",
      "wheel_rl",
      "wheel_rr",
    ]);
    for (const value of last.values()) {
      expect(Math.abs(value - rollRate(MOTION.speed))).toBeLessThan(
        tolerance(rollRate(MOTION.speed)),
      );
    }
  });

  it("follows the speed as the unit speeds up", () => {
    const { calls, moments } = play(unit("wheels.roll"));
    const spins = calls.filter(
      (c) => c.call === "Spin" && c.piece === "wheel_fl",
    );
    expect(spins.length).toBeGreaterThan(3);
    for (const spin of spins) {
      const expected = rollRate(moments[spin.frame].speed);
      expect(Math.abs(spin.value - expected)).toBeLessThan(tolerance(expected));
    }
  });

  it("keeps following the speed down after StopMoving, then stops", () => {
    const { calls, moments, stop } = play(unit("wheels.roll"), "straight", {
      ...MOTION,
      acceleration: 0.05,
      brakeRate: 0.05,
    });
    // The unit is still rolling when the engine says StopMoving.
    expect(moments[stop].speed).toBeGreaterThan(0);
    const after = calls.filter(
      (c) => c.piece === "wheel_fl" && c.frame > stop && c.call === "Spin",
    );
    expect(after.length).toBeGreaterThan(1);
    const values = after.map((c) => c.value);
    for (let i = 1; i < values.length; i++) {
      expect(values[i]).toBeLessThanOrEqual(values[i - 1]);
    }
    // It ends with StopSpin once the speed reads 0, not with a Spin to 0.
    expect(calls.filter((c) => c.piece === "wheel_fl").at(-1)?.call).toBe(
      "StopSpin",
    );
    const stopSpin = calls.find(
      (c) => c.piece === "wheel_fl" && c.call === "StopSpin",
    );
    const rest = moments.findIndex((m, i) => i > stop && m.speed === 0);
    expect(stopSpin?.frame).toBeGreaterThanOrEqual(rest);
  });

  it("turns a bigger wheel slower", () => {
    const big = [
      wheel("big", 10, 4, {
        shape: { kind: "cylinder", size: [2, 12, 12], options: { axis: 0 } },
      }),
      wheel("small", -10, 4),
    ];
    const { calls } = play(unit("wheels.roll", {}, { pieces: big }));
    const rate = (name: string) =>
      calls
        .filter((c) => c.call === "Spin" && c.piece === name && c.frame < 100)
        .at(-1)?.value ?? 0;
    expect(rate("big") * 2).toBeCloseTo(rate("small"), 3);
  });

  it("turns the other way when the unit backs up", () => {
    const motion: DriveMotion = { speed: 2, turnRate: 600, reverseSpeed: 1 };
    const { calls, moments } = play(unit("wheels.roll"), "behind", motion);
    const backing = calls.filter(
      (c) =>
        c.call === "Spin" &&
        c.piece === "wheel_fl" &&
        moments[c.frame].reversing &&
        moments[c.frame].speed > 0,
    );
    expect(backing.length).toBeGreaterThan(0);
    for (const spin of backing) {
      expect(spin.value).toBeLessThan(0);
      const expected = rollRate(moments[spin.frame].speed);
      expect(Math.abs(Math.abs(spin.value) - expected)).toBeLessThan(
        tolerance(expected),
      );
    }
  });

  it("spins both wheels of a mirrored pair the same way, about x", () => {
    const { calls } = play(unit("wheels.roll"));
    const spins = (name: string) =>
      calls.filter((c) => c.call === "Spin" && c.piece === name);
    expect(spins("wheel_fl").length).toBeGreaterThan(0);
    expect(spins("wheel_fr").map((c) => c.value)).toEqual(
      spins("wheel_fl").map((c) => c.value),
    );
    for (const c of calls.filter((x) => x.call === "Spin")) {
      expect(c.axis).toBe(1);
      expect(c.value).toBeGreaterThanOrEqual(0);
    }
  });

  it("uses the radius slider for every wheel when it is set", () => {
    const { calls } = play(unit("wheels.roll", { radius: 2 }));
    const last = calls
      .filter(
        (c) => c.call === "Spin" && c.piece === "wheel_rr" && c.frame < 100,
      )
      .at(-1);
    expect(
      Math.abs((last?.value ?? 0) - rollRate(MOTION.speed, 2)),
    ).toBeLessThan(tolerance(rollRate(MOTION.speed, 2), 2));
  });

  it("keeps the fixed rate for a wheel it cannot measure", () => {
    const plain = [wheel("plain", 10, 12, { shape: undefined, partId: "x" })];
    const lua = buildLuaScript(
      unit("wheels.roll", { rate: 2 }, { pieces: plain }),
    );
    expect(lua).toContain(
      `Spin(plain, x_axis, ${Number((Math.PI * 4).toFixed(4))})`,
    );
    expect(lua).toContain("StopSpin(plain, x_axis)");
    expect(lua).not.toContain("StartThread");
  });
});

describe("front wheels steering", () => {
  const MOTION_BEND: DriveMotion = { speed: 2, turnRate: 600 };

  function turns(path: "bend" | "circle" | "straight", params = {}) {
    const { calls, moments, stop } = play(
      unit("wheels.steer", params),
      path,
      MOTION_BEND,
    );
    return { calls: calls.filter((c) => c.call === "Turn"), moments, stop };
  }

  it("turns the front wheels about the vertical axis and no others", () => {
    const { calls } = turns("circle");
    expect(calls.length).toBeGreaterThan(0);
    const moved = new Set(
      calls.filter((c) => c.value !== 0).map((c) => c.piece),
    );
    expect([...moved].sort()).toEqual(["wheel_fl", "wheel_fr"]);
    for (const c of calls) expect(c.axis).toBe(2);
    expect(
      calls.some((c) => c.piece === "wheel_rl" || c.piece === "wheel_rr"),
    ).toBe(false);
  });

  it("swings to the left round a circle to the left, held all the way", () => {
    const { calls } = turns("circle");
    const held = calls.filter(
      (c) => c.piece === "wheel_fl" && c.frame > 100 && c.frame < 300,
    );
    expect(held.length).toBeGreaterThan(0);
    expect(held.every((c) => c.value > 0)).toBe(true);
  });

  it("swings to the right in a right bend, then straightens", () => {
    const { calls, stop } = turns("bend");
    const left = calls.filter((c) => c.piece === "wheel_fl");
    expect(Math.min(...left.map((c) => c.value))).toBeLessThan(-5 * DEG);
    expect(Math.max(...left.map((c) => c.value))).toBeLessThanOrEqual(0);
    expect(left.filter((c) => c.frame < stop).at(-1)?.value).toBe(0);
  });

  it("turns the two front wheels together", () => {
    const { calls } = turns("bend");
    const of = (name: string) =>
      calls.filter((c) => c.piece === name).map((c) => c.value);
    expect(of("wheel_fr")).toEqual(of("wheel_fl"));
  });

  it("stays straight driving straight ahead", () => {
    const { calls } = turns("straight");
    expect(calls.filter((c) => c.value !== 0)).toEqual([]);
  });

  it("never swings past the slider", () => {
    const { calls } = turns("circle", { max: 10 });
    const peak = Math.max(...calls.map((c) => Math.abs(c.value)));
    expect(peak).toBeCloseTo(10 * DEG, 3);
  });

  it("turns the other way when the unit backs up through the same heading change", () => {
    // The same rising heading, once going forward and once reversing.
    const frames = 60;
    const heading = (f: number) => Math.min(Math.max(f - 20, 0), 20) * 300;
    const run = (reversing: boolean) =>
      callsOver(
        buildLuaScript(unit("wheels.steer")),
        Array.from({ length: frames }, (_, f) => ({
          speed: 1,
          reversing,
          heading: heading(f),
        })),
        START,
        frames - 1,
      ).filter((c) => c.piece === "wheel_fl");
    const forward = run(false).map((c) => c.value);
    const backward = run(true).map((c) => c.value);
    expect(Math.max(...forward)).toBeGreaterThan(0);
    expect(Math.min(...backward)).toBeLessThan(0);
    expect(backward).toEqual(forward.map((v) => (v === 0 ? 0 : -v)));
  });
});

describe("the body rocking", () => {
  /** Slow enough to speed up over many polls, so the lean has a shape. */
  const SLOW: DriveMotion = {
    speed: 2,
    turnRate: 600,
    acceleration: 0.05,
    brakeRate: 0.1,
  };

  /** `declared` is what the unit's definition says its rates are, which is
   *  what the script scales the lean by. `motion` is what it really does. */
  function lean(
    params: Record<string, number> = {},
    motion = SLOW,
    declared: DriveMotion = motion,
  ) {
    const project = unit("body.rock", params, {
      movement: {
        moveClass: "TANK",
        acceleration: declared.acceleration,
        brakeRate: declared.brakeRate,
      },
    });
    const { calls, moments, stop } = play(project, "straight", motion);
    return {
      calls: calls.filter((c) => c.call === "Turn" && c.piece === "body"),
      moments,
      stop,
    };
  }

  it("turns the body about x and nothing else", () => {
    const { calls } = lean();
    expect(calls.length).toBeGreaterThan(0);
    for (const c of calls) expect(c.axis).toBe(1);
  });

  it("pitches back while it speeds up", () => {
    const { calls, moments } = lean();
    const cruise = moments.findIndex((m) => m.speed === SLOW.speed);
    const during = calls.filter((c) => c.frame > START && c.frame < cruise);
    expect(during.length).toBeGreaterThan(3);
    expect(Math.min(...during.map((c) => c.value))).toBeLessThan(-0.5 * DEG);
    expect(during.every((c) => c.value <= 0)).toBe(true);
  });

  it("pitches forward while it brakes", () => {
    const { calls, moments, stop } = lean();
    const cruise = moments.findIndex((m) => m.speed === SLOW.speed);
    const brakingFrom = moments.findIndex(
      (m, i) => i > cruise && m.speed < SLOW.speed,
    );
    const braking = calls.filter(
      (c) => c.frame >= brakingFrom && c.frame <= stop + 60,
    );
    expect(Math.max(...braking.map((c) => c.value))).toBeGreaterThan(0.5 * DEG);
  });

  it("is level while cruising and once it has stopped", () => {
    const { calls, moments, stop } = lean();
    const cruise = moments.findIndex((m) => m.speed === SLOW.speed);
    const brakingFrom = moments.findIndex(
      (m, i) => i > cruise && m.speed < SLOW.speed,
    );
    // Well after the speeding up has ended and before the braking starts, the
    // lean has eased to a tenth of a degree or less.
    const settled = calls.filter(
      (c) => c.frame > cruise + 60 && c.frame < brakingFrom,
    );
    expect(settled.length).toBeGreaterThan(0);
    expect(Math.max(...settled.map((c) => Math.abs(c.value)))).toBeLessThan(
      0.1 * DEG,
    );
    expect(calls.at(-1)?.value).toBe(0);
    expect(calls.at(-1)?.frame).toBeGreaterThan(stop);
  });

  it("reaches close to the slider's angle at full power held long enough", () => {
    // Speeding up at the unit's full acceleration for 40 frames, which is over
    // four of the lean's 9 frame settling times.
    const { calls } = lean({ strength: 6 });
    const back = Math.min(...calls.map((c) => c.value));
    expect(back).toBeLessThan(-0.95 * 6 * DEG);
    expect(back).toBeGreaterThanOrEqual(-6 * DEG);
  });

  it("leans in proportion to the strength slider", () => {
    const peak = (strength: number) =>
      Math.min(...lean({ strength }).calls.map((c) => c.value));
    expect(peak(4)).toBeLessThan(0);
    expect(peak(8) / peak(4)).toBeCloseTo(2, 2);
  });

  it("leans by the share of full braking, so half the braking leans half as far", () => {
    const forward = (declaredBrake: number) =>
      Math.max(
        ...lean({}, SLOW, { ...SLOW, brakeRate: declaredBrake }).calls.map(
          (c) => c.value,
        ),
      );
    // The unit brakes at 0.1. Declared to brake at 0.1 that is full braking,
    // declared at 0.2 it is half.
    const ratio = forward(0.2) / forward(0.1);
    expect(ratio).toBeGreaterThan(0.49);
    expect(ratio).toBeLessThan(0.51);
  });

  it("does not lean at all with the slider at 0", () => {
    const { calls } = lean({ strength: 0 });
    expect(calls.every((c) => c.value === 0)).toBe(true);
  });
});

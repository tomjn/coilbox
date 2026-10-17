import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

import { PRESETS, ROLES, WAKE_WHILE_MOVING } from "./animPresets";
import { type DriveMotion, driveAlong, pathPoints } from "./drive";
import {
  type Emission,
  particlesAt,
  sfxEmission,
  type UnitMotion,
  unitMotion,
} from "./effects";
import { buildLuaScript } from "./luaScript";
import { type LegoPiece, type LegoProject, newProject } from "./model";
import { type ScriptEvent, scenarioById } from "./scriptPlayback";
import { soloScenario } from "./soloPreset";

/** `CobDefines.h:10-13`. */
const WAKE = 2;
const REVERSE_WAKE = 4;

/** Frames `Sleep` waits for a number of milliseconds: `floor(ms / 33)`. */
const FRAME_MS = 33;

function unit(
  params: Record<string, number> = {},
  wakePoints = ["wake"],
): LegoProject {
  const base = newProject({
    id: "ship",
    rootPieceId: "root",
    name: "Ship",
    packId: "lego",
    packVersion: "1",
    now: "2026-10-17T00:00:00Z",
  });
  const pieces: LegoPiece[] = wakePoints.map((name, index) => ({
    id: name,
    name,
    parentId: "root",
    partId: null,
    position: [index * 4, 0, -40],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
    role: "wake",
  }));
  return {
    ...base,
    pieces: [...base.pieces, ...pieces],
    animations: [{ presetId: "wake.moving", params }],
  };
}

interface Emit {
  frame: number;
  piece: string;
  sfx: number;
}

/**
 * Runs the unit's script under luajit with the engine calls stubbed. Each
 * event's call-in fires on its frame with its arguments, threads sleep, wake
 * and are killed by `Signal` as the framework's do, and `Sleep` waits
 * `floor(ms / 33)` frames. Returns every `EmitSfx` with the frame it was made
 * on.
 */
function emitsOver(lua: string, events: ScriptEvent[], frames: number): Emit[] {
  const harness = `
x_axis, y_axis, z_axis = 1, 2, 3
SFX = { SHATTER = 1, WAKE = ${WAKE}, REVERSE_WAKE = ${REVERSE_WAKE} }
COB = { HEADING = 82 }
local frame = 0
local log = {}
local threads = {}
local current = nil
function piece(...) return ... end
function GetUnitValue() return 0 end
function EmitSfx(p, sfx)
  log[#log + 1] = frame .. " " .. p .. " " .. sfx
end
function Turn() end
function Spin() end
function StopSpin() end
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
function Sleep(ms) coroutine.yield(math.floor(ms / ${FRAME_MS})) end
local function resume(t, ...)
  current = t
  local ok, wait = coroutine.resume(t.co, ...)
  assert(ok, wait)
  t.wake = frame + (wait or 0)
end
function StartThread(fn, ...)
  local t = { co = coroutine.create(fn), mask = nil }
  threads[#threads + 1] = t
  resume(t, ...)
end
script = {}
local chunk = assert(loadstring(io.read("*a")))
chunk()
if script.Create then script.Create() end
local events = {${events
    .filter((event) => event.callin && event.callin !== "Create")
    .map(
      (event) =>
        `{ frame = ${event.frame}, callin = "${event.callin}", args = {${(event.args ?? []).join(",")}} }`,
    )
    .join(",")}}
for f = 0, ${frames - 1} do
  frame = f
  for _, e in ipairs(events) do
    if e.frame == f and script[e.callin] then script[e.callin](unpack(e.args)) end
  end
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
      const [frame, piece, sfx] = line.split(" ");
      return { frame: Number(frame), piece, sfx: Number(sfx) };
    });
}

const FRAMES = 150;
const START = 10;
const STOP = 120;

function moving(args?: number[]): ScriptEvent[] {
  return [
    { frame: START, callin: "StartMoving", ...(args ? { args } : {}) },
    { frame: STOP, callin: "StopMoving" },
  ];
}

function run(
  events: ScriptEvent[],
  params: Record<string, number> = {},
  wakePoints?: string[],
) {
  return emitsOver(buildLuaScript(unit(params, wakePoints)), events, FRAMES);
}

describe("the wake role and preset", () => {
  it("has a Wake point role in the Movement group", () => {
    expect(ROLES.find((role) => role.id === "wake")).toEqual({
      id: "wake",
      label: "Wake point",
      group: "Movement",
    });
  });

  it("is a preset that needs a wake point and moves no role", () => {
    expect(PRESETS).toContain(WAKE_WHILE_MOVING);
    expect(WAKE_WHILE_MOVING.requires).toEqual([{ role: "wake", count: 1 }]);
    expect(WAKE_WHILE_MOVING.animates).toEqual([]);
    expect(WAKE_WHILE_MOVING.params.map((param) => param.id)).toEqual([
      "interval",
    ]);
  });

  it("takes the engine's reversing flag in StartMoving", () => {
    expect(buildLuaScript(unit())).toContain("function script.StartMoving(");
  });
});

describe("the wake script under luajit", () => {
  it("emits nothing before StartMoving", () => {
    const emits = run(moving());
    expect(emits.length).toBeGreaterThan(0);
    expect(emits.filter((emit) => emit.frame < START)).toEqual([]);
  });

  it("emits a forward wake from the wake point on StartMoving, then at the slider interval", () => {
    // 0.2 seconds is 6 frames at 30 a second.
    const emits = run(moving([0]), { interval: 0.2 });
    expect(emits.slice(0, 4)).toEqual([
      { frame: START, piece: "wake", sfx: WAKE },
      { frame: START + 6, piece: "wake", sfx: WAKE },
      { frame: START + 12, piece: "wake", sfx: WAKE },
      { frame: START + 18, piece: "wake", sfx: WAKE },
    ]);
  });

  it("emits more often for a shorter interval", () => {
    const count = (interval: number) => run(moving([0]), { interval }).length;
    expect(count(0.1)).toBeGreaterThan(count(0.3));
  });

  it("emits a reverse wake when StartMoving says the unit is reversing", () => {
    const emits = run(moving([1]));
    expect(emits.length).toBeGreaterThan(0);
    expect(emits.every((emit) => emit.sfx === REVERSE_WAKE)).toBe(true);
  });

  it("emits a forward wake for a reversing flag of 0 and for none at all", () => {
    for (const args of [[0], undefined]) {
      const emits = run(moving(args));
      expect(emits.length).toBeGreaterThan(0);
      expect(emits.every((emit) => emit.sfx === WAKE)).toBe(true);
    }
  });

  it("emits from every wake point each time, in order", () => {
    const emits = run(moving([0]), {}, ["wakeL", "wakeR"]);
    const first = emits.filter((emit) => emit.frame === START);
    expect(first.map((emit) => emit.piece)).toEqual(["wakeL", "wakeR"]);
    const frames = new Set(emits.map((emit) => emit.frame));
    for (const frame of frames) {
      expect(emits.filter((emit) => emit.frame === frame)).toHaveLength(2);
    }
  });

  it("stops on StopMoving", () => {
    const emits = run(moving([0]));
    expect(emits.filter((emit) => emit.frame >= STOP)).toEqual([]);
    expect(emits.at(-1)?.frame).toBeGreaterThan(STOP - 20);
  });

  it("starts again, with the new direction, on the next StartMoving", () => {
    const emits = run([
      { frame: START, callin: "StartMoving", args: [0] },
      { frame: 50, callin: "StopMoving" },
      { frame: 70, callin: "StartMoving", args: [1] },
      { frame: STOP, callin: "StopMoving" },
    ]);
    expect(
      emits.filter((emit) => emit.frame < 50).every((e) => e.sfx === WAKE),
    ).toBe(true);
    expect(emits.filter((emit) => emit.frame >= 50 && emit.frame < 70)).toEqual(
      [],
    );
    const later = emits.filter((emit) => emit.frame >= 70);
    expect(later.length).toBeGreaterThan(0);
    expect(later.every((emit) => emit.sfx === REVERSE_WAKE)).toBe(true);
  });

  it("never emits twice in one frame from one wake point, even at the shortest interval", () => {
    const min = WAKE_WHILE_MOVING.params[0].min;
    const emits = run(moving([0]), { interval: min });
    const frames = emits.map((emit) => emit.frame);
    expect(new Set(frames).size).toBe(frames.length);
  });
});

describe("the wake in the moving and driving scenarios", () => {
  const MOTION: DriveMotion = { speed: 2, turnRate: 600, reverseSpeed: 1 };

  /** The `EmitSfx` events the runtime would hand the preview, drawn the way
   *  the viewport draws them. */
  function drawn(events: ScriptEvent[], frames: number) {
    const emits = emitsOver(buildLuaScript(unit()), events, frames);
    const emissions: Emission[] = emits.flatMap((emit, index) => {
      const made = sfxEmission(
        emit.sfx,
        emit.frame,
        [0, 0, -40],
        [0, 0, -1],
        index + 1,
      );
      return made ? [made] : [];
    });
    return { emits, emissions };
  }

  function drive(path: "straight" | "behind") {
    const driven = driveAlong(pathPoints(path, MOTION, []), MOTION, {
      start: 15,
      frames: 450,
      ground: null,
      tilts: false,
      minScriptChangeHeading: 1,
    });
    return { driven, ...drawn(driven.events, 450) };
  }

  it("are the scenarios the preset plays solo", () => {
    expect(soloScenario("wake.moving")).toBe("driving");
    expect(scenarioById("driving")?.drive).toBe(true);
    expect(scenarioById("moving")?.events.map((e) => e.callin)).toContain(
      "StartMoving",
    );
  });

  it("draws a wake in the moving scenario", () => {
    const scenario = scenarioById("moving");
    if (!scenario) throw new Error("no moving scenario");
    const { emissions } = drawn(scenario.events, 300);
    expect(emissions.length).toBeGreaterThan(0);
    expect(emissions.every((e) => e.kind === "wake" && !e.reverse)).toBe(true);
    const motion = unitMotion(scenario.events, 2);
    expect(
      particlesAt(emissions, 200, 1, motion).sprites.count,
    ).toBeGreaterThan(0);
  });

  it("draws a wake while driving ahead, and none once it has faded after the stop", () => {
    const { driven, emissions } = drive("straight");
    const arrived = driven.arrived;
    if (arrived === null) throw new Error("the unit never arrived");
    expect(emissions.length).toBeGreaterThan(0);
    expect(emissions.every((e) => e.kind === "wake" && !e.reverse)).toBe(true);
    const motion: UnitMotion | null = unitMotion(driven.events, MOTION.speed);
    const during = Math.floor((15 + arrived) / 2);
    expect(
      particlesAt(emissions, during, 1, motion).sprites.count,
    ).toBeGreaterThan(0);
    // A wake starts at an alpha of 0.5 at most and loses 0.004 a frame, so it
    // is gone within 125 frames of the last one, which is born before the stop.
    expect(particlesAt(emissions, arrived + 150, 1, motion).sprites.count).toBe(
      0,
    );
  });

  it("draws a reverse wake while backing up", () => {
    const { driven, emissions } = drive("behind");
    expect(driven.events[0].args).toEqual([1]);
    expect(emissions.length).toBeGreaterThan(0);
    expect(emissions.every((e) => e.kind === "wake" && e.reverse)).toBe(true);
  });
});

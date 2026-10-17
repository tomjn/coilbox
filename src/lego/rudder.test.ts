import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

import { PRESETS, ROLES, RUDDER_FOLLOWS } from "./animPresets";
import { type DriveMotion, driveAlong, pathPoints } from "./drive";
import { buildLuaScript } from "./luaScript";
import { type LegoPiece, type LegoProject, newProject } from "./model";
import { scenarioById } from "./scriptPlayback";
import { soloScenario } from "./soloPreset";

const DEG = Math.PI / 180;

function unit(params: Record<string, number> = {}): LegoProject {
  const base = newProject({
    id: "ship",
    rootPieceId: "root",
    name: "Ship",
    packId: "lego",
    packVersion: "1",
    now: "2026-10-17T00:00:00Z",
  });
  const rudder: LegoPiece = {
    id: "rudder",
    name: "rudder",
    parentId: "root",
    partId: null,
    position: [0, 0, -40],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
    role: "rudder",
  };
  return {
    ...base,
    pieces: [...base.pieces, rudder],
    animations: [{ presetId: "rudder.follow", params }],
  };
}

interface Turn {
  frame: number;
  piece: string;
  axis: number;
  angle: number;
}

/**
 * Runs the unit's script under luajit with the engine calls stubbed. A frame
 * runs at a time: `heading(frame)` is what `GetUnitValue(COB.HEADING)` answers,
 * `StartMoving` fires on `start` and `StopMoving` on `stop`, and threads sleep,
 * wake and are killed by `Signal` as the framework's do. Returns every `Turn`
 * with the frame it was made on.
 */
function turnsOver(
  lua: string,
  headings: number[],
  start: number,
  stop: number,
): Turn[] {
  const harness = `
x_axis, y_axis, z_axis = 1, 2, 3
COB = { HEADING = 82 }
local frame = 0
local headings = {${headings.join(",")}}
local log = {}
local threads = {}
local current = nil
function piece(...) return ... end
function GetUnitValue(id)
  assert(id == COB.HEADING, "read value " .. tostring(id))
  return headings[frame + 1]
end
function Turn(p, axis, angle, speed)
  assert(type(speed) == "number", "Turn needs a speed")
  log[#log + 1] = frame .. " " .. p .. " " .. axis .. " " .. angle
end
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
for f = 0, ${headings.length - 1} do
  frame = f
  if f == ${start} then script.StartMoving() end
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
      const [frame, piece, axis, angle] = line.split(" ");
      return {
        frame: Number(frame),
        piece,
        axis: Number(axis),
        angle: Number(angle),
      };
    });
}

/** A heading that changes by `rate` heading units a frame from `from` to `to`
 *  and then holds, wrapped the way the engine's short is. */
function turning(
  frames: number,
  from: number,
  to: number,
  rate: number,
): number[] {
  const wrap = (n: number) => ((((n + 32768) % 65536) + 65536) % 65536) - 32768;
  return Array.from({ length: frames }, (_, frame) => {
    const turned = Math.min(Math.max(frame - from, 0), to - from) * rate;
    return wrap(turned);
  });
}

const FRAMES = 150;
const START = 10;
const STOP = 120;

function run(headings: number[], params: Record<string, number> = {}) {
  return turnsOver(buildLuaScript(unit(params)), headings, START, STOP);
}

describe("the rudder role and preset", () => {
  it("has a Rudder role in the Movement group", () => {
    expect(ROLES.find((role) => role.id === "rudder")).toEqual({
      id: "rudder",
      label: "Rudder",
      group: "Movement",
    });
  });

  it("is a preset that needs a rudder and moves only that role", () => {
    expect(PRESETS).toContain(RUDDER_FOLLOWS);
    expect(RUDDER_FOLLOWS.requires).toEqual([{ role: "rudder", count: 1 }]);
    expect(RUDDER_FOLLOWS.animates).toEqual(["rudder"]);
    expect(RUDDER_FOLLOWS.params.map((param) => param.id)).toEqual(["max"]);
  });

  it("reads the heading with GetUnitValue(COB.HEADING)", () => {
    expect(buildLuaScript(unit())).toContain("GetUnitValue(COB.HEADING)");
  });
});

describe("the rudder script under luajit", () => {
  it("turns nothing while the unit holds its heading", () => {
    const turns = run(turning(FRAMES, 0, 0, 0));
    expect(turns.filter((turn) => turn.angle !== 0)).toEqual([]);
  });

  it("turns nothing before StartMoving", () => {
    const turns = run(turning(FRAMES, 0, 100, 300));
    expect(turns.filter((turn) => turn.frame < START)).toEqual([]);
  });

  it("turns about the vertical axis only, the rudder piece only", () => {
    const turns = run(turning(FRAMES, 20, 60, 300));
    expect(turns.length).toBeGreaterThan(0);
    for (const turn of turns) {
      expect(turn.piece).toBe("rudder");
      expect(turn.axis).toBe(2);
    }
  });

  it("swings with the sign of a left turn and of a right turn", () => {
    const left = run(turning(FRAMES, 20, 60, 300)).map((t) => t.angle);
    const right = run(turning(FRAMES, 20, 60, -300)).map((t) => t.angle);
    expect(Math.max(...left)).toBeGreaterThan(0);
    expect(Math.min(...left)).toBeGreaterThanOrEqual(0);
    expect(Math.min(...right)).toBeLessThan(0);
    expect(Math.max(...right)).toBeLessThanOrEqual(0);
  });

  it("swings further for a faster turn", () => {
    const peak = (rate: number) =>
      Math.max(...run(turning(FRAMES, 20, 60, rate)).map((t) => t.angle));
    expect(peak(200)).toBeGreaterThan(0);
    expect(peak(400)).toBeGreaterThan(peak(200));
  });

  it("never swings past the slider", () => {
    const turns = run(turning(FRAMES, 20, 60, 3000), { max: 20 });
    const peak = Math.max(...turns.map((t) => Math.abs(t.angle)));
    expect(peak).toBeCloseTo(20 * DEG, 3);
  });

  it("follows a turn across the wrap from 32767 to -32768", () => {
    // Starts just short of the wrap, turning left through it.
    const headings = Array.from({ length: FRAMES }, (_, frame) => {
      const raw = 32000 + Math.min(Math.max(frame - 20, 0), 40) * 300;
      return ((raw + 32768) % 65536) - 32768;
    });
    expect(headings.some((h) => h < 0)).toBe(true);
    const angles = run(headings).map((t) => t.angle);
    expect(Math.max(...angles)).toBeGreaterThan(0);
    expect(Math.min(...angles)).toBeGreaterThanOrEqual(0);
  });

  it("eases back to straight once the turn stops", () => {
    const turns = run(turning(FRAMES, 20, 40, 400));
    const swung = turns.filter((t) => t.angle !== 0);
    expect(swung.length).toBeGreaterThan(0);
    const last = turns.filter((t) => t.frame < STOP).at(-1);
    expect(last?.angle).toBe(0);
    // And it is straight well before the unit stops.
    expect(turns.find((t) => t.frame > 60 && t.angle === 0)).toBeDefined();
  });

  it("straightens on StopMoving and turns nothing after it", () => {
    // Still turning when it stops.
    const turns = run(turning(FRAMES, 20, FRAMES, 400));
    const atStop = turns.filter((t) => t.frame === STOP);
    expect(atStop.at(-1)?.angle).toBe(0);
    expect(turns.filter((t) => t.frame > STOP)).toEqual([]);
  });
});

describe("the rudder in the driving scenarios", () => {
  const MOTION: DriveMotion = { speed: 2, turnRate: 600 };

  function drivenTurns(path: "bend" | "straight" | "circle") {
    const driven = driveAlong(pathPoints(path, MOTION, []), MOTION, {
      start: 15,
      frames: 450,
      ground: null,
      tilts: false,
      minScriptChangeHeading: 1,
    });
    const headings = driven.frames.map((frame) => frame.heading);
    return {
      driven,
      turns: turnsOver(
        buildLuaScript(unit()),
        headings,
        15,
        driven.arrived ?? 449,
      ),
    };
  }

  it("is the scenario the preset plays solo", () => {
    expect(soloScenario("rudder.follow")).toBe("driving");
    expect(scenarioById("driving")?.drive).toBe(true);
  });

  it("swings to the right in a right bend, then straightens", () => {
    const { driven, turns } = drivenTurns("bend");
    const angles = turns.map((t) => t.angle);
    expect(Math.min(...angles)).toBeLessThan(-5 * DEG);
    expect(Math.max(...angles)).toBeLessThanOrEqual(0);
    expect(
      turns.filter((t) => t.frame < (driven.arrived ?? 0)).at(-1)?.angle,
    ).toBe(0);
  });

  it("swings to the left all the way round a circle to the left", () => {
    const { turns } = drivenTurns("circle");
    const held = turns.filter((t) => t.frame > 100 && t.frame < 300);
    expect(held.length).toBeGreaterThan(0);
    expect(held.every((t) => t.angle > 0)).toBe(true);
  });

  it("stays straight driving straight ahead", () => {
    const { turns } = drivenTurns("straight");
    expect(turns.filter((t) => t.angle !== 0)).toEqual([]);
  });
});

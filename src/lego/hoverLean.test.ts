import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

import { HOVER_LEAN, PRESETS } from "./animPresets";
import { type DriveMotion, driveAlong, pathPoints } from "./drive";
import { buildLuaScript } from "./luaScript";
import { type LegoPiece, type LegoProject, newProject } from "./model";
import { scenarioById } from "./scriptPlayback";
import { soloScenario } from "./soloPreset";

const DEG = Math.PI / 180;

function unit(params: Record<string, number> = {}): LegoProject {
  const base = newProject({
    id: "hovercraft",
    rootPieceId: "root",
    name: "Hovercraft",
    packId: "lego",
    packVersion: "1",
    now: "2026-10-17T00:00:00Z",
  });
  const hull: LegoPiece = {
    id: "hull",
    name: "hull",
    parentId: "root",
    partId: null,
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
    role: "base",
  };
  return {
    ...base,
    pieces: [...base.pieces, hull],
    animations: [{ presetId: "hover.lean", params }],
  };
}

interface Turn {
  frame: number;
  piece: string;
  axis: number;
  angle: number;
}

/** A hovercraft script is never sent `ChangeHeading` in an unchanged game
 *  (`GroundMoveType.cpp:1452-1453`), so the lean reads the heading. */
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

describe("the hull lean preset", () => {
  it("is a preset that needs a body and moves only that role", () => {
    expect(PRESETS).toContain(HOVER_LEAN);
    expect(HOVER_LEAN.requires).toEqual([{ role: "base", count: 1 }]);
    expect(HOVER_LEAN.animates).toEqual(["base"]);
    expect(HOVER_LEAN.params.map((param) => param.id)).toEqual(["max"]);
  });

  it("reads the heading and does not wait for ChangeHeading", () => {
    const lua = buildLuaScript(unit());
    expect(lua).toContain("GetUnitValue(COB.HEADING)");
    expect(lua).not.toContain("ChangeHeading");
  });
});

describe("the hull lean script under luajit", () => {
  it("leans nothing while the unit holds its heading", () => {
    const turns = run(turning(FRAMES, 0, 0, 0));
    expect(turns.filter((turn) => turn.angle !== 0)).toEqual([]);
  });

  it("leans nothing before StartMoving", () => {
    const turns = run(turning(FRAMES, 0, 100, 300));
    expect(turns.filter((turn) => turn.frame < START)).toEqual([]);
  });

  it("rolls the hull piece about z only", () => {
    const turns = run(turning(FRAMES, 20, 60, 300));
    expect(turns.length).toBeGreaterThan(0);
    for (const turn of turns) {
      expect(turn.piece).toBe("hull");
      expect(turn.axis).toBe(3);
    }
  });

  it("leans left in a left turn and right in a right turn", () => {
    const left = run(turning(FRAMES, 20, 60, 300)).map((t) => t.angle);
    const right = run(turning(FRAMES, 20, 60, -300)).map((t) => t.angle);
    // A positive Turn about z rolls to the unit's right.
    expect(Math.min(...left)).toBeLessThan(0);
    expect(Math.max(...left)).toBeLessThanOrEqual(0);
    expect(Math.max(...right)).toBeGreaterThan(0);
    expect(Math.min(...right)).toBeGreaterThanOrEqual(0);
  });

  it("leans further for a faster turn", () => {
    const peak = (rate: number) =>
      Math.max(
        ...run(turning(FRAMES, 20, 60, -rate), { max: 30 }).map((t) => t.angle),
      );
    expect(peak(200)).toBeGreaterThan(0);
    expect(peak(400)).toBeGreaterThan(peak(200));
  });

  it("never leans past the slider", () => {
    const turns = run(turning(FRAMES, 20, 60, -3000), { max: 12 });
    const peak = Math.max(...turns.map((t) => Math.abs(t.angle)));
    expect(peak).toBeCloseTo(12 * DEG, 3);
  });

  it("follows a turn across the wrap from 32767 to -32768", () => {
    const headings = Array.from({ length: FRAMES }, (_, frame) => {
      const raw = 32000 + Math.min(Math.max(frame - 20, 0), 40) * 300;
      return ((raw + 32768) % 65536) - 32768;
    });
    expect(headings.some((h) => h < 0)).toBe(true);
    const angles = run(headings).map((t) => t.angle);
    expect(Math.min(...angles)).toBeLessThan(0);
    expect(Math.max(...angles)).toBeLessThanOrEqual(0);
  });

  it("eases level once the turn stops", () => {
    const turns = run(turning(FRAMES, 20, 40, 400));
    expect(turns.some((t) => t.angle !== 0)).toBe(true);
    const last = turns.filter((t) => t.frame < STOP).at(-1);
    expect(last?.angle).toBeCloseTo(0, 10);
  });

  it("levels on StopMoving and leans nothing after it", () => {
    const turns = run(turning(FRAMES, 20, FRAMES, 400));
    expect(turns.filter((t) => t.frame === STOP).at(-1)?.angle).toBeCloseTo(
      0,
      10,
    );
    expect(turns.filter((t) => t.frame > STOP)).toEqual([]);
  });
});

describe("the hull lean in the driving scenarios", () => {
  const MOTION: DriveMotion = { speed: 2, turnRate: 600 };

  function drivenTurns(path: "bend" | "straight" | "circle") {
    const driven = driveAlong(pathPoints(path, MOTION, []), MOTION, {
      start: 15,
      frames: 450,
      ground: null,
      tilts: false,
      minScriptChangeHeading: 1,
    });
    return turnsOver(
      buildLuaScript(unit()),
      driven.frames.map((frame) => frame.heading),
      15,
      driven.arrived ?? 449,
    );
  }

  it("is the scenario the preset plays solo", () => {
    expect(soloScenario("hover.lean")).toBe("driving");
    expect(scenarioById("driving")?.drive).toBe(true);
  });

  it("leans right in a right bend, then levels", () => {
    const angles = drivenTurns("bend").map((t) => t.angle);
    expect(Math.max(...angles)).toBeGreaterThan(2 * DEG);
    expect(Math.min(...angles)).toBeGreaterThanOrEqual(0);
  });

  it("leans left all the way round a circle to the left", () => {
    const held = drivenTurns("circle").filter(
      (t) => t.frame > 100 && t.frame < 300,
    );
    expect(held.length).toBeGreaterThan(0);
    expect(held.every((t) => t.angle < 0)).toBe(true);
  });

  it("stays level driving straight ahead", () => {
    expect(drivenTurns("straight").filter((t) => t.angle !== 0)).toEqual([]);
  });
});

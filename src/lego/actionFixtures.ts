import { spawnSync } from "node:child_process";

import {
  type LegoAction,
  type LegoPiece,
  type LegoProject,
  newProject,
} from "./model";

/**
 * A stand-in for the unit script framework under luajit, shared by the action
 * tests (#3356, #3358).
 *
 * `Turn` and `Move` head for their destination at speed / 30 a frame
 * (`CUnitScript::TickTurnAnim`), `Sleep(ms)` wakes the thread `floor(ms / 33)`
 * frames later, and `Signal` ends the threads whose mask matches. It offers no
 * `GetPieceRotation`, because the Rust runtime that plays the same script does
 * not.
 */

export const FPS = 30;
const NOW = "2026-10-18T00:00:00Z";

export function piece(id: string, name: string): LegoPiece {
  return {
    id,
    name,
    parentId: "root",
    partId: null,
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
  };
}

export const POSE_A = {
  id: "pose-a",
  name: "Raised",
  pieces: {
    arm: { turn: [1, 0, 0] as [number, number, number] },
    hatch: { move: [0, 4, 0] as [number, number, number] },
  },
};
export const POSE_B = {
  id: "pose-b",
  name: "Swung",
  pieces: {
    arm: { turn: [-0.5, 0, 0.8] as [number, number, number] },
  },
};

export function action(extra: Partial<LegoAction> = {}): LegoAction {
  return {
    id: "act",
    name: "Plant",
    trigger: "StartMoving",
    loop: true,
    keys: [
      { pose: "pose-a", seconds: 1 },
      { pose: "pose-b", seconds: 2 },
    ],
    ...extra,
  };
}

export function unit(extra: Partial<LegoProject> = {}): LegoProject {
  const base = newProject({
    id: "p",
    rootPieceId: "root",
    name: "mech",
    packId: "lego",
    packVersion: "1",
    now: NOW,
  });
  return {
    ...base,
    pieces: [...base.pieces, piece("arm", "arm"), piece("hatch", "hatch")],
    poses: [POSE_A, POSE_B],
    actions: [action()],
    ...extra,
  };
}

export interface Event {
  frame: number;
  callin: string;
}

export interface Watch {
  piece: string;
  kind: "turn" | "move";
  axis: "x_axis" | "y_axis" | "z_axis";
}

/** Each watched value after each frame. */
export function run(
  lua: string,
  events: Event[],
  frames: number,
  watch: Watch[],
): number[][] {
  const watched = watch
    .map((w) => `anim("${w.kind}", "${w.piece}", ${w.axis}).at`)
    .join(', " ", ');
  const harness = `
x_axis, y_axis, z_axis = 1, 2, 3
local frame = 0
SFX = { SHATTER = 1 }
COB = {}
Spring = { GetGameFrame = function() return frame end }
local anims = {}
local threads = {}
local current = nil
function anim(kind, p, axis)
  local key = kind .. ":" .. p .. ":" .. axis
  anims[key] = anims[key] or { at = 0, dest = 0, speed = 0 }
  return anims[key]
end
local function head(a, dest, speed)
  a.dest = dest
  if speed == nil or speed == 0 then a.at = dest a.speed = 0 else a.speed = speed end
end
function piece(name) return name end
function Turn(p, axis, dest, speed) head(anim("turn", p, axis), dest, speed) end
function Move(p, axis, dest, speed) head(anim("move", p, axis), dest, speed) end
function Spin() end
function StopSpin() end
function Explode() end
function WaitForTurn() end
function WaitForMove() end
function SetUnitValue() end
function SetSignalMask(mask) current.mask = mask end
function Signal(mask)
  for _, t in ipairs(threads) do
    if t.mask == mask then t.dead = true end
  end
end
function Sleep(ms) coroutine.yield(math.floor(ms / 33)) end
local function resume(t)
  local parent = current
  current = t
  local ok, wait = coroutine.resume(t.co)
  current = parent
  assert(ok, wait)
  t.wake = frame + (wait or 0)
end
function StartThread(fn, ...)
  -- A thread starts with its parent's signal mask, as in the engine.
  local t = { co = coroutine.create(fn), mask = current and current.mask }
  threads[#threads + 1] = t
  resume(t)
end
script = {}
local chunk = assert(loadstring(io.read("*a")))
chunk()
local events = {
${events.map((e) => `  { ${e.frame}, ${JSON.stringify(e.callin)} },`).join("\n")}
}
for f = 0, ${frames - 1} do
  frame = f
  for _, e in ipairs(events) do
    if e[1] == f then script[e[2]]() end
  end
  for _, t in ipairs(threads) do
    if not t.dead and coroutine.status(t.co) == "suspended" and t.wake <= f then
      resume(t)
    end
  end
  for _, a in pairs(anims) do
    if a.speed > 0 then
      local step = a.speed / 30
      if math.abs(a.dest - a.at) <= step then a.at = a.dest
      elseif a.dest > a.at then a.at = a.at + step
      else a.at = a.at - step end
    end
  end
  io.write(${watched}, "\\n")
end
`;
  const result = spawnSync("luajit", ["-e", harness], { input: lua });
  if (result.status !== 0) {
    throw new Error(`luajit failed: ${result.stderr.toString()}`);
  }
  return result.stdout
    .toString()
    .split("\n")
    .filter(Boolean)
    .map((line) => line.trim().split(/\s+/).map(Number));
}

export const ARM_X: Watch = { piece: "arm", kind: "turn", axis: "x_axis" };
export const ARM_Z: Watch = { piece: "arm", kind: "turn", axis: "z_axis" };
export const HATCH_Y: Watch = { piece: "hatch", kind: "move", axis: "y_axis" };

/** One frame of the fastest axis, and the four places the script is written to. */
export function allowance(speed: number): number {
  return speed / FPS + 1e-3;
}

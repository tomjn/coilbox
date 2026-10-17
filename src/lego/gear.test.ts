import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

import { LANDING_GEAR, PRESETS, ROLES } from "./animPresets";
import { buildLuaScript } from "./luaScript";
import { type LegoPiece, type LegoProject, newProject } from "./model";
import {
  PREVIEW_FRAMES,
  type ScriptEvent,
  scenarioById,
} from "./scriptPlayback";
import { soloScenario } from "./soloPreset";

const DEG = Math.PI / 180;
const X_AXIS = 1;

function unit(
  params: Record<string, number> = {},
  gear = ["gearL", "gearR"],
): LegoProject {
  const base = newProject({
    id: "plane",
    rootPieceId: "root",
    name: "Plane",
    packId: "lego",
    packVersion: "1",
    now: "2026-10-17T00:00:00Z",
  });
  const pieces: LegoPiece[] = gear.map((name, index) => ({
    id: name,
    name,
    parentId: "root",
    partId: null,
    position: [index * 8 - 4, -2, 0],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
    role: "gear",
  }));
  return {
    ...base,
    pieces: [...base.pieces, ...pieces],
    animations: [{ presetId: "gear.stow", params }],
  };
}

interface Turn {
  frame: number;
  piece: string;
  axis: number;
  angle: number;
  speed: number;
}

/**
 * Runs the unit's script under luajit with the engine calls stubbed. Each
 * event's call-in fires on its frame. Returns every `Turn` with the frame it
 * was made on.
 */
function turnsOver(lua: string, events: ScriptEvent[], frames: number): Turn[] {
  const harness = `
x_axis, y_axis, z_axis = 1, 2, 3
SFX = { SHATTER = 1 }
local frame = 0
local log = {}
function piece(...) return ... end
function Turn(p, axis, angle, speed)
  assert(type(speed) == "number", "Turn needs a speed")
  log[#log + 1] = frame .. " " .. p .. " " .. axis .. " " .. angle .. " " .. speed
end
function Spin() end
function StopSpin() end
function Move() end
function Explode() end
function WaitForTurn() end
function WaitForMove() end
function SetSignalMask() end
function Signal() end
function Sleep() end
function StartThread(fn, ...) fn(...) end
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
      const [frame, piece, axis, angle, speed] = line.split(" ");
      return {
        frame: Number(frame),
        piece,
        axis: Number(axis),
        angle: Number(angle),
        speed: Number(speed),
      };
    });
}

const FRAMES = 200;
const UP = 20;
const DOWN = 100;

function run(
  calls: [number, string][],
  params: Record<string, number> = {},
  gear?: string[],
) {
  const events: ScriptEvent[] = calls.map(([frame, callin]) => ({
    frame,
    callin,
  }));
  return turnsOver(buildLuaScript(unit(params, gear)), events, FRAMES);
}

describe("the landing gear role and preset", () => {
  it("has a Landing gear role in the Movement group, after Wake point", () => {
    expect(ROLES.find((role) => role.id === "gear")).toEqual({
      id: "gear",
      label: "Landing gear",
      group: "Movement",
    });
    const ids = ROLES.map((role) => role.id);
    expect(ids.indexOf("gear")).toBe(ids.indexOf("wake") + 1);
  });

  it("is a preset that needs a gear piece and moves only that role", () => {
    expect(PRESETS).toContain(LANDING_GEAR);
    expect(LANDING_GEAR.requires).toEqual([{ role: "gear", count: 1 }]);
    expect(LANDING_GEAR.animates).toEqual(["gear"]);
    expect(LANDING_GEAR.params.map((param) => param.id)).toEqual([
      "stow",
      "stowTime",
    ]);
  });
});

describe("the landing gear script under luajit", () => {
  it("turns nothing before Activate", () => {
    expect(run([])).toEqual([]);
  });

  it("turns each gear piece once to the stowed angle at the slider speed on Activate", () => {
    const turns = run([[UP, "Activate"]], { stow: 100, stowTime: 2 });
    expect(turns).toHaveLength(2);
    for (const name of ["gearL", "gearR"]) {
      const own = turns.filter((turn) => turn.piece === name);
      expect(own).toHaveLength(1);
      expect(own[0].frame).toBe(UP);
      expect(own[0].axis).toBe(X_AXIS);
      expect(own[0].angle).toBeCloseTo(100 * DEG, 3);
      // 100 degrees in 2 seconds.
      expect(own[0].speed).toBeCloseTo(50 * DEG, 3);
    }
  });

  it("turns each piece back to rest at the same speed on Deactivate", () => {
    const turns = run(
      [
        [UP, "Activate"],
        [DOWN, "Deactivate"],
      ],
      { stow: 100, stowTime: 2 },
    );
    const back = turns.filter((turn) => turn.frame === DOWN);
    expect(back.map((turn) => turn.piece).sort()).toEqual(["gearL", "gearR"]);
    for (const turn of back) {
      expect(turn.axis).toBe(X_AXIS);
      expect(turn.angle).toBe(0);
      expect(turn.speed).toBeCloseTo(50 * DEG, 3);
    }
    expect(turns).toHaveLength(4);
  });

  it("does nothing on a second Activate while stowed", () => {
    const turns = run([
      [UP, "Activate"],
      [UP + 30, "Activate"],
      [UP + 60, "Activate"],
    ]);
    expect(turns.filter((turn) => turn.frame > UP)).toEqual([]);
    expect(turns).toHaveLength(2);
  });

  it("does nothing on a Deactivate while already down", () => {
    expect(run([[UP, "Deactivate"]])).toEqual([]);
    const turns = run([
      [UP, "Activate"],
      [DOWN, "Deactivate"],
      [DOWN + 30, "Deactivate"],
    ]);
    expect(turns.filter((turn) => turn.frame > DOWN)).toEqual([]);
  });

  it("stows again after landing", () => {
    const turns = run([
      [UP, "Activate"],
      [DOWN, "Deactivate"],
      [DOWN + 50, "Activate"],
    ]);
    expect(turns.filter((turn) => turn.frame === DOWN + 50)).toHaveLength(2);
  });

  it("turns every piece with the role, however many", () => {
    const turns = run([[UP, "Activate"]], {}, ["a", "b", "c"]);
    expect(turns.map((turn) => turn.piece).sort()).toEqual(["a", "b", "c"]);
  });

  it("moves faster for a shorter time", () => {
    const speed = (stowTime: number) =>
      run([[UP, "Activate"]], { stow: 90, stowTime })[0].speed;
    expect(speed(1)).toBeCloseTo(2 * speed(2), 3);
  });
});

describe("the take off and land scenario", () => {
  const scenario = scenarioById("take-off-landing");

  it("is the one the preset is previewed in", () => {
    expect(scenario?.label).toBe("Take off and land");
    expect(soloScenario("gear.stow")).toBe("take-off-landing");
  });

  it("sends Activate and then Deactivate, inside the preview", () => {
    const calls = (scenario?.events ?? []).filter(
      (event) => event.callin === "Activate" || event.callin === "Deactivate",
    );
    expect(calls.map((event) => event.callin)).toEqual([
      "Activate",
      "Deactivate",
    ]);
    expect(calls[0].frame).toBeGreaterThan(1);
    expect(calls[1].frame).toBeGreaterThan(calls[0].frame);
    expect(calls[1].frame).toBeLessThan(PREVIEW_FRAMES);
  });

  it("stows the gear and lowers it again when played against a unit", () => {
    const events = scenario?.events ?? [];
    const turns = turnsOver(
      buildLuaScript(unit({ stow: 100, stowTime: 2 })),
      events,
      PREVIEW_FRAMES,
    );
    const activate = events.find((e) => e.callin === "Activate")?.frame;
    const deactivate = events.find((e) => e.callin === "Deactivate")?.frame;
    expect(turns.map((turn) => [turn.frame, turn.angle !== 0])).toEqual([
      [activate, true],
      [activate, true],
      [deactivate, false],
      [deactivate, false],
    ]);
  });
});

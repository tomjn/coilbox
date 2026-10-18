import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

import { PRESETS, ROLES, ROTOR_SPIN } from "./animPresets";
import { buildLuaScript } from "./luaScript";
import { type LegoPiece, type LegoProject, newProject } from "./model";
import { scenarioById } from "./scriptPlayback";
import { soloScenario } from "./soloPreset";

const TAU = Math.PI * 2;
const FPS = 30;

function unit(params: Record<string, number> = {}): LegoProject {
  const base = newProject({
    id: "gunship",
    rootPieceId: "root",
    name: "Gunship",
    packId: "lego",
    packVersion: "1",
    now: "2026-10-18T00:00:00Z",
  });
  const rotors: LegoPiece[] = ["main", "second"].map((name, index) => ({
    id: name,
    name,
    parentId: "root",
    partId: null,
    position: [0, 10 + index * 4, 0],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
    role: "rotor",
  }));
  return {
    ...base,
    pieces: [...base.pieces, ...rotors],
    animations: [{ presetId: "rotor.spin", params }],
  };
}

interface Call {
  frame: number;
  call: string;
  piece: string;
  axis: number;
  speed: number;
  accel: number;
}

const ACTIVATE = 10;
const DEACTIVATE = 200;
const MOVING = 100;

/** Runs the script under luajit with `Activate` and `Deactivate` fired on
 *  their frames and every `Spin` and `StopSpin` logged. */
function callsOf(lua: string): Call[] {
  const harness = `
x_axis, y_axis, z_axis = 1, 2, 3
local frame = 0
local log = {}
function piece(...) return ... end
function Turn() end
function Move() end
function Explode() end
function WaitForTurn() end
function WaitForMove() end
function Sleep() end
function SetSignalMask() end
function Signal() end
function StartThread() end
function GetUnitValue() return 0 end
function Spin(p, axis, speed, accel)
  log[#log + 1] = table.concat({frame, "Spin", p, axis, speed, accel or 0}, " ")
end
function StopSpin(p, axis, accel)
  log[#log + 1] = table.concat({frame, "StopSpin", p, axis, 0, accel or 0}, " ")
end
SFX = { SHATTER = 1 }
COB = {}
script = {}
local chunk = assert(loadstring(io.read("*a")))
chunk()
if script.Create then script.Create() end
for f = 0, ${DEACTIVATE + 5} do
  frame = f
  if f == ${ACTIVATE} then script.Activate() end
  if f == ${DEACTIVATE} then script.Deactivate() end
  if f == ${MOVING} and script.StartMoving then script.StartMoving(false) end
  if f == ${MOVING + 5} and script.StopMoving then script.StopMoving() end
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
      const [frame, call, piece, axis, speed, accel] = line.split(" ");
      return {
        frame: Number(frame),
        call,
        piece,
        axis: Number(axis),
        speed: Number(speed),
        accel: Number(accel),
      };
    });
}

/** Frames a spin takes to reach its speed, by `CUnitScript::DoSpin`
 *  (`UnitScript.cpp:183-188`): it gains `accel` every frame and snaps to the
 *  target when within one `accel` of it. */
function framesToSpeed(speed: number, accel: number): number {
  let current = 0;
  let frames = 0;
  while (Math.abs(speed - current) > accel) {
    current += accel;
    frames++;
  }
  return frames + 1;
}

describe("the rotor role and preset", () => {
  it("has a Rotor role in the Movement group", () => {
    expect(ROLES.find((role) => role.id === "rotor")).toEqual({
      id: "rotor",
      label: "Rotor",
      group: "Movement",
    });
  });

  it("is a preset that needs a rotor and moves only that role", () => {
    expect(PRESETS).toContain(ROTOR_SPIN);
    expect(ROTOR_SPIN.requires).toEqual([{ role: "rotor", count: 1 }]);
    expect(ROTOR_SPIN.animates).toEqual(["rotor"]);
    expect(ROTOR_SPIN.params.map((param) => param.id)).toEqual([
      "rate",
      "spinUp",
    ]);
  });

  it("plays in the scenario that sends take off and landing", () => {
    expect(soloScenario("rotor.spin")).toBe("take-off-landing");
    const events = scenarioById("take-off-landing")?.events ?? [];
    expect(events.map((event) => event.callin)).toContain("Activate");
    expect(events.map((event) => event.callin)).toContain("Deactivate");
  });
});

describe("the rotor script under luajit", () => {
  it("does nothing until Activate", () => {
    expect(
      callsOf(buildLuaScript(unit())).filter((c) => c.frame < ACTIVATE),
    ).toEqual([]);
  });

  it("spins every rotor about y at the slider's rate on Activate", () => {
    const spins = callsOf(buildLuaScript(unit({ rate: 3 }))).filter(
      (c) => c.call === "Spin",
    );
    expect(spins.map((c) => c.piece).sort()).toEqual(["main", "second"]);
    for (const spin of spins) {
      expect(spin.frame).toBe(ACTIVATE);
      expect(spin.axis).toBe(2);
      expect(spin.speed).toBeCloseTo(TAU * 3, 3);
    }
  });

  it("takes the spin up time to reach full speed, as the engine ramps it", () => {
    const spin = callsOf(buildLuaScript(unit({ rate: 4, spinUp: 2 }))).find(
      (c) => c.call === "Spin",
    ) as Call;
    expect(framesToSpeed(spin.speed, spin.accel) / FPS).toBeCloseTo(2, 1);
    const slow = callsOf(buildLuaScript(unit({ rate: 4, spinUp: 4 }))).find(
      (c) => c.call === "Spin",
    ) as Call;
    expect(framesToSpeed(slow.speed, slow.accel) / FPS).toBeCloseTo(4, 1);
  });

  it("winds down at the same rate on Deactivate", () => {
    const calls = callsOf(buildLuaScript(unit({ rate: 4, spinUp: 2 })));
    const spin = calls.find((c) => c.call === "Spin") as Call;
    const stops = calls.filter((c) => c.call === "StopSpin");
    expect(stops.map((c) => c.piece).sort()).toEqual(["main", "second"]);
    for (const stop of stops) {
      expect(stop.frame).toBe(DEACTIVATE);
      expect(stop.axis).toBe(2);
      expect(stop.accel).toBe(spin.accel);
    }
  });

  it("keeps turning through StartMoving and StopMoving, so a hovering rotor never stops", () => {
    const calls = callsOf(buildLuaScript(unit()));
    expect(
      calls.filter((c) => c.frame >= MOVING && c.frame < DEACTIVATE),
    ).toEqual([]);
  });
});

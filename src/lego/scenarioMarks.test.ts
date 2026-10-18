import { describe, expect, it } from "vitest";

import { buildLuaScript } from "./luaScript";
import { type LegoPiece, type LegoProject, newProject } from "./model";
import { answeredCallins, scenarioMark } from "./scenarioMarks";
import { scenarioById } from "./scriptPlayback";

function project(
  pieces: Partial<LegoPiece>[],
  animations: LegoProject["animations"] = [],
): LegoProject {
  const base = newProject({
    id: "p",
    rootPieceId: "root",
    name: "cakebot",
    packId: "lego",
    packVersion: "1",
    now: "2026-07-28T00:00:00Z",
  });
  return {
    ...base,
    animations,
    pieces: [
      ...base.pieces,
      ...pieces.map((piece, i) => ({
        id: `piece${i}`,
        name: `piece${i}`,
        parentId: "root",
        partId: "x",
        position: [0, 0, 0] as [number, number, number],
        rotation: [0, 0, 0] as [number, number, number],
        scale: [1, 1, 1] as [number, number, number],
        ...piece,
      })),
    ],
  };
}

const LEGS: Partial<LegoPiece>[] = [
  { id: "lt", name: "leftthigh", role: "leg.l1.thigh" },
  { id: "ls", name: "leftshin", role: "leg.l1.shin" },
  { id: "rt", name: "rightthigh", role: "leg.r1.thigh" },
  { id: "rs", name: "rightshin", role: "leg.r1.shin" },
];

const ARM: Partial<LegoPiece>[] = [
  { id: "ab", name: "armbase", role: "buildarm.base" },
  { id: "ar", name: "arm", role: "buildarm.arm" },
];

function mark(id: string, lua: string): string | null {
  const scenario = scenarioById(id);
  if (!scenario) throw new Error(`no scenario ${id}`);
  return scenarioMark(scenario, lua);
}

describe("answeredCallins", () => {
  it("treats a unit with no presets as answering nothing, build stance and Killed included", () => {
    const answered = answeredCallins(buildLuaScript(project([])));
    expect(answered.get("StartBuilding")).toBe(false);
    expect(answered.get("StopBuilding")).toBe(false);
    expect(answered.get("AimWeapon1")).toBe(false);
    expect(answered.get("Killed")).toBe(false);
    expect(answered.get("StartMoving")).toBe(false);
  });

  it("does not define the call-ins the generator never writes", () => {
    const answered = answeredCallins(buildLuaScript(project([])));
    expect(answered.has("HitByWeapon")).toBe(false);
    expect(answered.has("TransportPickup")).toBe(false);
  });
});

describe("scenarioMark", () => {
  const bare = buildLuaScript(project([]));
  const walker = buildLuaScript(
    project(LEGS, [{ presetId: "walk.biped", params: {} }]),
  );

  it("marks Moving on a unit with no movement preset, naming what would answer", () => {
    const reason = mark("moving", bare);
    expect(reason).toMatch(/^Nothing to do\./);
    expect(reason).toContain("Idle sway");
  });

  it("does not mark Moving once a walk preset is applied", () => {
    expect(mark("moving", walker)).toBeNull();
  });

  it("does not mark Starting and stopping when only one half is answered", () => {
    expect(mark("starting-stopping", walker)).toBeNull();
  });

  it("never marks Standing still, which fires nothing but Create", () => {
    expect(mark("idle", bare)).toBeNull();
  });

  it("marks Hit and destroyed as not covered by presets, naming the call-in to write", () => {
    const reason = mark("destroyed", walker);
    expect(reason).toMatch(/^Nothing to do\./);
    expect(reason).toContain("Wreck pose");
  });

  it("says presets do not cover transport, and what does", () => {
    const reason = mark("transport-pickup", walker);
    expect(reason).toBe(
      "Presets do not cover this. Take the script over and write TransportPickup, TransportDrop.",
    );
  });

  it("does not count the build stance line as a preset reacting to building", () => {
    expect(mark("building", bare)).toMatch(/^Nothing to do\./);
  });

  it("does not mark Building once a build arm is applied", () => {
    const lua = buildLuaScript(
      project(ARM, [{ presetId: "buildarm", params: {} }]),
    );
    expect(mark("building", lua)).toBeNull();
  });

  it("does not mark a factory that has only the factory build cycle", () => {
    const lua = buildLuaScript(
      project(
        [{ id: "door", name: "door", role: "door" }],
        [{ presetId: "build.factory", params: {} }],
      ),
    );
    expect(mark("building-factory", lua)).toBeNull();
  });

  it("does not count AimWeapon1's fallback as a reaction to aiming", () => {
    expect(mark("firing", bare)).toMatch(/^Nothing to do\./);
  });

  it("does not mark a unit that only settles after a shot", () => {
    const lua = buildLuaScript(
      project(
        [{ id: "h", name: "hull", role: "base" }],
        [{ presetId: "body.settle", params: {} }],
      ),
    );
    expect(mark("firing", lua)).toBeNull();
  });

  it("offers the settle to a unit that fires and reacts to nothing", () => {
    expect(mark("firing", bare)).toContain("Body settles after a shot");
  });
});

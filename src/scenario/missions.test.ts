import { describe, expect, it } from "vitest";
import { gameMissions, isScenarioId } from "./missions";
import type { Scenario } from "./model";

const ID = "3f2a1b4c-5d6e-4f70-8192-a3b4c5d6e7f8";

function scenario(id: string, name: string): Scenario {
  return {
    schemaVersion: 1,
    id,
    name,
    description: "",
    runtimeVersion: 1,
    setup: {
      participants: [],
      gameName: "BAR",
      mapName: "Bismuth Valley",
      startPosType: 0,
      modOptionValues: {},
    },
    teams: {},
    zones: [],
    actors: [],
    groups: [],
    prefabs: [],
    restrictions: {},
    vars: {},
    triggers: [],
    objectives: [],
    dialogue: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

describe("isScenarioId", () => {
  it("holds for the ids coilbox mints", () => {
    expect(isScenarioId(ID)).toBe(true);
    expect(isScenarioId(ID.toUpperCase())).toBe(true);
  });

  it("releases a name a game gave its own mission", () => {
    expect(isScenarioId("tutorial")).toBe(false);
    expect(isScenarioId("mission-01")).toBe(false);
    expect(isScenarioId("runtime.lua")).toBe(false);
  });

  it("releases a uuid of another version", () => {
    expect(isScenarioId("3f2a1b4c-5d6e-1f70-8192-a3b4c5d6e7f8")).toBe(false);
  });
});

describe("gameMissions", () => {
  it("names a folder after the scenario it was compiled from", () => {
    const [mission] = gameMissions([ID], [scenario(ID, "Ambush at Dawn")]);
    expect(mission).toEqual({ id: ID, name: "Ambush at Dawn", ours: true });
  });

  it("keeps a folder whose scenario has since been deleted", () => {
    expect(gameMissions([ID], [])).toEqual([
      { id: ID, name: null, ours: true },
    ]);
  });

  it("marks the game's own mission as not coilbox's", () => {
    expect(gameMissions(["tutorial"], [])).toEqual([
      { id: "tutorial", name: null, ours: false },
    ]);
  });
});

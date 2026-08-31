import { beforeEach, describe, expect, it, vi } from "vitest";

const mutatorMock = vi.fn();
const readMissionMock = vi.fn();

// mutator.ts reaches the plugin through bindings.ts, whose plugin-sdk import
// Vitest's node resolver cannot load from the published dist, so the bindings
// module is stubbed the way storage.test.ts stubs it.
vi.mock("./bindings", () => ({
  scenarioTestMutator: (...args: unknown[]) => mutatorMock(...args),
  scenarioReadMission: (...args: unknown[]) => readMissionMock(...args),
}));

import { MUTATOR_FOLDER } from "../lib/generatedGames";
import { parseScenario, type Scenario } from "./model";
import { buildMutatorModInfo, writeTestMutator } from "./mutator";

function build(overrides: Record<string, unknown> = {}): Scenario {
  const scenario = parseScenario({
    id: "s1",
    name: "Scenario",
    setup: { gameName: "Balanced Annihilation V12.1.1" },
    ...overrides,
  });
  if (!scenario) throw new Error("fixture is not a valid scenario");
  return scenario;
}

describe("buildMutatorModInfo", () => {
  it("depends on the base game by the name unitsync reports", () => {
    const modinfo = buildMutatorModInfo("Balanced Annihilation V12.1.1", "One");

    expect(modinfo).toContain("depend = {");
    expect(modinfo).toContain('"Balanced Annihilation V12.1.1",');
  });

  it("is a game the engine can be launched with", () => {
    expect(buildMutatorModInfo("BA", "One")).toContain("modtype = 1,");
  });

  it("escapes a game or scenario name that would end the literal", () => {
    const modinfo = buildMutatorModInfo('a "game"', 'b\\"');

    expect(modinfo).toContain('"a \\"game\\""');
    expect(modinfo).not.toContain('a "game"');
    expect(modinfo).toContain('Testing b\\\\\\" on top of a \\"game\\".');
  });
});

describe("writeTestMutator", () => {
  beforeEach(() => {
    mutatorMock.mockReset();
    readMissionMock.mockReset();
    mutatorMock.mockResolvedValue({
      dir: "/data/games/coilbox-mission-test.sdd",
      folder: MUTATOR_FOLDER,
      installed: { version: 3, schemaVersion: 1, conditions: [], actions: [] },
      files: ["missions/runtime.lua"],
      media: [],
    });
  });

  it("writes the compiled scenario and the base game it depends on", async () => {
    readMissionMock.mockResolvedValue({ mission: { schemaVersion: 1 } });

    const written = await writeTestMutator("/data", build());

    const [args] = mutatorMock.mock.calls[0];
    expect(args.dataDir).toBe("/data");
    expect(args.scenarioId).toBe("s1");
    expect(args.modinfo).toContain('"Balanced Annihilation V12.1.1",');
    expect(args.mission).toContain("Compiled by coilbox");
    expect(written.version).toBe(3);
    expect(written.mission).toBe(
      "coilbox-mission-test.sdd/missions/s1/mission.lua",
    );
  });

  it("validates the file that was written, not the document", async () => {
    readMissionMock.mockResolvedValue({ mission: { schemaVersion: 1 } });

    const written = await writeTestMutator("/data", build());

    expect(readMissionMock).toHaveBeenCalledWith({
      root: "/data/games/coilbox-mission-test.sdd",
      path: "missions/s1/mission.lua",
    });
    expect(written.issues).toEqual([]);
  });

  it("carries a game's own mission across as bytes rather than recompiling it", async () => {
    readMissionMock.mockResolvedValue({ mission: { schemaVersion: 1 } });
    const shipped = "return { --[[ the game's own ]] }";

    await writeTestMutator("/data", build(), undefined, undefined, shipped);

    const [args] = mutatorMock.mock.calls[0];
    expect(args.mission).toBe(shipped);
  });

  it("reports a mission the engine could not load rather than throwing", async () => {
    readMissionMock.mockRejectedValue(
      new Error("attempt to index a nil value"),
    );

    const written = await writeTestMutator("/data", build());

    expect(written.issues).toEqual([
      {
        path: "missions/s1/mission.lua",
        message: "attempt to index a nil value",
      },
    ]);
  });
});

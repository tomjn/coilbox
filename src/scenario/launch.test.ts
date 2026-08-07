import { beforeEach, describe, expect, it, vi } from "vitest";

const runtimeStatusMock = vi.fn();
const writeMissionMock = vi.fn();
const testMutatorMock = vi.fn();
const readMissionMock = vi.fn();

// launch.ts reaches the plugin through bindings.ts, whose plugin-sdk import
// Vitest's node resolver cannot load from the published dist. Stubbed the way
// mutator.test.ts stubs it.
vi.mock("./bindings", () => ({
  scenarioRuntimeStatus: (...args: unknown[]) => runtimeStatusMock(...args),
  scenarioWriteMission: (...args: unknown[]) => writeMissionMock(...args),
  scenarioTestMutator: (...args: unknown[]) => testMutatorMock(...args),
  scenarioReadMission: (...args: unknown[]) => readMissionMock(...args),
}));

import type { GameItem } from "../content/bindings";
import { MUTATOR_FOLDER } from "../lib/generatedGames";
import type { Participant } from "../play/participants";
import {
  launchScenario,
  MISSION_MODOPTION,
  missionIssueMessage,
  scenarioLaunchBlocker,
  scenarioRoute,
} from "./launch";
import { parseScenario, type Scenario } from "./model";

const you: Participant = {
  id: "you",
  kind: "you",
  name: "Player",
  side: "",
  color: [1, 0, 0],
  allyTeam: 0,
  spectator: false,
};

function build(overrides: Record<string, unknown> = {}): Scenario {
  const scenario = parseScenario({
    id: "s1",
    name: "Scenario",
    runtimeVersion: 1,
    setup: {
      gameName: "Splinter Faction test",
      mapName: "Comet Catcher Redux",
      startPosType: 0,
      modOptionValues: { deathmode: "com" },
      participants: [you],
    },
    teams: { you: {} },
    ...overrides,
  });
  if (!scenario) throw new Error("fixture is not a valid scenario");
  return scenario;
}

/** A game as the content scan reports it. */
function game(name: string, archive: string, path?: string): GameItem {
  return {
    name,
    primaryArchive: { name: archive, path },
    dependencyArchives: [],
    info: {},
  };
}

const LOOSE = game("Splinter Faction test", "sf.sdd", "/games/sf.sdd");
const PACKAGED = game("Splinter Faction test", "sf.sdz");
const MUTATOR = game("Coilbox mission test test", MUTATOR_FOLDER, "/m");

describe("scenarioRoute", () => {
  it("lets a game that vendors a new enough runtime play the scenario itself", () => {
    const choice = scenarioRoute({
      game: LOOSE,
      installed: 2,
      required: 1,
      reader: "author",
    });

    expect(choice.route).toBe("adopted");
    expect(choice.reason).toContain("version 2");
  });

  it("sends a packaged game to the mutator, because it cannot be written into", () => {
    const choice = scenarioRoute({
      game: PACKAGED,
      installed: 2,
      required: 1,
      reader: "author",
    });

    expect(choice.route).toBe("mutator");
    expect(choice.reason).toContain("packaged archive");
  });

  it("sends a game with no runtime to the mutator", () => {
    const choice = scenarioRoute({
      game: LOOSE,
      installed: null,
      required: 1,
      reader: "author",
    });

    expect(choice.route).toBe("mutator");
    expect(choice.reason).toContain("has not adopted");
  });

  it("tells a player what coilbox does rather than how it does it", () => {
    const choice = scenarioRoute({
      game: PACKAGED,
      installed: null,
      required: 1,
      reader: "player",
    });

    expect(choice.route).toBe("mutator");
    expect(choice.reason).not.toContain("mutator");
    expect(choice.reason).toContain("cannot play a scenario on its own");
  });

  it("sends a game whose runtime is older than the scenario to the mutator", () => {
    const choice = scenarioRoute({
      game: LOOSE,
      installed: 1,
      required: 3,
      reader: "author",
    });

    expect(choice.route).toBe("mutator");
    expect(choice.reason).toContain("needs version 3");
  });
});

describe("launchScenario", () => {
  const launch = vi.fn();
  const rescan = vi.fn();

  function run(scenario: Scenario, games: GameItem[]) {
    return launchScenario({
      scenario,
      reader: "author",
      dataDir: "/data",
      games,
      rescan,
      launch,
    });
  }

  beforeEach(() => {
    runtimeStatusMock.mockReset();
    writeMissionMock.mockReset();
    testMutatorMock.mockReset();
    readMissionMock.mockReset();
    launch.mockReset();
    rescan.mockReset();

    runtimeStatusMock.mockResolvedValue({
      installed: { version: 1, schemaVersion: 1, conditions: [], actions: [] },
      available: { version: 1, schemaVersion: 1, conditions: [], actions: [] },
    });
    writeMissionMock.mockResolvedValue({
      dir: "/games/sf.sdd/missions/s1",
      media: [],
    });
    testMutatorMock.mockResolvedValue({
      dir: "/data/games/coilbox-mission-test.sdd",
      folder: MUTATOR_FOLDER,
      installed: { version: 1, schemaVersion: 1, conditions: [], actions: [] },
      files: [],
      media: [],
    });
    readMissionMock.mockResolvedValue({ mission: { schemaVersion: 1 } });
    rescan.mockResolvedValue([LOOSE, MUTATOR]);
    launch.mockResolvedValue({ exitCode: 0 });
  });

  it("writes the mission into a game that vendors the runtime, and plays it as itself", async () => {
    const result = await run(build(), [LOOSE]);

    expect(writeMissionMock).toHaveBeenCalledWith({
      root: "/games/sf.sdd",
      scenarioId: "s1",
      mission: expect.stringContaining("Compiled by coilbox"),
    });
    expect(testMutatorMock).not.toHaveBeenCalled();
    expect(result.ok && result.route).toBe("adopted");
    expect(result.ok && result.config.gameType).toBe("Splinter Faction test");
    expect(result.ok && result.mission).toBe("missions/s1/mission.lua");
  });

  it("arms the runtime with the scenario id, keeping the setup's own modoptions", async () => {
    const result = await run(build(), [LOOSE]);

    expect(result.ok && result.config.modOptions).toEqual({
      deathmode: "com",
      [MISSION_MODOPTION]: "s1",
    });
  });

  it("plays the fight the captured preset described: restrict list, advantage and income", async () => {
    const scenario = build({
      setup: {
        gameName: "Splinter Faction test",
        mapName: "Comet Catcher Redux",
        startPosType: 0,
        modOptionValues: { deathmode: "com" },
        participants: [you],
        restrictions: {
          disabledUnits: ["armbrtha", "corbhmth"],
          advantage: 0.25,
          incomeMultiplier: 0.5,
        },
      },
    });

    const result = await run(scenario, [LOOSE]);

    expect(result.ok && result.config.restrictedUnits).toEqual({
      armbrtha: 0,
      corbhmth: 0,
    });
    expect(result.ok && result.config.teams[0].advantage).toBe(0.25);
    expect(result.ok && result.config.teams[0].incomeMultiplier).toBe(1.5);
  });

  it("adds a campaign mission's own disabled units to the setup's", async () => {
    const scenario = build({
      setup: {
        gameName: "Splinter Faction test",
        mapName: "Comet Catcher Redux",
        startPosType: 0,
        modOptionValues: {},
        participants: [you],
        restrictions: { disabledUnits: ["armbrtha"] },
      },
    });

    const result = await launchScenario({
      scenario,
      reader: "author",
      dataDir: "/data",
      games: [LOOSE],
      rescan,
      launch,
      disabledUnits: ["corbhmth"],
    });

    expect(result.ok && result.config.restrictedUnits).toEqual({
      armbrtha: 0,
      corbhmth: 0,
    });
  });

  it("restricts nothing when the setup captured nothing", async () => {
    const result = await run(build(), [LOOSE]);

    expect(result.ok && result.config.restrictedUnits).toBeUndefined();
    expect(result.ok && result.config.teams[0].advantage).toBeUndefined();
  });

  it("validates what was written into the game, not the document", async () => {
    await run(build(), [LOOSE]);

    expect(readMissionMock).toHaveBeenCalledWith({
      root: "/games/sf.sdd",
      path: "missions/s1/mission.lua",
    });
  });

  it("plays a packaged game through the mutator, under the name the engine reports", async () => {
    const result = await run(build(), [PACKAGED]);

    expect(testMutatorMock).toHaveBeenCalled();
    expect(writeMissionMock).not.toHaveBeenCalled();
    expect(rescan).toHaveBeenCalled();
    expect(result.ok && result.route).toBe("mutator");
    expect(result.ok && result.config.gameType).toBe(
      "Coilbox mission test test",
    );
  });

  it("refuses to launch a mission that did not validate", async () => {
    readMissionMock.mockResolvedValue({
      mission: {
        schemaVersion: 1,
        teams: { you: { team: 0 } },
        actors: [{ id: "boss", unitDef: "armcom", team: "nobody" }],
      },
    });

    const result = await run(build(), [LOOSE]);

    expect(launch).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    expect(!result.ok && result.issues).toHaveLength(1);
    expect(!result.ok && result.message).toContain('no team called "nobody"');
  });

  /**
   * Issue #908. A unit def the game does not have spawns nothing and says
   * nothing, so the launch is refused. It takes the game's unit list to know,
   * and without one the same mission goes through.
   */
  it("refuses a mission naming a unit the game does not have", async () => {
    readMissionMock.mockResolvedValue({
      mission: {
        schemaVersion: 1,
        game: "Splinter Faction test",
        teams: { you: { team: 0, startUnits: ["ak", "liftr"] } },
      },
    });

    expect((await run(build(), [LOOSE])).ok).toBe(true);

    const result = await launchScenario({
      scenario: build(),
      reader: "author",
      dataDir: "/data",
      games: [LOOSE],
      rescan,
      launch,
      units: [{ name: "ak" }, { name: "lifter" }],
    });

    expect(result.ok).toBe(false);
    expect(!result.ok && result.issues.map((i) => i.path)).toEqual([
      'teams["you"].startUnits[1]',
    ]);
    expect(!result.ok && result.message).toContain(
      'no unit type called "liftr"',
    );
  });

  /**
   * Issue #853. A blank objective is a mission that plays, so it is carried out
   * with the result rather than being a reason to refuse the launch.
   */
  it("plays a mission that only warns, and hands the warnings back", async () => {
    readMissionMock.mockResolvedValue({
      mission: {
        schemaVersion: 1,
        teams: { you: { team: 0 } },
        objectives: [{ id: "hold", kind: "primary", text: "" }],
      },
    });

    const result = await run(build(), [LOOSE]);

    expect(launch).toHaveBeenCalled();
    expect(result.ok).toBe(true);
    expect(result.ok && result.warnings.map((i) => i.path)).toEqual([
      'objectives["hold"].text',
    ]);
  });

  it("refuses a mission the engine could not load at all", async () => {
    readMissionMock.mockRejectedValue(new Error("unexpected symbol near '}'"));

    const result = await run(build(), [LOOSE]);

    expect(launch).not.toHaveBeenCalled();
    expect(!result.ok && result.message).toContain("unexpected symbol");
  });

  it("does not even rescan when the mutator's mission is broken", async () => {
    readMissionMock.mockRejectedValue(new Error("no such file"));

    await run(build(), [PACKAGED]);

    expect(rescan).not.toHaveBeenCalled();
    expect(launch).not.toHaveBeenCalled();
  });

  it("refuses a scenario whose game is not installed", async () => {
    const result = await run(build(), []);

    expect(launch).not.toHaveBeenCalled();
    expect(!result.ok && result.message).toContain("Splinter Faction test");
  });

  it("refuses a scenario newer than the runtime coilbox itself ships", async () => {
    const result = await run(build({ runtimeVersion: 9 }), [PACKAGED]);

    expect(launch).not.toHaveBeenCalled();
    expect(!result.ok && result.message).toContain("ships version 1");
  });

  it("refuses when the engine did not pick the mutator up", async () => {
    rescan.mockResolvedValue([PACKAGED]);

    const result = await run(build(), [PACKAGED]);

    expect(launch).not.toHaveBeenCalled();
    expect(!result.ok && result.message).toContain("did not pick up");
  });
});

describe("missionIssueMessage", () => {
  it("leads with the first problem and counts the rest", () => {
    const message = missionIssueMessage("author", [
      { path: 'actors["boss"].team', message: 'no team called "x"' },
      { path: 'actors["mate"].team', message: 'no team called "y"' },
    ]);

    expect(message).toContain("2 problems");
    expect(message).toContain('Actor "boss", team: no team called "x"');
    expect(message).toContain("(and 1 more)");
  });
});

describe("scenarioLaunchBlocker", () => {
  const blocker = (
    overrides: Partial<Parameters<typeof scenarioLaunchBlocker>[0]> = {},
  ) =>
    scenarioLaunchBlocker({
      scenario: build(),
      hasEngine: true,
      games: [LOOSE],
      running: false,
      reader: "author",
      ...overrides,
    });

  it("lets a scenario whose game is installed be tested", () => {
    expect(blocker()).toBeNull();
  });

  it("stops a scenario with no engine to run it", () => {
    expect(blocker({ hasEngine: false })).toContain("No engine");
  });

  it("stops a scenario that has no setup yet", () => {
    const scenario = build({
      setup: {
        gameName: "",
        mapName: "",
        startPosType: 0,
        modOptionValues: {},
        participants: [you],
      },
    });

    expect(blocker({ scenario })).toContain("no game and map");
  });

  it("stops a scenario set in a game that is not installed", () => {
    expect(blocker({ games: [] })).toContain("Splinter Faction test");
  });

  it("does not tell a player to set the scenario up on another game", () => {
    const said = blocker({ games: [], reader: "player" });

    expect(said).toContain("Install it from Content");
    expect(said).not.toContain("set the scenario up");
  });

  it("waits rather than blocking while the scan has not answered", () => {
    expect(blocker({ games: null })).toBeNull();
  });

  it("stops a second launch while a game is running", () => {
    expect(blocker({ running: true })).toContain("already running");
  });
});

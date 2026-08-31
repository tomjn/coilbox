import { beforeEach, describe, expect, it, vi } from "vitest";

const runtimeStatusMock = vi.fn();
const writeMissionMock = vi.fn();
const testMutatorMock = vi.fn();
const readMissionMock = vi.fn();
const gameRuntimeMock = vi.fn();
const gameMissionFileMock = vi.fn();
const writeGameMissionMock = vi.fn();
const evalMissionMock = vi.fn();

// launch.ts reaches the plugin through bindings.ts, whose plugin-sdk import
// Vitest's node resolver cannot load from the published dist. Stubbed the way
// mutator.test.ts stubs it.
vi.mock("./bindings", () => ({
  scenarioRuntimeStatus: (...args: unknown[]) => runtimeStatusMock(...args),
  scenarioWriteMission: (...args: unknown[]) => writeMissionMock(...args),
  scenarioTestMutator: (...args: unknown[]) => testMutatorMock(...args),
  scenarioReadMission: (...args: unknown[]) => readMissionMock(...args),
  scenarioGameRuntime: (...args: unknown[]) => gameRuntimeMock(...args),
  scenarioGameMissionFile: (...args: unknown[]) => gameMissionFileMock(...args),
  scenarioWriteGameMission: (...args: unknown[]) =>
    writeGameMissionMock(...args),
  scenarioEvalMission: (...args: unknown[]) => evalMissionMock(...args),
}));

import type { GameItem } from "../content/bindings";
import { MUTATOR_FOLDER } from "../lib/generatedGames";
import type { Participant } from "../play/participants";
import { compileScenario } from "./compile";
import {
  launchScenario,
  MISSION_MODOPTION,
  missionIssueMessage,
  scenarioLaunchBlocker,
  scenarioRoute,
} from "./launch";
import { parseScenario, type Scenario } from "./model";
import type { GameOrigin } from "./storage";
import { missionDriftedFromDocument } from "./wording";

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
/** The same packaged game, at the path a real content scan reports for it. */
const PACKAGED_AT = game("Splinter Faction test", "sf.sdz", "/games/sf.sdz");
const MUTATOR = game("Coilbox mission test test", MUTATOR_FOLDER, "/m");

/** A mission the packaged game ships in its own archive (issue #2160). */
const SHIPPED: GameOrigin = {
  gameName: "Splinter Faction test",
  archivePath: "/games/sf.sdz",
  folder: "first-contact",
  loose: false,
};

/** The same mission, in a loose game coilbox can write back into. */
const SHIPPED_LOOSE: GameOrigin = {
  gameName: "Splinter Faction test",
  archivePath: "/games/sf.sdd",
  folder: "first-contact",
  loose: true,
};

/**
 * What that mission's `mission.lua` holds, as the archive hands it over.
 *
 * Nothing compiled this, so it has drifted from every document: the tests that
 * care about a mission still matching its document ship
 * `compileScenario(build())` instead.
 */
const SHIPPED_LUA = "return { schemaVersion = 1 }";

/** The archive handing a file over, as `scenario_game_mission_file` does. */
const archived = (text: string) => ({
  base64: Buffer.from(text).toString("base64"),
});

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

  /**
   * Issue #2160. The `.sdd` test is really "can coilbox write the mission?",
   * and a game that ships the mission itself is never asked to be written into.
   */
  it("lets a packaged game play a mission it ships itself", () => {
    const choice = scenarioRoute({
      game: PACKAGED,
      installed: 3,
      required: 3,
      reader: "author",
      missionInGame: true,
    });

    expect(choice.route).toBe("adopted");
    expect(choice.reason).toContain("ships this mission");
  });

  it("still sends a packaged game to the mutator when the mission is not in it", () => {
    const choice = scenarioRoute({
      game: PACKAGED,
      installed: 3,
      required: 3,
      reader: "author",
      missionInGame: false,
    });

    expect(choice.route).toBe("mutator");
    expect(choice.reason).toContain("packaged archive");
  });

  it("sends a packaged game to the mutator when its runtime is too old", () => {
    const choice = scenarioRoute({
      game: PACKAGED,
      installed: 1,
      required: 3,
      reader: "author",
      missionInGame: true,
    });

    expect(choice.route).toBe("mutator");
    expect(choice.reason).toContain("needs version 3");
  });

  /**
   * The runtime question is asked before the write question, so a packaged game
   * with no runtime hears the one thing a maintainer can act on: adopt it.
   */
  it("tells a packaged game with no runtime to adopt one, not that it is packaged", () => {
    const choice = scenarioRoute({
      game: PACKAGED,
      installed: null,
      required: 1,
      reader: "author",
      missionInGame: false,
    });

    expect(choice.route).toBe("mutator");
    expect(choice.reason).toContain("has not adopted");
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
      optionSchema: [],
      mapOptionSchema: [],
      rescan,
      launch,
    });
  }

  beforeEach(() => {
    runtimeStatusMock.mockReset();
    writeMissionMock.mockReset();
    testMutatorMock.mockReset();
    readMissionMock.mockReset();
    gameRuntimeMock.mockReset();
    gameMissionFileMock.mockReset();
    writeGameMissionMock.mockReset();
    evalMissionMock.mockReset();
    launch.mockReset();
    rescan.mockReset();

    gameRuntimeMock.mockResolvedValue({
      installed: { version: 1, schemaVersion: 1, conditions: [], actions: [] },
    });
    gameMissionFileMock.mockResolvedValue(archived(SHIPPED_LUA));
    writeGameMissionMock.mockResolvedValue({
      dir: "/games/sf.sdd/missions/first-contact",
    });
    evalMissionMock.mockResolvedValue({ mission: { schemaVersion: 1 } });
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
      optionSchema: [],
      mapOptionSchema: [],
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

  /**
   * Issue #2160. The game brought the mission with it, so there is nothing to
   * write and nowhere to write it. The archive is read and the game plays as
   * itself, under the folder name its own archive uses.
   */
  it("plays a packaged game's own mission out of its archive, writing nothing", async () => {
    const result = await launchScenario({
      scenario: build(),
      reader: "author",
      dataDir: "/data",
      games: [PACKAGED_AT],
      optionSchema: [],
      mapOptionSchema: [],
      rescan,
      launch,
      origin: SHIPPED,
    });

    expect(writeMissionMock).not.toHaveBeenCalled();
    expect(testMutatorMock).not.toHaveBeenCalled();
    expect(rescan).not.toHaveBeenCalled();
    expect(gameMissionFileMock).toHaveBeenCalledWith({
      root: "/games/sf.sdz",
      folder: "first-contact",
      file: "mission.lua",
    });
    expect(evalMissionMock).toHaveBeenCalledWith({ source: SHIPPED_LUA });
    expect(result.ok && result.route).toBe("adopted");
    expect(result.ok && result.config.gameType).toBe("Splinter Faction test");
    expect(result.ok && result.mission).toBe(
      "missions/first-contact/mission.lua",
    );
  });

  it("arms the runtime with the game's own folder, not the document id", async () => {
    const result = await launchScenario({
      scenario: build(),
      reader: "author",
      dataDir: "/data",
      games: [PACKAGED_AT],
      optionSchema: [],
      mapOptionSchema: [],
      rescan,
      launch,
      origin: SHIPPED,
    });

    expect(result.ok && result.config.modOptions).toEqual({
      deathmode: "com",
      [MISSION_MODOPTION]: "first-contact",
    });
  });

  it("refuses a shipped mission that did not validate", async () => {
    evalMissionMock.mockResolvedValue({
      mission: {
        schemaVersion: 1,
        teams: { you: { team: 0 } },
        actors: [{ id: "boss", unitDef: "armcom", team: "nobody" }],
      },
    });

    const result = await launchScenario({
      scenario: build(),
      reader: "author",
      dataDir: "/data",
      games: [PACKAGED_AT],
      optionSchema: [],
      mapOptionSchema: [],
      rescan,
      launch,
      origin: SHIPPED,
    });

    expect(launch).not.toHaveBeenCalled();
    expect(!result.ok && result.message).toContain('no team called "nobody"');
  });

  /**
   * A game can ship a mission without shipping a runtime new enough to play it.
   * That takes the mutator route, and the mission travels as the bytes the
   * archive holds rather than being recompiled from the document.
   */
  it("carries a game's own mission into the mutator when the game has no runtime", async () => {
    gameRuntimeMock.mockRejectedValue(new Error("no missions/runtime.lua"));

    const result = await launchScenario({
      scenario: build(),
      reader: "author",
      dataDir: "/data",
      games: [PACKAGED_AT],
      optionSchema: [],
      mapOptionSchema: [],
      rescan,
      launch,
      origin: SHIPPED,
    });

    expect(testMutatorMock).toHaveBeenCalledWith(
      expect.objectContaining({ mission: SHIPPED_LUA }),
    );
    expect(result.ok && result.route).toBe("mutator");
    expect(result.ok && result.config.modOptions?.[MISSION_MODOPTION]).toBe(
      "s1",
    );
  });

  /**
   * Issue #2160. A game ships both the compiled mission and the document it was
   * built from, and the two can fall out of step. What happens next is decided
   * by whether coilbox can write into the game at all.
   */
  describe("when a game's mission has drifted from its document", () => {
    /** The scenario every drift test compiles, and its compiled mission. */
    const document = build();
    const compiled = compileScenario(document);

    function play(games: GameItem[], origin: GameOrigin, reader = "author") {
      return launchScenario({
        scenario: document,
        reader: reader as "author" | "player",
        dataDir: "/data",
        games,
        optionSchema: [],
        mapOptionSchema: [],
        rescan,
        launch,
        origin,
      });
    }

    it("writes nothing when what the game ships still matches its document", async () => {
      gameMissionFileMock.mockResolvedValue(archived(compiled));

      const result = await play([LOOSE], SHIPPED_LOOSE);

      expect(writeGameMissionMock).not.toHaveBeenCalled();
      expect(evalMissionMock).toHaveBeenCalledWith({ source: compiled });
      expect(result.ok).toBe(true);
      expect(result.ok && result.warnings).toEqual([]);
    });

    it("recompiles a drifted loose game's mission and plays that one", async () => {
      const result = await play([LOOSE], SHIPPED_LOOSE);

      expect(writeGameMissionMock).toHaveBeenCalledWith({
        root: "/games/sf.sdd",
        folder: "first-contact",
        document: JSON.stringify(document),
        mission: compiled,
      });
      // Read back off disk, so what validated is the file that was just
      // written rather than the stale bytes the archive handed over.
      expect(readMissionMock).toHaveBeenCalledWith({
        root: "/games/sf.sdd",
        path: "missions/first-contact/mission.lua",
      });
      expect(evalMissionMock).not.toHaveBeenCalled();
      expect(result.ok && result.route).toBe("adopted");
      expect(result.ok && result.mission).toBe(
        "missions/first-contact/mission.lua",
      );
      expect(result.ok && result.warnings).toEqual([]);
    });

    it("refuses a loose game whose mission could not be rewritten", async () => {
      writeGameMissionMock.mockRejectedValue(
        new Error("read-only file system"),
      );

      const result = await play([LOOSE], SHIPPED_LOOSE);

      expect(launch).not.toHaveBeenCalled();
      expect(!result.ok && result.message).toContain("read-only file system");
    });

    it("plays a drifted packaged game's shipped mission and warns the author", async () => {
      const result = await play([PACKAGED_AT], SHIPPED);

      expect(writeGameMissionMock).not.toHaveBeenCalled();
      // The shipped bytes are what validated, and what played.
      expect(evalMissionMock).toHaveBeenCalledWith({ source: SHIPPED_LUA });
      expect(result.ok).toBe(true);
      expect(launch).toHaveBeenCalled();
      expect(result.ok && result.warnings.map((i) => i.message)).toEqual([
        missionDriftedFromDocument("author", "Splinter Faction test"),
      ]);
    });

    it("tells a player nothing about a drift they cannot act on", async () => {
      const result = await play([PACKAGED_AT], SHIPPED, "player");

      expect(result.ok).toBe(true);
      expect(result.ok && result.warnings).toEqual([]);
    });
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
      optionSchema: [],
      mapOptionSchema: [],
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

import { beforeEach, describe, expect, it, vi } from "vitest";

const runtimeStatusMock = vi.fn();
const writeMissionMock = vi.fn();
const testMutatorMock = vi.fn();
const readMissionMock = vi.fn();

// `launchScenario` reaches its plugin through `scenario/bindings`, whose
// plugin-sdk import Vitest's node resolver cannot load from the published dist.
// Stubbed the way `scenario/launch.test.ts` stubs it.
vi.mock("../scenario/bindings", () => ({
  scenarioRuntimeStatus: (...args: unknown[]) => runtimeStatusMock(...args),
  scenarioWriteMission: (...args: unknown[]) => writeMissionMock(...args),
  scenarioTestMutator: (...args: unknown[]) => testMutatorMock(...args),
  scenarioReadMission: (...args: unknown[]) => readMissionMock(...args),
}));

import type { ConfigOption, DemoInfo, GameItem } from "../content/bindings";
import { demoInfoToSkirmishDraft } from "../content/demoToSkirmish";
import { launchScenario, MISSION_MODOPTION } from "../scenario/launch";
import { parseScenario } from "../scenario/model";
import type { SkirmishDraft } from "./drafts";
import { type Participant, toBattleConfig } from "./participants";

/**
 * A start script holds only what was changed. The engine team's advice is that a
 * lobby writes nothing else, and it keeps the block the same from every screen
 * that launches a game.
 */

/** A game declaring three options, one of which the setup below overrides. */
const SCHEMA: ConfigOption[] = [
  { key: "presets", name: "Presets", type: "section" },
  {
    key: "deathmode",
    name: "Death mode",
    type: "list",
    default: "killall",
    section: "presets",
  },
  { key: "startmetal", name: "Start metal", type: "number", default: "1000" },
  { key: "zombies", name: "Zombies", type: "bool", default: "0" },
];

/** The one thing the player changed. Everything else is the game's to decide. */
const CHOSEN = { deathmode: "com" };

/** A map declaring two of its own options, neither of which the setup changes. */
const MAP_SCHEMA: ConfigOption[] = [
  { key: "atmosphere", name: "Atmosphere Settings", type: "section" },
  {
    key: "fog",
    name: "Fog",
    type: "bool",
    default: "1",
    section: "atmosphere",
  },
  {
    key: "extractorradius",
    name: "Extractor Radius",
    type: "number",
    default: "100",
  },
];

const GAME = "Splinter Faction test";
const MAP = "Comet Catcher Redux";

const you: Participant = {
  id: "you",
  kind: "you",
  name: "Player",
  side: "",
  color: [1, 0, 0],
  allyTeam: 0,
  spectator: false,
};

const draft: SkirmishDraft = {
  participants: [you],
  gameName: GAME,
  mapName: MAP,
  startPosType: 0,
  modOptionValues: CHOSEN,
};

/**
 * How the singleplayer screen builds its config, and the same three fields
 * conquest, warpath and a campaign mission take from their own snapshot.
 */
const fromDraft = (d: SkirmishDraft) =>
  toBattleConfig({
    participants: d.participants,
    mapName: d.mapName,
    gameType: d.gameName,
    startPosType: d.startPosType,
    modOptions: d.modOptionValues,
    mapOptions: d.mapOptionValues,
  });

describe("the same game and the same choices, launched different ways", () => {
  const launch = vi.fn();
  const rescan = vi.fn();

  const loose: GameItem = {
    name: GAME,
    primaryArchive: { name: "sf.sdd", path: "/games/sf.sdd" },
    dependencyArchives: [],
    info: {},
  };

  beforeEach(() => {
    runtimeStatusMock.mockReset();
    writeMissionMock.mockReset();
    readMissionMock.mockReset();
    launch.mockReset();
    rescan.mockReset();
    runtimeStatusMock.mockResolvedValue({
      installed: { version: 1, schemaVersion: 1, conditions: [], actions: [] },
      available: { version: 1, schemaVersion: 1, conditions: [], actions: [] },
    });
    writeMissionMock.mockResolvedValue({ dir: "/games/sf.sdd", media: [] });
    readMissionMock.mockResolvedValue({ mission: { schemaVersion: 1 } });
    launch.mockResolvedValue({ exitCode: 0 });
  });

  it("writes only what the player changed", () => {
    expect(fromDraft(draft).modOptions).toEqual(CHOSEN);
    expect(fromDraft(draft).mapOptions).toBeUndefined();
  });

  it("keeps a preset made from a replay to what the match changed", () => {
    const replay = {
      mapName: MAP,
      gameType: GAME,
      startPosType: 0,
      players: [{ name: "Player", allyTeam: 0, spectator: false }],
      ais: [],
      modOptions: { ...CHOSEN, startmetal: "1000", zombies: "0" },
      mapOptions: { fog: "1", extractorradius: "150" },
    } as unknown as DemoInfo;
    const preset = demoInfoToSkirmishDraft({
      info: replay,
      ais: [],
      sides: [],
      options: SCHEMA,
      mapOptions: MAP_SCHEMA,
    });
    if (!preset) throw new Error("the replay had nobody to refight");

    expect(preset.modOptionValues).toEqual(CHOSEN);
    expect(preset.mapOptionValues).toEqual({ extractorradius: "150" });
  });

  it("agrees between a skirmish and a scenario built on the same setup", async () => {
    const scenario = parseScenario({
      id: "s1",
      name: "Scenario",
      runtimeVersion: 1,
      setup: {
        gameName: GAME,
        mapName: MAP,
        startPosType: 0,
        modOptionValues: CHOSEN,
        participants: [you],
      },
      teams: { you: {} },
    });
    if (!scenario) throw new Error("the fixture is not a valid scenario");

    const result = await launchScenario({
      scenario,
      reader: "author",
      dataDir: "/data",
      games: [loose],
      rescan,
      launch,
    });

    // Everything the skirmish sends, plus the one key that tells the runtime
    // which mission to arm.
    expect(result.ok && result.config.modOptions).toEqual({
      ...fromDraft(draft).modOptions,
      [MISSION_MODOPTION]: "s1",
    });
    expect(result.ok && result.config.mapOptions).toBeUndefined();
  });
});

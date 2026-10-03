import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GameItem } from "../content/bindings";
import type { Participant } from "../play/participants";
import { compileScenario, scenarioMissionValue } from "../scenario/compile";

const { installedRuntime, workshopTestMission, validateCompiledMissionText } =
  vi.hoisted(() => ({
    installedRuntime: vi.fn(async (): Promise<number | null> => null),
    workshopTestMission: vi.fn(async (args: unknown) => ({
      dir: "/data/games/coilbox-workshop-test.sdd",
      folder: "coilbox-workshop-test.sdd",
      files: [] as string[],
      args,
    })),
    validateCompiledMissionText: vi.fn(async (): Promise<unknown[]> => []),
  }));

vi.mock("../scenario/launch", async () => ({
  ...(await vi.importActual<typeof import("../scenario/launch")>(
    "../scenario/launch",
  )),
  installedRuntime,
}));
vi.mock("./mutator", () => ({ workshopTestMission }));
vi.mock("../scenario/validate", async () => ({
  ...(await vi.importActual<typeof import("../scenario/validate")>(
    "../scenario/validate",
  )),
  validateCompiledMissionText,
}));

const {
  TEST_MISSION_ID,
  buildTestGameModInfo,
  buildTestScenario,
  testMissionModOptions,
  writeStartWithUnit,
} = await import("./testMission");

const participants: Participant[] = [
  {
    id: "p-you",
    kind: "you",
    name: "You",
    side: "",
    color: [1, 0, 0],
    allyTeam: 0,
    spectator: false,
  },
  {
    id: "p-ai",
    kind: "ai",
    name: "AI 1",
    ai: { shortName: "NullAI", kind: "native" },
    side: "",
    color: [0, 0, 1],
    allyTeam: 1,
    spectator: false,
  },
];

const ZEUS = { key: "armzeus", label: "Zeus", inGame: true };

const GAME = {
  name: "Balanced Annihilation V15.9.8",
  primaryArchive: { name: "ba.sdd", path: "/data/games/ba.sdd" },
} as unknown as GameItem;

function scenario(unit = ZEUS) {
  return buildTestScenario({
    unit,
    gameName: GAME.name,
    mapName: "Comet Catcher Redux",
    participants,
  });
}

beforeEach(() => {
  installedRuntime.mockReset();
  installedRuntime.mockResolvedValue(null);
  workshopTestMission.mockClear();
  validateCompiledMissionText.mockReset();
  validateCompiledMissionText.mockResolvedValue([]);
});

describe("buildTestScenario", () => {
  it("places the edited unit and the game's copy for the player's side", () => {
    const s = scenario();
    expect(s.teams["p-you"]?.startUnits).toEqual([
      "armzeus",
      "armzeus_coilbox_base",
    ]);
  });

  it("places only the unit when the game has no version of it", () => {
    const s = scenario({ ...ZEUS, inGame: false });
    expect(s.teams["p-you"]?.startUnits).toEqual(["armzeus"]);
  });

  it("places only the unit when the game's copy cannot be made", () => {
    for (const key of ["arm-zeus", "ArmZeus", "arm.zeus", ""]) {
      const s = scenario({ ...ZEUS, key });
      expect(s.teams["p-you"]?.startUnits).toEqual([key]);
    }
  });

  it("gives the player's side a bank, because the runtime empties it at frame 1", () => {
    const resources = scenario().teams["p-you"]?.resources;
    expect(resources?.metal).toBeGreaterThan(0);
    expect(resources?.energy).toBeGreaterThan(0);
  });

  it("leaves the AI's side alone so it keeps its commander", () => {
    const s = scenario();
    expect(s.teams["p-ai"]).toBeUndefined();
    for (const team of Object.values(s.teams)) {
      expect(team.noCommander).toBeUndefined();
    }
  });

  it("places by startUnits and not by fixed positions", () => {
    const s = scenario();
    expect(s.actors).toEqual([]);
    expect(s.groups).toEqual([]);
    expect(s.bases).toEqual([]);
    const mission = scenarioMissionValue(s) as {
      teams: Record<string, { team: number; startUnits: string[] }>;
    };
    expect(mission.teams["p-you"]).toMatchObject({
      team: 0,
      startUnits: ["armzeus", "armzeus_coilbox_base"],
    });
  });

  it("uses the fixed id the generated game rewrites on every test", () => {
    const s = scenario();
    expect(s.id).toBe(TEST_MISSION_ID);
    expect(compileScenario(s)).toContain(TEST_MISSION_ID);
  });

  it("names the game and map it is set in", () => {
    const s = scenario();
    expect(s.setup.gameName).toBe(GAME.name);
    expect(s.setup.mapName).toBe("Comet Catcher Redux");
  });
});

describe("the launch's mod options", () => {
  it("name the mission with coilbox_mission", () => {
    expect(testMissionModOptions()).toEqual({
      coilbox_mission: TEST_MISSION_ID,
    });
  });
});

describe("buildTestGameModInfo", () => {
  it("depends on the base game and is a game the engine can launch", () => {
    const text = buildTestGameModInfo(GAME.name, "Zeus");
    expect(text).toContain(`"${GAME.name}"`);
    expect(text).toContain("modtype = 1");
    expect(text).not.toContain("gamedata");
  });
});

describe("writeStartWithUnit", () => {
  it("ships the runtime when the base game has none", async () => {
    await writeStartWithUnit({
      dataDir: "/data",
      game: GAME,
      scenario: scenario(),
    });
    expect(workshopTestMission).toHaveBeenCalledTimes(1);
    const [args] = workshopTestMission.mock.calls[0] as unknown as [
      Record<string, unknown>,
    ];
    expect(args).toMatchObject({
      dataDir: "/data",
      missionId: TEST_MISSION_ID,
      shipRuntime: true,
    });
    expect(args.mission).toBe(compileScenario(scenario()));
    expect("modinfo" in args).toBe(false);
  });

  it("ships its own runtime when the game's is older than the mission needs", async () => {
    installedRuntime.mockResolvedValue(0);
    await writeStartWithUnit({
      dataDir: "/data",
      game: GAME,
      scenario: scenario(),
    });
    expect(workshopTestMission.mock.calls[0]?.[0]).toMatchObject({
      shipRuntime: true,
    });
  });

  it("ships no runtime when the game already bundles one new enough", async () => {
    installedRuntime.mockResolvedValue(scenario().runtimeVersion);
    await writeStartWithUnit({
      dataDir: "/data",
      game: GAME,
      scenario: scenario(),
    });
    expect(workshopTestMission.mock.calls[0]?.[0]).toMatchObject({
      shipRuntime: false,
    });
  });

  it("passes the modinfo on for the tweak slot route", async () => {
    await writeStartWithUnit({
      dataDir: "/data",
      game: GAME,
      scenario: scenario(),
      modinfo: "return {}",
    });
    expect(workshopTestMission.mock.calls[0]?.[0]).toMatchObject({
      modinfo: "return {}",
    });
  });

  it("writes nothing when the mission does not validate", async () => {
    validateCompiledMissionText.mockResolvedValue([
      { path: "mission.lua", message: "broken" },
    ]);
    await expect(
      writeStartWithUnit({
        dataDir: "/data",
        game: GAME,
        scenario: scenario(),
      }),
    ).rejects.toThrow(/broken/);
    expect(workshopTestMission).not.toHaveBeenCalled();
  });

  it("lets a failed write reach the caller to show", async () => {
    workshopTestMission.mockRejectedValueOnce(
      new Error("could not find the bundled mission runtime"),
    );
    await expect(
      writeStartWithUnit({
        dataDir: "/data",
        game: GAME,
        scenario: scenario(),
      }),
    ).rejects.toThrow(/bundled mission runtime/);
  });
});

// @vitest-environment happy-dom
/**
 * What a campaign mission's launch says about difficulty (issue #2220).
 *
 * The mission goes through `launchScenario`, the same function the Scenarios
 * page and the editor's Test in game call, so the level reaches the engine as
 * the `coilbox_difficulty` modoption by that one route and no other. What is
 * worth pinning here is the input that function is handed: the run's level for a
 * mission that varies by it, and nothing at all otherwise, because "nothing at
 * all" is what every campaign authored before this feature launches with today.
 *
 * No engine and no disk. The launch is stubbed, and it reports a cancelled run
 * (`exitCode: null`), which is the one outcome that ends the flow immediately:
 * nothing is detected, nothing is saved, and the test is left looking at the
 * launch input.
 */

import { act, renderHook, waitFor } from "@testing-library/react";
import { useCallback, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SkirmishDraft } from "../play/drafts";

const {
  composeUnits,
  installedAtlases,
  launchScenario,
  loadUnitCopies,
  playLaunch,
  progressState,
  resolveCompatTarget,
  saved,
  scanState,
} = vi.hoisted(() => ({
  composeUnits: vi.fn(),
  // The folders of the atlas packs installed, set per test.
  installedAtlases: { folders: [] as string[] },
  launchScenario: vi.fn(),
  loadUnitCopies: vi.fn(),
  playLaunch: vi.fn(),
  resolveCompatTarget: vi.fn(),
  // Dependency archives the scanned game lacks, set per test.
  scanState: { missingDependencies: undefined as string[] | undefined },
  // The stored progress document each render starts from, set per test.
  progressState: { file: { schemaVersion: 1, campaigns: {} } as unknown },
  saved: [] as unknown[],
}));

vi.mock("../scenario/launch", () => ({ launchScenario }));
vi.mock("../content/compatSettings", () => ({
  useCompatSettings: () => [{}],
}));
vi.mock("../play/compatTarget", () => ({ resolveCompatTarget }));
vi.mock("./units", async (importActual) => ({
  ...(await importActual<typeof import("./units")>()),
  composeUnits,
  loadUnitCopies,
}));
vi.mock("../lego/pack", () => ({
  loadPack: async () => ({
    library: {
      atlases: [
        { tex1: "atlas.png", packId: "base", folder: null },
        ...installedAtlases.folders.map((folder) => ({
          tex1: "camo.png",
          packId: folder,
          folder,
        })),
      ],
    },
  }),
}));

// The progress store, with the plugin taken out of it. Real React state, so a
// save re-renders the hook under test exactly as the app's own store does.
vi.mock("./campaigns", () => ({
  useCampaignProgress: () => {
    const [progress, setProgress] = useState(progressState.file);
    const save = useCallback(async (next: unknown) => {
      saved.push(next);
      setProgress(next);
    }, []);
    return { progress, save, loading: false, error: null, refresh: vi.fn() };
  },
}));

vi.mock("./scenarioMedia", () => ({
  ensureCampaignScenarioMedia: vi.fn(async () => {}),
}));

vi.mock("../content/bindings", () => ({
  contentDemoInfo: vi.fn(),
  contentListReplays: vi.fn(async () => ({ replays: [] })),
}));

vi.mock("../content/config", () => ({
  primeScan: vi.fn(async () => ({ games: [] })),
  useUnitsyncScan: () => ({
    data: {
      games: [
        {
          name: "BA",
          primaryArchive: { name: "ba.sdz" },
          missingDependencies: scanState.missingDependencies,
        },
      ],
      maps: [{ name: "Comet" }],
    },
    loading: false,
    run: vi.fn(),
  }),
}));

vi.mock("../content/replayUserState", () => ({
  useReplayUserState: () => ({ setProvenance: vi.fn() }),
}));

vi.mock("../play/config", () => ({
  toBattleConfig: vi.fn(() => ({ myPlayerName: "Player" })),
  usePreferredTarget: () => ({
    target: {
      enginePath: "/engine",
      dataDir: "/data",
      executable: "/engine/spring",
    },
    loading: false,
  }),
}));

vi.mock("../play/PlayProvider", () => ({
  usePlay: () => ({ running: false, launch: playLaunch }),
}));

import { primeScan } from "../content/config";
import { toBattleConfig } from "../play/config";
import { newScenario } from "../scenario/create";
import type { Difficulty, Scenario } from "../scenario/model";
import type { Campaign, CampaignMission, ProgressFile } from "./model";
import { useMissionRun } from "./run";

/** A scenario with one actor that is only placed on hard. */
function varying(): Scenario {
  const scenario = newScenario("Beachhead");
  return {
    ...scenario,
    setup: { ...scenario.setup, gameName: "BA", mapName: "Comet" },
    actors: [
      {
        id: "boss",
        unitDef: "corcom",
        team: "enemy",
        pos: { x: 500, z: 500 },
        facing: 0,
        difficulty: { atLeast: "hard" },
      },
    ],
  };
}

/** The same scenario with nothing in it that varies by difficulty. */
function flat(): Scenario {
  const scenario = newScenario("Beachhead");
  return {
    ...scenario,
    setup: { ...scenario.setup, gameName: "BA", mapName: "Comet" },
  };
}

function campaignWith(scenario: Scenario): {
  campaign: Campaign;
  mission: CampaignMission;
} {
  const mission: CampaignMission = {
    id: "m1",
    title: "Beachhead",
    briefing: "",
    objectives: [],
    snapshot: {
      gameName: "BA",
      mapName: "Comet",
      participants: [],
      startPosType: 2,
      modOptionValues: {},
    } as unknown as SkirmishDraft,
    scenario,
    disabledUnits: [],
    skippable: false,
  };
  return {
    campaign: {
      schemaVersion: 1,
      id: "c1",
      type: "ta",
      title: "A Campaign",
      description: "",
      missions: [mission],
      createdAt: "",
      updatedAt: "",
    },
    mission,
  };
}

/** A progress document with the run's difficulty already chosen, or not. */
function progressAt(difficulty?: Difficulty): ProgressFile {
  return {
    schemaVersion: 1,
    campaigns: {
      c1: {
        completedMissionIds: [],
        updatedAt: "",
        ...(difficulty ? { difficulty } : {}),
      },
    },
  };
}

/** Start the mission and hand back what `launchScenario` was asked for. */
async function launchInput(scenario: Scenario) {
  const { campaign, mission } = campaignWith(scenario);
  const { result } = renderHook(() => useMissionRun(campaign, mission));
  await act(async () => {
    await result.current.start();
  });
  expect(launchScenario).toHaveBeenCalledTimes(1);
  return launchScenario.mock.calls[0][0];
}

beforeEach(() => {
  launchScenario.mockReset();
  launchScenario.mockResolvedValue({
    ok: true,
    config: { myPlayerName: "Player" },
    exitCode: null,
  });
  progressState.file = { schemaVersion: 1, campaigns: {} };
  saved.length = 0;
  scanState.missingDependencies = undefined;
  composeUnits.mockReset();
  composeUnits.mockResolvedValue(null);
  loadUnitCopies.mockReset();
  loadUnitCopies.mockResolvedValue(new Map());
  installedAtlases.folders = [];
  playLaunch.mockReset();
  playLaunch.mockResolvedValue({ exitCode: null });
  resolveCompatTarget.mockReset();
  resolveCompatTarget.mockResolvedValue({ kind: "off" });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("a campaign mission's difficulty", () => {
  it("launches at the level the run chose", async () => {
    progressState.file = progressAt("easy");

    expect((await launchInput(varying())).difficulty).toBe("easy");
  });

  /**
   * The protection for every campaign already authored. A run nobody has picked
   * a level for launches saying nothing about difficulty, so the start script is
   * the one it has always been and the runtime plays at its own default.
   */
  it("says nothing about it when nobody has chosen", async () => {
    expect((await launchInput(varying())).difficulty).toBeUndefined();
  });

  // Same rule the scenario drawer follows: a mission that plays the same at
  // every level gets no modoption, whatever the run says.
  it("says nothing for a mission that plays the same at every level", async () => {
    progressState.file = progressAt("hard");

    expect((await launchInput(flat())).difficulty).toBeUndefined();
  });

  it("offers the choice only on a mission that varies by it", () => {
    const varies = campaignWith(varying());
    const same = campaignWith(flat());

    expect(
      renderHook(() => useMissionRun(varies.campaign, varies.mission)).result
        .current.variesByDifficulty,
    ).toBe(true);
    expect(
      renderHook(() => useMissionRun(same.campaign, same.mission)).result
        .current.variesByDifficulty,
    ).toBe(false);
  });

  it("keeps a chosen level on the run and launches the next mission at it", async () => {
    const { campaign, mission } = campaignWith(varying());
    const { result } = renderHook(() => useMissionRun(campaign, mission));

    await act(async () => {
      await result.current.setDifficulty("hard");
    });

    await waitFor(() => expect(result.current.difficulty).toBe("hard"));
    expect((saved[0] as ProgressFile).campaigns.c1.difficulty).toBe("hard");

    await act(async () => {
      await result.current.start();
    });
    expect(launchScenario.mock.calls[0][0].difficulty).toBe("hard");
  });
});

describe("a launch whose rescan fails", () => {
  it("shows the failure as the mission's error instead of throwing", async () => {
    vi.mocked(primeScan).mockRejectedValueOnce(
      new Error("no space left on device"),
    );
    launchScenario.mockImplementation(
      async (input: { rescan: () => Promise<unknown> }) => {
        await input.rescan();
        return { ok: true, config: { myPlayerName: "Player" }, exitCode: null };
      },
    );
    const { campaign, mission } = campaignWith(flat());
    const { result } = renderHook(() => useMissionRun(campaign, mission));

    await act(async () => {
      await result.current.start();
    });

    expect(result.current.error).toBe(
      "The content scan failed: no space left on device",
    );
  });
});

describe("a mission on a game with a missing dependency archive (issue #3489)", () => {
  it("cannot start, says which archive and which game, and does not launch", async () => {
    scanState.missingDependencies = ["zero-k v1.7.6.4"];
    const { campaign, mission } = campaignWith(flat());
    const { result } = renderHook(() => useMissionRun(campaign, mission));

    expect(result.current.canStart).toBe(false);
    expect(result.current.dependencyBlock).toBe(
      "Archive not installed: zero-k v1.7.6.4. BA depends on it.",
    );
    await act(async () => {
      await result.current.start();
    });
    expect(launchScenario).not.toHaveBeenCalled();
  });

  it("starts as before when the game lacks nothing", () => {
    scanState.missingDependencies = [];
    const { campaign, mission } = campaignWith(flat());
    const { result } = renderHook(() => useMissionRun(campaign, mission));

    expect(result.current.canStart).toBe(true);
    expect(result.current.dependencyBlock).toBeNull();
  });
});

// Issue #4516. The campaign's builder units reach the engine through a mutator
// written at launch against the game the install gate resolved.
describe("a campaign with units from the unit builder", () => {
  const tank = {
    unitName: "tank",
    projectId: "p-tank",
    name: "Tank",
    builtBy: ["armlab"],
    copiedAt: "",
  };

  function withUnits(scenario?: Scenario) {
    const { campaign, mission } = campaignWith(flat());
    const played = scenario ? mission : { ...mission, scenario: undefined };
    return {
      campaign: { ...campaign, units: [tank], missions: [played] },
      mission: played,
    };
  }

  it("launches a preset mission as the mutator over the resolved game", async () => {
    composeUnits.mockResolvedValue({
      name: "Coilbox campaign c1",
      leftOut: ["armlab is not in BA, so it does not build tank."],
    });
    const { campaign, mission } = withUnits();
    const { result } = renderHook(() => useMissionRun(campaign, mission));

    await act(async () => {
      await result.current.start();
    });

    expect(composeUnits).toHaveBeenCalledWith(
      campaign,
      { enginePath: "/engine", dataDir: "/data", executable: "/engine/spring" },
      { name: "BA", archive: "ba.sdz" },
    );
    expect(vi.mocked(toBattleConfig).mock.calls[0][0].gameType).toBe(
      "Coilbox campaign c1",
    );
    expect(playLaunch).toHaveBeenCalledTimes(1);
    expect(result.current.leftOut).toEqual([
      "armlab is not in BA, so it does not build tank.",
    ]);
  });

  it("plays a scenario mission on top of the mutator", async () => {
    composeUnits.mockResolvedValue({
      name: "Coilbox campaign c1",
      leftOut: [],
    });
    const { campaign, mission } = withUnits(flat());
    const { result } = renderHook(() => useMissionRun(campaign, mission));

    await act(async () => {
      await result.current.start();
    });

    expect(launchScenario.mock.calls[0][0].unitsGame).toBe(
      "Coilbox campaign c1",
    );
  });

  it("shows why the mutator could not be written and launches nothing", async () => {
    composeUnits.mockRejectedValue(
      new Error("This campaign's copy of Tank is missing."),
    );
    const { campaign, mission } = withUnits();
    const { result } = renderHook(() => useMissionRun(campaign, mission));

    await act(async () => {
      await result.current.start();
    });

    expect(result.current.error).toBe(
      "This campaign's copy of Tank is missing.",
    );
    expect(playLaunch).not.toHaveBeenCalled();
  });

  it("launches as the game itself when no unit came back", async () => {
    const { campaign, mission } = withUnits();
    const { result } = renderHook(() => useMissionRun(campaign, mission));

    await act(async () => {
      await result.current.start();
    });

    expect(vi.mocked(toBattleConfig).mock.calls[0][0].gameType).toBe("BA");
  });
});

// Issue #4664. A game with its compatibility switch on plays over its mutator,
// and the campaign's units mutator depends on that mutator.
describe("a mission on a game with compatibility mode", () => {
  const USE = {
    kind: "use",
    gameType: "BA (compat 1)",
    gameArchive: "coilbox-compat-ba-1.sdd",
    baseName: "BA",
  };
  const tank = {
    unitName: "tank",
    projectId: "p-tank",
    name: "Tank",
    builtBy: ["armlab"],
    copiedAt: "",
  };

  async function start(withUnits: boolean, scenario = false) {
    const { campaign, mission } = campaignWith(flat());
    const played = scenario ? mission : { ...mission, scenario: undefined };
    const withUnitsCampaign = {
      ...campaign,
      ...(withUnits ? { units: [tank] } : {}),
      missions: [played],
    };
    const { result } = renderHook(() =>
      useMissionRun(withUnitsCampaign, played),
    );
    await act(async () => {
      await result.current.start();
    });
    return { result, campaign: withUnitsCampaign };
  }

  it("resolves the game the mission plays", async () => {
    await start(false);

    expect(resolveCompatTarget.mock.calls[0][0].game.name).toBe("BA");
  });

  it("launches a preset mission as the mutator and names the base game", async () => {
    resolveCompatTarget.mockResolvedValue(USE);
    await start(false);

    const config = vi.mocked(toBattleConfig).mock.calls[0][0];
    expect(config.gameType).toBe("BA (compat 1)");
    expect(config.compatBase).toBe("BA");
  });

  it("writes the units mutator over the compat mutator, not the game", async () => {
    resolveCompatTarget.mockResolvedValue(USE);
    composeUnits.mockResolvedValue({
      name: "Coilbox campaign c1",
      leftOut: [],
    });
    await start(true);

    expect(composeUnits.mock.calls[0][2]).toEqual({
      name: "BA (compat 1)",
      archive: "coilbox-compat-ba-1.sdd",
    });
    const config = vi.mocked(toBattleConfig).mock.calls[0][0];
    expect(config.gameType).toBe("Coilbox campaign c1");
    expect(config.compatBase).toBe("BA");
  });

  it("hands a scenario mission the mutator", async () => {
    resolveCompatTarget.mockResolvedValue(USE);
    await start(false, true);

    expect(launchScenario.mock.calls[0][0].compat).toEqual(USE);
  });

  it("launches the game itself and reads nothing more when the switch is off", async () => {
    composeUnits.mockResolvedValue({
      name: "Coilbox campaign c1",
      leftOut: [],
    });
    await start(true);

    expect(composeUnits.mock.calls[0][2]).toEqual({
      name: "BA",
      archive: "ba.sdz",
    });
    expect(
      vi.mocked(toBattleConfig).mock.calls[0][0].compatBase,
    ).toBeUndefined();
  });

  it.each([
    "its mutator has not been built.",
    "its mutator is out of date: the fixes changed.",
  ])("launches nothing and says why when %s", async (why) => {
    const message = `Compatibility mode is on for BA, but ${why} Open BA under Library > Games and choose Rebuild.`;
    resolveCompatTarget.mockResolvedValue({ kind: "blocked", message });
    const { result } = await start(true, true);

    expect(result.current.error).toBe(message);
    expect(composeUnits).not.toHaveBeenCalled();
    expect(launchScenario).not.toHaveBeenCalled();
    expect(playLaunch).not.toHaveBeenCalled();
  });
});

// Issue #4517. A copy that does not hold its atlas is read from the pack it was
// built from, so the gate asks for that pack the way it asks for a map.
describe("a campaign whose units need an atlas pack", () => {
  const camo = {
    unitName: "jeep",
    projectId: "p-jeep",
    name: "Jeep",
    builtBy: [],
    copiedAt: "",
  };

  function copyNeeding(files: string[]) {
    return new Map([
      [
        "jeep",
        {
          dir: "/app/campaign/units/c1/jeep",
          files,
          copy: {
            built: {
              payload: {
                textures: {
                  atlas: { name: "camo.png", pack: "camo-pack", writeAs: "x" },
                  stored: [],
                },
              },
            },
          },
        },
      ],
    ]);
  }

  function run() {
    const { campaign, mission } = campaignWith(flat());
    return renderHook(() =>
      useMissionRun({ ...campaign, units: [camo] }, mission),
    );
  }

  it("reports the pack as missing, like a map, and cannot start", async () => {
    loadUnitCopies.mockResolvedValue(copyNeeding([]));
    const { result } = run();

    await waitFor(() =>
      expect(result.current.missing).toEqual({
        kind: "atlas",
        name: "camo-pack",
      }),
    );
    expect(result.current.needs).toEqual([
      { kind: "atlas", name: "camo-pack" },
    ]);
    expect(result.current.canStart).toBe(false);
  });

  it("starts once the pack is installed", async () => {
    loadUnitCopies.mockResolvedValue(copyNeeding([]));
    installedAtlases.folders = ["camo-pack"];
    const { result } = run();

    await waitFor(() => expect(loadUnitCopies).toHaveBeenCalled());
    await act(async () => {});
    expect(result.current.needs).toEqual([]);
    expect(result.current.canStart).toBe(true);
  });

  it("asks for nothing when the copy carries its atlas", async () => {
    loadUnitCopies.mockResolvedValue(copyNeeding(["camo.png"]));
    const { result } = run();

    await waitFor(() => expect(loadUnitCopies).toHaveBeenCalled());
    await act(async () => {});
    expect(result.current.needs).toEqual([]);
    expect(result.current.canStart).toBe(true);
  });
});

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

const { launchScenario, progressState, saved } = vi.hoisted(() => ({
  launchScenario: vi.fn(),
  // The stored progress document each render starts from, set per test.
  progressState: { file: { schemaVersion: 1, campaigns: {} } as unknown },
  saved: [] as unknown[],
}));

vi.mock("../scenario/launch", () => ({ launchScenario }));

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
      games: [{ name: "BA", primaryArchive: { name: "ba.sdz" } }],
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
  gameOptionSchema: vi.fn(async () => []),
  mapOptionSchema: vi.fn(async () => []),
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
  usePlay: () => ({ running: false, launch: vi.fn() }),
}));

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

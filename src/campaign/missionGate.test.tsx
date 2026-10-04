// @vitest-environment happy-dom
/**
 * What stops a mission being played, and which of the two reasons it is
 * (issue #2245).
 *
 * A mission names the game and map it was authored on, and the briefing checks
 * both are installed by exact name. Nothing is installed under the empty name,
 * so a mission that names no map at all used to fail that check and be reported
 * as a missing install, with the offer of a download for a map called "". The
 * two cases are told apart here: a mission short of a name is unfinished, and
 * only a mission naming content the machine does not have is missing an install.
 *
 * The unfinished sentence is the campaign list's, so the list and the mission
 * cannot contradict each other. One test below pins them to each other rather
 * than to a copy of the words.
 *
 * No engine and no disk: the scan is a fixture, and nothing is launched.
 */

import { renderHook } from "@testing-library/react";
import { useCallback, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SkirmishDraft } from "../play/drafts";

const { scan, engine } = vi.hoisted(() => ({
  scan: {
    games: [{ name: "BA", primaryArchive: { name: "ba.sdz" } }],
    maps: [{ name: "Comet" }],
  },
  // The engine the preferred-target read finds, or none. Mutated by the tests
  // that install one, standing in for the read after a download.
  engine: {
    target: {
      enginePath: "/engine",
      dataDir: "/data",
      executable: "/engine/spring",
    } as unknown,
    // Set by the tests where the scan failed: the hook then answers
    // `data: null` with the engine's reason.
    scanError: null as string | null,
  },
}));

vi.mock("../scenario/launch", () => ({ launchScenario: vi.fn() }));

vi.mock("./scenarioMedia", () => ({
  ensureCampaignScenarioMedia: vi.fn(async () => {}),
}));

vi.mock("./campaigns", () => ({
  useCampaignProgress: () => {
    const [progress, setProgress] = useState({
      schemaVersion: 1,
      campaigns: {},
    } as unknown);
    const save = useCallback(async (next: unknown) => setProgress(next), []);
    return { progress, save, loading: false, error: null, refresh: vi.fn() };
  },
}));

vi.mock("../content/bindings", () => ({
  contentDemoInfo: vi.fn(),
  contentListReplays: vi.fn(async () => ({ replays: [] })),
}));

vi.mock("../content/config", () => ({
  primeScan: vi.fn(async () => ({ games: [] })),
  useUnitsyncScan: () => ({
    data: engine.target && !engine.scanError ? scan : null,
    error: engine.scanError,
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
    target: engine.target,
    loading: false,
    refresh: vi.fn(),
  }),
}));

vi.mock("../play/PlayProvider", () => ({
  usePlay: () => ({ running: false, launch: vi.fn() }),
}));

import { campaignUnplayableReason } from "./listing";
import type { Campaign, CampaignMission } from "./model";
import { useMissionRun } from "./run";

function missionOn(id: string, gameName: string, mapName: string) {
  return {
    id,
    title: `Mission ${id}`,
    briefing: "",
    objectives: [],
    snapshot: {
      gameName,
      mapName,
      participants: [],
      startPosType: 2,
      modOptionValues: {},
    } as unknown as SkirmishDraft,
    disabledUnits: [],
    skippable: false,
  } satisfies CampaignMission;
}

function campaignOf(...missions: CampaignMission[]): Campaign {
  return {
    schemaVersion: 1,
    id: "c1",
    type: "ta",
    title: "A Campaign",
    description: "",
    missions,
    createdAt: "",
    updatedAt: "",
  };
}

/** Open one mission of a campaign, as the briefing page does. */
function open(campaign: Campaign, mission: CampaignMission) {
  return renderHook(() => useMissionRun(campaign, mission)).result.current;
}

describe("a mission that was never finished", () => {
  it("is not reported as a map that needs downloading", () => {
    const mission = missionOn("m1", "BA", "");

    const run = open(campaignOf(mission), mission);

    expect(run.missing).toBeNull();
    expect(run.unfinished).toBe("Mission 1 has no map");
  });

  // The same hole, from the same exact-name check: no game is installed under
  // the empty name either, so an unnamed game read as one that is not installed.
  it("is not reported as a game that needs downloading", () => {
    const mission = missionOn("m1", "", "Comet");

    const run = open(campaignOf(mission), mission);

    expect(run.missing).toBeNull();
    expect(run.unfinished).toBe("Mission 1 has no game");
  });

  it("names both when it names neither", () => {
    const mission = missionOn("m1", "", "");

    expect(open(campaignOf(mission), mission).unfinished).toBe(
      "Mission 1 has no game or map",
    );
  });

  it("cannot be started", () => {
    const mission = missionOn("m1", "BA", "");

    expect(open(campaignOf(mission), mission).canStart).toBe(false);
  });

  /**
   * The campaign list says "Mission 3 has no map" about the same mission, and a
   * player who read that there and something else here would be right to think
   * one of the two screens is wrong. Pinned to the list's own function rather
   * than to a second copy of the sentence.
   */
  it("says what the campaign list says about it", () => {
    const broken = missionOn("m3", "BA", "");
    const campaign = campaignOf(
      missionOn("m1", "BA", "Comet"),
      missionOn("m2", "BA", "Comet"),
      broken,
    );

    const run = open(campaign, broken);

    expect(run.unfinished).toBe("Mission 3 has no map");
    expect(run.unfinished).toBe(campaignUnplayableReason(campaign));
  });
});

describe("a mission naming content that is not installed", () => {
  it("still asks for the download", () => {
    const mission = missionOn("m1", "BA", "Delta");

    const run = open(campaignOf(mission), mission);

    expect(run.unfinished).toBeNull();
    expect(run.missing).toEqual({ kind: "map", name: "Delta" });
  });

  it("asks for the game when that is what is absent", () => {
    const mission = missionOn("m1", "XTA", "Comet");

    expect(open(campaignOf(mission), mission).missing).toEqual({
      kind: "game",
      name: "XTA",
    });
  });
});

describe("a mission naming installed content", () => {
  it("gates on nothing and can be started", () => {
    const mission = missionOn("m1", "BA", "Comet");

    const run = open(campaignOf(mission), mission);

    expect(run.missing).toBeNull();
    expect(run.unfinished).toBeNull();
    expect(run.canStart).toBe(true);
  });
});

describe("what the briefing offers to download", () => {
  const baseGames = [{ name: "BA", primaryArchive: { name: "ba.sdz" } }];
  const target = {
    enginePath: "/engine",
    dataDir: "/data",
    executable: "/engine/spring",
  };
  afterEach(() => {
    scan.games = [...baseGames];
    scan.maps = [{ name: "Comet" }];
    engine.target = target;
  });

  it("lists the game and the map together when both are short", () => {
    const mission = missionOn("m1", "XTA", "Delta");

    expect(open(campaignOf(mission), mission).needs).toEqual([
      { kind: "game", name: "XTA" },
      { kind: "map", name: "Delta" },
    ]);
  });

  it("lists only the engine on a machine with none", () => {
    engine.target = null;
    const mission = missionOn("m1", "XTA", "Delta");

    const run = open(campaignOf(mission), mission);

    expect(run.noEngine).toBe(true);
    expect(run.needs).toEqual([{ kind: "engine", name: "" }]);
    expect(run.canStart).toBe(false);
  });

  it("lists nothing for a mission that was never finished", () => {
    const mission = missionOn("m1", "BA", "");

    expect(open(campaignOf(mission), mission).needs).toEqual([]);
  });

  it("becomes playable once the game is installed, with no reload", () => {
    const mission = missionOn("m1", "XTA", "Comet");
    const campaign = campaignOf(mission);
    const hook = renderHook(() => useMissionRun(campaign, mission));
    expect(hook.result.current.needs).toEqual([{ kind: "game", name: "XTA" }]);
    expect(hook.result.current.canStart).toBe(false);

    // What the rescan after the download reads.
    scan.games = [...baseGames, { name: "XTA", primaryArchive: { name: "x" } }];
    hook.rerender();

    expect(hook.result.current.needs).toEqual([]);
    expect(hook.result.current.canStart).toBe(true);
  });

  it("moves from the engine to the game once an engine is installed", () => {
    engine.target = null;
    const mission = missionOn("m1", "XTA", "Comet");
    const campaign = campaignOf(mission);
    const hook = renderHook(() => useMissionRun(campaign, mission));
    expect(hook.result.current.needs).toEqual([{ kind: "engine", name: "" }]);

    engine.target = target;
    hook.rerender();

    expect(hook.result.current.needs).toEqual([{ kind: "game", name: "XTA" }]);
  });
});

describe("a mission when the content scan failed", () => {
  afterEach(() => {
    engine.scanError = null;
  });

  it("cannot be started, and says why instead of asking for a download", () => {
    engine.scanError = "no space left on device";
    const mission = missionOn("m1", "BA", "Comet");

    const run = open(campaignOf(mission), mission);

    expect(run.canStart).toBe(false);
    expect(run.missing).toBeNull();
    expect(run.needs).toEqual([]);
    expect(run.scanLoading).toBe(false);
    expect(run.scanError).toBe("no space left on device");
  });

  it("has no scan error when the scan answered", () => {
    const mission = missionOn("m1", "BA", "Comet");

    expect(open(campaignOf(mission), mission).scanError).toBeNull();
  });
});

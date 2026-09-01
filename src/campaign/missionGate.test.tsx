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
import { describe, expect, it, vi } from "vitest";
import type { SkirmishDraft } from "../play/drafts";

const { scan } = vi.hoisted(() => ({
  scan: {
    games: [{ name: "BA", primaryArchive: { name: "ba.sdz" } }],
    maps: [{ name: "Comet" }],
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
  useUnitsyncScan: () => ({ data: scan, loading: false, run: vi.fn() }),
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

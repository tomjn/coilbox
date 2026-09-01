import { describe, expect, it } from "vitest";
import type { Campaign, CampaignMission, ProgressFile } from "./model";
import {
  applyDefeat,
  applyVictory,
  chooseDifficulty,
  nextAvailableMission,
  runDifficulty,
} from "./results";

function mission(id: string, skippable = false): CampaignMission {
  return {
    id,
    title: id,
    briefing: "",
    objectives: [],
    snapshot: {} as CampaignMission["snapshot"],
    disabledUnits: [],
    skippable,
  };
}

function campaign(missions: CampaignMission[]): Campaign {
  return {
    schemaVersion: 1,
    id: "c",
    type: "ta",
    title: "C",
    description: "",
    missions,
    createdAt: "",
    updatedAt: "",
  };
}

const empty: ProgressFile = { schemaVersion: 1, campaigns: {} };
const NOW = "2026-07-04T00:00:00.000Z";

describe("applyVictory", () => {
  it("adds the mission to a fresh campaign entry and marks it last-played", () => {
    const next = applyVictory(empty, "c", "a", NOW);
    expect(next.campaigns.c).toEqual({
      completedMissionIds: ["a"],
      lastPlayedMissionId: "a",
      updatedAt: NOW,
    });
  });

  it("dedupes an already-completed mission", () => {
    const file: ProgressFile = {
      schemaVersion: 1,
      campaigns: { c: { completedMissionIds: ["a"], updatedAt: "" } },
    };
    const next = applyVictory(file, "c", "a", NOW);
    expect(next.campaigns.c.completedMissionIds).toEqual(["a"]);
    expect(next.campaigns.c.lastPlayedMissionId).toBe("a");
  });

  it("appends a new win without touching earlier completions", () => {
    const file: ProgressFile = {
      schemaVersion: 1,
      campaigns: { c: { completedMissionIds: ["a"], updatedAt: "" } },
    };
    const next = applyVictory(file, "c", "b", NOW);
    expect(next.campaigns.c.completedMissionIds).toEqual(["a", "b"]);
  });

  it("does not mutate the input document", () => {
    const file: ProgressFile = {
      schemaVersion: 1,
      campaigns: { c: { completedMissionIds: ["a"], updatedAt: "" } },
    };
    applyVictory(file, "c", "b", NOW);
    expect(file.campaigns.c.completedMissionIds).toEqual(["a"]);
  });
});

describe("applyDefeat", () => {
  it("records last-played without changing completions", () => {
    const file: ProgressFile = {
      schemaVersion: 1,
      campaigns: { c: { completedMissionIds: ["a"], updatedAt: "" } },
    };
    const next = applyDefeat(file, "c", "b", NOW);
    expect(next.campaigns.c).toEqual({
      completedMissionIds: ["a"],
      lastPlayedMissionId: "b",
      updatedAt: NOW,
    });
  });

  it("creates an empty entry for a never-played campaign", () => {
    const next = applyDefeat(empty, "c", "a", NOW);
    expect(next.campaigns.c).toEqual({
      completedMissionIds: [],
      lastPlayedMissionId: "a",
      updatedAt: NOW,
    });
  });
});

/** Issue #2220. The difficulty belongs to the run, so progress is where it lives. */
describe("the run's difficulty", () => {
  const easyRun: ProgressFile = {
    schemaVersion: 1,
    campaigns: {
      c: { completedMissionIds: ["a"], difficulty: "easy", updatedAt: "" },
    },
  };

  it("is nothing for a run nobody has set one on", () => {
    expect(runDifficulty(empty, "c")).toBeUndefined();
    expect(
      runDifficulty(applyVictory(empty, "c", "a", NOW), "c"),
    ).toBeUndefined();
  });

  it("is the level the run recorded", () => {
    expect(runDifficulty(easyRun, "c")).toBe("easy");
  });

  // Progress is opaque JSON read back without validation, so a level this build
  // cannot rank has to read as no choice rather than reach the engine.
  it("is nothing for a level this build cannot rank", () => {
    const file = {
      schemaVersion: 1,
      campaigns: {
        c: { completedMissionIds: [], difficulty: "nightmare", updatedAt: "" },
      },
    } as unknown as ProgressFile;

    expect(runDifficulty(file, "c")).toBeUndefined();
  });

  it("records a choice on a campaign that has never been played", () => {
    const next = chooseDifficulty(empty, "c", "hard", NOW);

    expect(next.campaigns.c).toEqual({
      completedMissionIds: [],
      difficulty: "hard",
      updatedAt: NOW,
    });
  });

  // A player who finds mission 4 too hard drops the level mid-run. What they
  // already beat, they beat.
  it("changes the level without disturbing what was already won", () => {
    const next = chooseDifficulty(easyRun, "c", "hard", NOW);

    expect(next.campaigns.c.difficulty).toBe("hard");
    expect(next.campaigns.c.completedMissionIds).toEqual(["a"]);
  });

  it("survives a win and a loss", () => {
    expect(applyVictory(easyRun, "c", "b", NOW).campaigns.c.difficulty).toBe(
      "easy",
    );
    expect(applyDefeat(easyRun, "c", "b", NOW).campaigns.c.difficulty).toBe(
      "easy",
    );
  });

  it("does not mutate the input document", () => {
    chooseDifficulty(easyRun, "c", "hard", NOW);

    expect(easyRun.campaigns.c.difficulty).toBe("easy");
  });
});

describe("nextAvailableMission", () => {
  it("returns the mission unlocked by a win", () => {
    const c = campaign([mission("a"), mission("b"), mission("c")]);
    const after = applyVictory(empty, "c", "a", NOW).campaigns.c;
    const next = nextAvailableMission(c, after, "a");
    expect(next?.id).toBe("b");
  });

  it("returns null after the last mission (campaign complete)", () => {
    const c = campaign([mission("a"), mission("b")]);
    const after = applyVictory(
      applyVictory(empty, "c", "a", NOW),
      "c",
      "b",
      NOW,
    ).campaigns.c;
    expect(nextAvailableMission(c, after, "b")).toBeNull();
  });

  it("only looks forward in play order", () => {
    // b is skippable so it stays available; after winning c, the next available
    // mission later in order is none (b is earlier), so campaign continues past c.
    const c = campaign([mission("a"), mission("b", true), mission("c", true)]);
    const after = applyVictory(empty, "c", "c", NOW).campaigns.c;
    // Nothing after index 2 -> null.
    expect(nextAvailableMission(c, after, "c")).toBeNull();
  });
});

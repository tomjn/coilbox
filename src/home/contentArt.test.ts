import { beforeEach, describe, expect, it, vi } from "vitest";

// The hook half of `contentArt` reaches @picoframe/frame and, through the content
// bindings, @picoframe/plugin-sdk. Both published dists use extensionless relative
// imports Vitest's node resolver will not load, so the leaves are stubbed to let
// the module import at all. Same pattern as `multiplayer/channels.test.ts`. Only
// `unitsyncMinimap` is stubbed with behaviour, because `resolvePicks` calls it.
vi.mock("@picoframe/frame", () => ({
  useSetting: () => [{}, () => {}],
  useFrame: () => ({ nav: [] }),
}));
vi.mock("@picoframe/plugin-sdk", () => ({
  defineCommand: () => async () => ({}),
  onSidecarProgress: () => () => {},
}));
vi.mock("../content/bindings", () => ({ unitsyncMinimap: vi.fn() }));
// The lobby store the resume collector reads attaches window listeners at module
// top level, and the node environment has no window. Same stubs as
// `continue.test.ts`, for the same reason.
vi.mock("../multiplayer/ringEffect", () => ({ triggerRing: () => {} }));
vi.mock("../multiplayer/ingameCue", () => ({ triggerIngameCue: () => {} }));
vi.mock("../multiplayer/chat/mentionCue", () => ({
  triggerMentionCue: () => {},
}));

import type { Campaign, CampaignMission, ProgressFile } from "../campaign/model";
import { unitsyncMinimap } from "../content/bindings";
import type { RogueliteRun } from "../runlite/model";
import { resolveCardArt } from "./art";
import { warpathCandidate } from "./continue";
import {
  campaignPick,
  contentCardArt,
  type ContentPick,
  contentPicks,
  gamePick,
  picksKey,
  publishContentArt,
  replayPick,
  resetContentArt,
  resumeRunId,
  scenarioPick,
  skirmishPick,
  warpathPick,
} from "./contentArt";
import { resetResolvedMinimaps, resolvePicks } from "./useContentCardArt";

/* -------------------------------------------------------------------------- *
 * Fixtures, shaped from the real files on a machine that has played each mode.
 * -------------------------------------------------------------------------- */

const emptyDraft = { gameName: "", mapName: "" };

function mission(over: Partial<CampaignMission> = {}): CampaignMission {
  return {
    id: "m1",
    title: "Scene smoke test",
    snapshot: {
      participants: [],
      gameName: "Balanced Annihilation V15.9.8",
      mapName: "Bismuth Valley v2.4.1",
      startPosType: 0,
      modOptionValues: {},
    },
    ...over,
  } as CampaignMission;
}

function campaign(over: Partial<Campaign> = {}): Campaign {
  return {
    schemaVersion: 1,
    id: "c1",
    title: "Scenario result check 770",
    missions: [mission()],
    ...over,
  } as Campaign;
}

function progressFile(
  campaigns: ProgressFile["campaigns"] = {},
): ProgressFile {
  return { schemaVersion: 1, campaigns };
}

/** A run whose current node is `start`, which is where a fresh run sits. */
function run(over: Partial<RogueliteRun> = {}): RogueliteRun {
  return {
    schemaVersion: 1,
    type: "roguelite-run",
    name: "Fractured Fringe",
    settings: {
      seed: 1,
      length: "short",
      difficulty: "normal",
      ascension: 0,
      game: { name: "g", shortname: "g" },
      factionId: "f",
      skin: "galaxy",
    },
    nodes: [
      { id: "start", type: "start", col: 0, row: 0 },
      {
        id: "c1n0",
        type: "battle",
        col: 1,
        row: 0,
        battle: { mapName: "Altair_Crossing_V4.1", enemyAiCount: 1, handicap: 0, techTier: 1 },
      },
      { id: "c1n1", type: "shop", col: 1, row: 1 },
      {
        id: "c2n0",
        type: "battle",
        col: 2,
        row: 0,
        battle: { mapName: "Mithril Mountain v2.0.1", enemyAiCount: 1, handicap: 0, techTier: 1 },
      },
    ],
    edges: [
      ["start", "c1n0"],
      ["start", "c1n1"],
      ["c1n0", "c2n0"],
      ["c1n1", "c2n0"],
    ],
    progress: {
      currentNodeId: "start",
      visited: ["start"],
      hull: 10,
      maxHull: 10,
      salvage: 0,
      unlockedUnits: [],
      perks: [],
      status: "active",
    },
    history: [],
    createdAt: "2026-07-30T13:16:39.105Z",
    updatedAt: "2026-07-30T13:16:39.105Z",
    ...over,
  } as RogueliteRun;
}

/* -------------------------------------------------------------------------- *
 * Which content each tool shows.
 * -------------------------------------------------------------------------- */

describe("skirmishPick", () => {
  it("shows the map your saved setup is pointed at", () => {
    expect(
      skirmishPick({ gameName: "Metal Factions v2.58", mapName: "Valles Marineris 2.6.1" }),
    ).toEqual({ kind: "map", mapName: "Valles Marineris 2.6.1" });
  });

  it("answers nothing on a setup with no map", () => {
    expect(skirmishPick(emptyDraft)).toBeUndefined();
  });
});

describe("gamePick", () => {
  it("shows the game your saved setup is pointed at", () => {
    expect(
      gamePick({ gameName: "Metal Factions v2.58", mapName: "Valles Marineris 2.6.1" }),
    ).toEqual({ kind: "game", gameName: "Metal Factions v2.58" });
  });

  it("answers nothing on a setup with no game", () => {
    expect(gamePick(emptyDraft)).toBeUndefined();
  });
});

describe("replayPick", () => {
  it("shows the map of the newest replay", () => {
    expect(
      replayPick([
        { mapName: "Valles Marineris 2.6.1" },
        { mapName: "Greenhaven BAR v1.2" },
      ]),
    ).toEqual({ kind: "map", mapName: "Valles Marineris 2.6.1" });
  });

  it("skips a replay whose header gave no map", () => {
    expect(replayPick([{}, { mapName: "Greenhaven BAR v1.2" }])).toEqual({
      kind: "map",
      mapName: "Greenhaven BAR v1.2",
    });
  });

  it("answers nothing on an install with no replays", () => {
    expect(replayPick([])).toBeUndefined();
  });
});

describe("campaignPick", () => {
  it("shows the map of the mission you last played", () => {
    const progress = progressFile({
      c1: {
        completedMissionIds: ["m1"],
        lastPlayedMissionId: "m1",
        updatedAt: "2026-08-01T09:32:25.999Z",
      },
    });
    expect(campaignPick([{ campaign: campaign() }], progress)).toEqual({
      kind: "map",
      mapName: "Bismuth Valley v2.4.1",
    });
  });

  it("still answers once every mission is complete", () => {
    // The install this was written against has exactly this shape, and it is why
    // the pick reads `lastPlayedMissionId` rather than going through the resume
    // collector, which has nothing to offer a finished campaign.
    const finished = progressFile({
      c1: {
        completedMissionIds: ["m1"],
        lastPlayedMissionId: "m1",
        updatedAt: "2026-08-01T09:32:25.999Z",
      },
    });
    expect(campaignPick([{ campaign: campaign() }], finished)).toBeDefined();
  });

  it("prefers the campaign touched most recently", () => {
    const older = campaign({
      id: "c0",
      missions: [mission({ id: "m0", snapshot: { ...mission().snapshot, mapName: "Old Map" } })],
    });
    const progress = progressFile({
      c0: { completedMissionIds: [], lastPlayedMissionId: "m0", updatedAt: "2026-01-01T00:00:00Z" },
      c1: { completedMissionIds: [], lastPlayedMissionId: "m1", updatedAt: "2026-08-01T00:00:00Z" },
    });
    expect(campaignPick([{ campaign: older }, { campaign: campaign() }], progress)).toEqual({
      kind: "map",
      mapName: "Bismuth Valley v2.4.1",
    });
  });

  it("drops a campaign with an unreadable timestamp", () => {
    const progress = progressFile({
      c1: { completedMissionIds: [], lastPlayedMissionId: "m1", updatedAt: "" },
    });
    expect(campaignPick([{ campaign: campaign() }], progress)).toBeUndefined();
  });

  it("answers nothing for a campaign you have never opened", () => {
    expect(campaignPick([{ campaign: campaign() }], progressFile())).toBeUndefined();
  });

  it("answers nothing when the played mission names no map", () => {
    const noMap = campaign({
      missions: [mission({ snapshot: { ...mission().snapshot, mapName: "" } })],
    });
    const progress = progressFile({
      c1: { completedMissionIds: [], lastPlayedMissionId: "m1", updatedAt: "2026-08-01T00:00:00Z" },
    });
    expect(campaignPick([{ campaign: noMap }], progress)).toBeUndefined();
  });
});

describe("scenarioPick", () => {
  it("shows the map of the scenario you edited most recently", () => {
    expect(
      scenarioPick([
        { scenario: { setup: { mapName: "Bismuth Valley v2.4.1" } } },
        { scenario: { setup: { mapName: "AcidicQuarry 5.17" } } },
      ]),
    ).toEqual({ kind: "map", mapName: "Bismuth Valley v2.4.1" });
  });

  it("answers nothing on an install with no scenarios", () => {
    expect(scenarioPick([])).toBeUndefined();
  });
});

describe("warpathPick", () => {
  it("shows the fight an edge leads to, not the node you stand on", () => {
    const r = run();
    // The real install's every active run sits on `start`, which has no map, so
    // a current-node rule would leave this card artless for the whole run.
    expect(r.nodes[0].battle).toBeUndefined();
    expect(warpathPick({ "run-1": r }, "run-1")).toEqual({
      kind: "map",
      mapName: "Altair_Crossing_V4.1",
    });
  });

  it("looks ahead when every exit is a shop", () => {
    const r = run({
      progress: { ...run().progress, currentNodeId: "c1n1", visited: ["start", "c1n1"] },
      edges: [["c1n1", "c1n1"]],
    });
    expect(warpathPick({ "run-1": r }, "run-1")).toEqual({
      kind: "map",
      mapName: "Altair_Crossing_V4.1",
    });
  });

  it("answers nothing when the collector picked no run", () => {
    expect(warpathPick({ "run-1": run() }, undefined)).toBeUndefined();
  });

  it("answers nothing when the picked run has gone", () => {
    expect(warpathPick({}, "run-1")).toBeUndefined();
  });
});

describe("resumeRunId", () => {
  it("recovers the run the resume collector picked", () => {
    // Pinned against the collector itself: if `warpathCandidate` ever changes
    // the id it builds, this fails here rather than blanking the card silently.
    const runs = {
      "run-old": { ...runSummary(), updatedAt: "2026-07-01T00:00:00Z" },
      "run-new": { ...runSummary(), updatedAt: "2026-07-30T00:00:00Z" },
    };
    const candidate = warpathCandidate(runs);
    expect(candidate).toBeDefined();
    expect(resumeRunId(candidate ? [candidate] : [])).toBe("run-new");
  });

  it("answers nothing when there is no Warpath candidate", () => {
    expect(resumeRunId([{ kind: "campaign", id: "campaign:c1" }])).toBeUndefined();
  });
});

function runSummary() {
  return {
    name: "Fractured Fringe",
    updatedAt: "2026-07-30T00:00:00Z",
    settings: { game: { shortname: "BA" } },
    progress: { status: "active" as const, hull: 10, maxHull: 10 },
  };
}

describe("contentPicks", () => {
  const populated = {
    draft: { gameName: "Metal Factions v2.58", mapName: "Valles Marineris 2.6.1" },
    replays: [{ mapName: "Valles Marineris 2.6.1" }],
    campaigns: [{ campaign: campaign() }],
    progress: progressFile({
      c1: {
        completedMissionIds: ["m1"],
        lastPlayedMissionId: "m1",
        updatedAt: "2026-08-01T09:32:25.999Z",
      },
    }),
    scenarios: [{ scenario: { setup: { mapName: "AcidicQuarry 5.17" } } }],
    runs: { "run-1": run() },
    resumeRunId: "run-1",
  };

  it("covers the six tools it claims", () => {
    expect([...contentPicks(populated).keys()].sort()).toEqual([
      "campaign.list",
      "content.games",
      "play.replays",
      "play.skirmish",
      "runlite.list",
      "scenario.list",
    ]);
  });

  it("leaves the same map on two cards rather than inventing a second-best", () => {
    const picks = contentPicks(populated);
    expect(picks.get("play.skirmish")).toEqual(picks.get("play.replays"));
  });

  it("contributes nothing at all on a fresh install", () => {
    expect(
      contentPicks({
        draft: emptyDraft,
        replays: [],
        campaigns: [],
        progress: progressFile(),
        scenarios: [],
        runs: {},
      }).size,
    ).toBe(0);
  });

  it("drops only the sources that are missing", () => {
    const picks = contentPicks({ ...populated, replays: [], runs: {} });
    expect(picks.has("play.replays")).toBe(false);
    expect(picks.has("runlite.list")).toBe(false);
    expect(picks.has("play.skirmish")).toBe(true);
  });
});

describe("picksKey", () => {
  it("changes when a pick changes and not when the Map is rebuilt", () => {
    const a = contentPicks({
      draft: { gameName: "g", mapName: "Map A" },
      replays: [],
      campaigns: [],
      progress: progressFile(),
      scenarios: [],
      runs: {},
    });
    const same = contentPicks({
      draft: { gameName: "g", mapName: "Map A" },
      replays: [],
      campaigns: [],
      progress: progressFile(),
      scenarios: [],
      runs: {},
    });
    const b = contentPicks({
      draft: { gameName: "g", mapName: "Map B" },
      replays: [],
      campaigns: [],
      progress: progressFile(),
      scenarios: [],
      runs: {},
    });
    expect(picksKey(a)).toBe(picksKey(same));
    expect(picksKey(a)).not.toBe(picksKey(b));
  });
});

/* -------------------------------------------------------------------------- *
 * The cache the synchronous source reads.
 * -------------------------------------------------------------------------- */

describe("contentCardArt", () => {
  it("answers nothing before the cache is warm", () => {
    resetContentArt();
    expect(contentCardArt({ toolId: "play.skirmish", themeColor: "#fff" })).toBeUndefined();
  });

  it("answers the published URL once warm, and only for tools it has", () => {
    resetContentArt();
    publishContentArt(new Map([["play.skirmish", "coilbox://localhost/unitsyncthumb/a-3.png"]]));
    expect(contentCardArt({ toolId: "play.skirmish", themeColor: "#fff" })).toBe(
      "coilbox://localhost/unitsyncthumb/a-3.png",
    );
    expect(contentCardArt({ toolId: "conquest.list", themeColor: "#fff" })).toBeUndefined();
  });

  it("falls through to a lower step while cold, and wins once warm", () => {
    resetContentArt();
    const cold = resolveCardArt("play.skirmish", "#3b82f6");
    expect(cold.source).not.toBe("content");

    publishContentArt(new Map([["play.skirmish", "coilbox://localhost/unitsyncthumb/a-3.png"]]));
    expect(resolveCardArt("play.skirmish", "#3b82f6")).toEqual({
      kind: "art",
      url: "coilbox://localhost/unitsyncthumb/a-3.png",
      source: "content",
    });
    resetContentArt();
  });
});

describe("publishContentArt", () => {
  it("does not wake subscribers when the answer has not changed", () => {
    // The effect that publishes runs after the render it caused, so republishing
    // the same map has to be a no-op or the home page loops.
    resetContentArt();
    const first = new Map([["play.skirmish", "coilbox://x"]]);
    publishContentArt(first);
    const before = contentCardArt({ toolId: "play.skirmish", themeColor: "#fff" });
    publishContentArt(new Map([["play.skirmish", "coilbox://x"]]));
    expect(contentCardArt({ toolId: "play.skirmish", themeColor: "#fff" })).toBe(before);
    resetContentArt();
  });
});

/* -------------------------------------------------------------------------- *
 * Resolving picks to URLs.
 * -------------------------------------------------------------------------- */

const minimap = vi.mocked(unitsyncMinimap);

function mapPicks(entries: [string, string][]): Map<string, ContentPick> {
  return new Map(
    entries.map(([tool, mapName]) => [tool, { kind: "map", mapName }]),
  );
}

/**
 * Parse a URL the way `src-tauri/src/asset_protocol.rs` does.
 *
 * A transcription of its `safe_segments`: split the path on `/`, drop empty
 * pieces, percent-decode each one, and reject the request outright if a decoded
 * segment is `.`, `..`, empty, or still holds a separator. Kept as a test double
 * rather than trusted, because a URL that this rejects is a card that shows
 * nothing in the running app and nothing at all in a unit test.
 */
function parseLikeProtocol(url: string): string[] | null {
  const path = url.replace(/^coilbox:\/\/localhost/, "");
  const out: string[] = [];
  for (const raw of path.split("/")) {
    if (raw === "") continue;
    let decoded: string;
    try {
      decoded = decodeURIComponent(raw);
    } catch {
      return null;
    }
    if (
      decoded === "." ||
      decoded === ".." ||
      decoded === "" ||
      decoded.includes("/") ||
      decoded.includes("\\")
    ) {
      return null;
    }
    out.push(decoded);
  }
  return out.length ? out : null;
}

describe("resolvePicks", () => {
  beforeEach(() => {
    minimap.mockReset();
    resetResolvedMinimaps();
    resetContentArt();
  });

  it("turns a cached render into a coilbox:// URL the protocol can parse", async () => {
    minimap.mockResolvedValue({
      file: "n1a2b3-3.png",
      startPositions: [],
      errors: [],
    });
    const out = await resolvePicks(
      mapPicks([["play.skirmish", "Valles Marineris 2.6.1"]]),
      "/engine",
      "/root",
      new Map(),
    );
    expect(out.get("play.skirmish")).toBe(
      "coilbox://localhost/unitsyncthumb/n1a2b3-3.png",
    );
    expect(parseLikeProtocol(out.get("play.skirmish") ?? "")).toEqual([
      "unitsyncthumb",
      "n1a2b3-3.png",
    ]);
  });

  it("escapes a cache name so the protocol decodes it back unchanged", async () => {
    // The worker only ever names a file `<hash>-<mip>.png`, but the URL builder
    // is the seam where that assumption would break silently, so a name with a
    // space and a non-ASCII character is round-tripped through the handler's own
    // parsing rules rather than eyeballed.
    for (const file of ["a b-3.png", "Ünïcode-3.png", "100%-3.png"]) {
      minimap.mockResolvedValue({ file, startPositions: [], errors: [] });
      resetResolvedMinimaps();
      const out = await resolvePicks(
        mapPicks([["play.skirmish", "M"]]),
        "/engine",
        "/root",
        new Map(),
      );
      expect(parseLikeProtocol(out.get("play.skirmish") ?? "")).toEqual([
        "unitsyncthumb",
        file,
      ]);
    }
  });

  it("renders a map shared by two cards once", async () => {
    minimap.mockResolvedValue({
      file: "shared-3.png",
      startPositions: [],
      errors: [],
    });
    const out = await resolvePicks(
      mapPicks([
        ["play.skirmish", "Valles Marineris 2.6.1"],
        ["play.replays", "Valles Marineris 2.6.1"],
      ]),
      "/engine",
      "/root",
      new Map(),
    );
    expect(minimap).toHaveBeenCalledTimes(1);
    expect(out.get("play.skirmish")).toBe(out.get("play.replays"));
  });

  it("leaves a map that will not render out of the result", async () => {
    minimap.mockResolvedValue({ startPositions: [], errors: ["archive missing"] });
    const out = await resolvePicks(
      mapPicks([["play.skirmish", "Not Installed"]]),
      "/engine",
      "/root",
      new Map(),
    );
    expect(out.has("play.skirmish")).toBe(false);
  });

  it("leaves a map out when the worker throws, and does not retry it", async () => {
    minimap.mockRejectedValue(new Error("worker died"));
    const args = [mapPicks([["play.skirmish", "Broken"]]), "/engine", "/root", new Map()] as const;
    expect((await resolvePicks(...args)).has("play.skirmish")).toBe(false);
    expect((await resolvePicks(...args)).has("play.skirmish")).toBe(false);
    expect(minimap).toHaveBeenCalledTimes(1);
  });

  it("takes a game's header art from the batch the Games grid already fetched", async () => {
    const out = await resolvePicks(
      new Map([["content.games", { kind: "game", gameName: "Metal Factions v2.58" }]]),
      "/engine",
      "/root",
      new Map([["Metal Factions v2.58", "coilbox://localhost/unitsyncheader/h-1.jpg"]]),
    );
    expect(out.get("content.games")).toBe("coilbox://localhost/unitsyncheader/h-1.jpg");
  });

  it("leaves a game with no header art out of the result", async () => {
    const out = await resolvePicks(
      new Map([["content.games", { kind: "game", gameName: "No Art" }]]),
      "/engine",
      "/root",
      new Map(),
    );
    expect(out.has("content.games")).toBe(false);
  });

  it("falls back to an inline render that never reached the cache", async () => {
    minimap.mockResolvedValue({
      dataUrl: "data:image/png;base64,AAAA",
      startPositions: [],
      errors: [],
    });
    const out = await resolvePicks(
      mapPicks([["play.skirmish", "Uncached"]]),
      "/engine",
      "/root",
      new Map(),
    );
    expect(out.get("play.skirmish")).toBe("data:image/png;base64,AAAA");
  });
});

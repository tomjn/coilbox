import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

import type {
  Campaign,
  CampaignMission,
  ProgressFile,
} from "../campaign/model";
import { unitsyncMinimap } from "../content/bindings";
import { resolveCardArt } from "./art";
import {
  assignPicks,
  type ContentPick,
  campaignPick,
  collectionPicks,
  contentArtStorageKey,
  contentArtVersion,
  contentCardArt,
  contentOffers,
  contentPicks,
  decodeRemembered,
  encodeRemembered,
  forgetContentArt,
  gamePick,
  loadContentArt,
  PICK_PRIORITY,
  picksKey,
  pruneRemembered,
  publishContentArt,
  type RememberedArt,
  rememberContentArt,
  rememberedContentArt,
  rememberedFrom,
  replayPick,
  resetContentArt,
  scenarioPick,
  skirmishPick,
  subscribeContentArt,
  validateRememberedArt,
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

function progressFile(campaigns: ProgressFile["campaigns"] = {}): ProgressFile {
  return { schemaVersion: 1, campaigns };
}

/** An install with nothing scanned, for the picks that do not read a collection. */
const noCollections = { maps: [], games: [] };

/** Every ordering of a list, for asserting a result does not depend on one. */
function permutations<T>(items: readonly T[]): T[][] {
  if (items.length <= 1) return [[...items]];
  return items.flatMap((item, i) =>
    permutations([...items.slice(0, i), ...items.slice(i + 1)]).map((rest) => [
      item,
      ...rest,
    ]),
  );
}

/* -------------------------------------------------------------------------- *
 * Which content each tool shows.
 * -------------------------------------------------------------------------- */

describe("skirmishPick", () => {
  it("shows the map your saved setup is pointed at", () => {
    expect(
      skirmishPick({
        gameName: "Metal Factions v2.58",
        mapName: "Valles Marineris 2.6.1",
      }),
    ).toEqual({ kind: "map", mapName: "Valles Marineris 2.6.1" });
  });

  it("answers nothing on a setup with no map", () => {
    expect(skirmishPick(emptyDraft)).toBeUndefined();
  });
});

describe("gamePick", () => {
  it("shows the game your saved setup is pointed at", () => {
    expect(
      gamePick({
        gameName: "Metal Factions v2.58",
        mapName: "Valles Marineris 2.6.1",
      }),
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

  it("prefers the campaign touched most recently, whichever order it is in", () => {
    // Asserted both ways round. With only one order, a pick that ignored the
    // timestamps entirely and took the last campaign in the list would still
    // give the right answer, and the test would pass with the rule gone.
    const older = campaign({
      id: "c0",
      missions: [
        mission({
          id: "m0",
          snapshot: { ...mission().snapshot, mapName: "Old Map" },
        }),
      ],
    });
    const recent = campaign();
    const progress = progressFile({
      c0: {
        completedMissionIds: [],
        lastPlayedMissionId: "m0",
        updatedAt: "2026-01-01T00:00:00Z",
      },
      c1: {
        completedMissionIds: [],
        lastPlayedMissionId: "m1",
        updatedAt: "2026-08-01T00:00:00Z",
      },
    });
    const expected = { kind: "map", mapName: "Bismuth Valley v2.4.1" };
    expect(
      campaignPick([{ campaign: older }, { campaign: recent }], progress),
    ).toEqual(expected);
    expect(
      campaignPick([{ campaign: recent }, { campaign: older }], progress),
    ).toEqual(expected);
  });

  it("drops a campaign with an unreadable timestamp", () => {
    const progress = progressFile({
      c1: { completedMissionIds: [], lastPlayedMissionId: "m1", updatedAt: "" },
    });
    expect(campaignPick([{ campaign: campaign() }], progress)).toBeUndefined();
  });

  it("answers nothing for a campaign you have never opened", () => {
    expect(
      campaignPick([{ campaign: campaign() }], progressFile()),
    ).toBeUndefined();
  });

  it("answers nothing when the played mission names no map", () => {
    const noMap = campaign({
      missions: [mission({ snapshot: { ...mission().snapshot, mapName: "" } })],
    });
    const progress = progressFile({
      c1: {
        completedMissionIds: [],
        lastPlayedMissionId: "m1",
        updatedAt: "2026-08-01T00:00:00Z",
      },
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

describe("collectionPicks", () => {
  // Four rather than three, because with three every ordering of a set is a
  // rotation of every other, so dropping the sort left the rotation unchanged
  // and a three-item case could not see it.
  const shelf = [
    { name: "Tabula-v6" },
    { name: "AcidicQuarry 5.17" },
    { name: "Isthmus v3" },
    { name: "Comet Catcher Redux 1.5" },
  ];

  it("offers every member of the collection", () => {
    expect(collectionPicks(shelf, "map")).toHaveLength(shelf.length);
    expect(
      new Set(
        collectionPicks(shelf, "map").map((p) =>
          p.kind === "map" ? p.mapName : "",
        ),
      ),
    ).toEqual(new Set(shelf.map((m) => m.name)));
  });

  it("gives the same answer every time it is asked", () => {
    // A card that changes picture when you navigate away and back is worse than
    // a repeated one, so this is the property the whole rotation exists for.
    expect(collectionPicks(shelf, "map")).toEqual(
      collectionPicks(shelf, "map"),
    );
    expect(collectionPicks(shelf, "game")).toEqual(
      collectionPicks(shelf, "game"),
    );
  });

  it("ignores the order the scan happened to list things in", () => {
    // Every permutation, so this cannot pass on one that happens to be a
    // rotation of the sorted order and therefore already agrees with it.
    for (const order of permutations(shelf)) {
      expect(collectionPicks(order, "map")).toEqual(
        collectionPicks(shelf, "map"),
      );
    }
  });

  it("moves when the collection changes", () => {
    const grown = [...shelf, { name: "Nuclear Winter 1.2" }];
    expect(collectionPicks(grown, "map")[0]).not.toEqual(
      collectionPicks(shelf, "map")[0],
    );
  });

  it("drops duplicates and blanks", () => {
    expect(
      collectionPicks([{ name: "A" }, { name: "A" }, { name: "" }], "map"),
    ).toEqual([{ kind: "map", mapName: "A" }]);
  });

  it("offers nothing for an empty collection", () => {
    expect(collectionPicks([], "map")).toEqual([]);
  });

  it("builds game picks when asked for games", () => {
    expect(collectionPicks([{ name: "Metal Factions v2.58" }], "game")).toEqual(
      [{ kind: "game", gameName: "Metal Factions v2.58" }],
    );
  });
});

describe("assignPicks", () => {
  const map = (mapName: string): ContentPick => ({ kind: "map", mapName });

  it("gives the map to the highest-priority claimant and no one else", () => {
    const picks = assignPicks(
      new Map([
        ["play.replays", [map("Shared")]],
        ["play.skirmish", [map("Shared")]],
      ]),
    );
    expect(picks.get("play.skirmish")).toEqual(map("Shared"));
    expect(picks.has("play.replays")).toBe(false);
  });

  it("settles a three-way collision the same way", () => {
    const picks = assignPicks(
      new Map([
        ["campaign.list", [map("Shared")]],
        ["scenario.list", [map("Shared")]],
        ["play.skirmish", [map("Shared")]],
      ]),
    );
    expect([...picks.keys()]).toEqual(["play.skirmish"]);
  });

  it("leaves one card holding the map when every card wants it", () => {
    const every = new Map(PICK_PRIORITY.map((id) => [id, [map("Shared")]]));
    const picks = assignPicks(every);
    expect([...picks.keys()]).toEqual(["play.skirmish"]);
  });

  it("answers the same however the offers are ordered", () => {
    // The page must not depend on which zone rendered first. Offered backwards,
    // the winner and the iteration order are both unchanged.
    const forwards = new Map([
      ["play.skirmish", [map("A")]],
      ["play.replays", [map("A")]],
      ["scenario.list", [map("B")]],
      ["campaign.list", [map("B")]],
    ]);
    const backwards = new Map([...forwards].reverse());
    expect([...assignPicks(backwards)]).toEqual([...assignPicks(forwards)]);
    expect([...assignPicks(forwards).keys()]).toEqual([
      "play.skirmish",
      "scenario.list",
    ]);
  });

  it("slides a collection card onto its next member rather than dropping it", () => {
    const picks = assignPicks(
      new Map([
        ["play.skirmish", [map("Shared")]],
        ["library.maps", [map("Shared"), map("Another")]],
      ]),
    );
    expect(picks.get("library.maps")).toEqual(map("Another"));
  });

  it("keeps maps and games in separate namespaces", () => {
    const picks = assignPicks(
      new Map<string, ContentPick[]>([
        ["play.skirmish", [map("Twin")]],
        ["library.games", [{ kind: "game", gameName: "Twin" }]],
      ]),
    );
    expect(picks.get("library.games")).toEqual({
      kind: "game",
      gameName: "Twin",
    });
  });

  it("ignores a tool that is not in the priority list", () => {
    // Silently dropping one would be a card that never gets its art and never
    // says why, so `contentOffers` is held to the list by its own test below.
    expect(assignPicks(new Map([["nope.nope", [map("A")]]])).size).toBe(0);
  });
});

describe("contentPicks", () => {
  /** The install this milestone was reported from: one map across four cards. */
  const SHARED = "Valles Marineris 2.6.1";
  const populated = {
    draft: { gameName: "Metal Factions v2.58", mapName: SHARED },
    replays: [{ mapName: SHARED }],
    campaigns: [{ campaign: campaign() }],
    progress: progressFile({
      c1: {
        completedMissionIds: ["m1"],
        lastPlayedMissionId: "m1",
        updatedAt: "2026-08-01T09:32:25.999Z",
      },
    }),
    scenarios: [{ scenario: { setup: { mapName: SHARED } } }],
    maps: [{ name: SHARED }, { name: "Isthmus v3" }],
    games: [{ name: "Metal Factions v2.58" }],
  };

  /** The campaign fixture's own mission, moved onto the shared map. */
  const sharedCampaign = campaign({
    missions: [
      mission({ snapshot: { ...mission().snapshot, mapName: SHARED } }),
    ],
  });

  it("hands the shared map to Singleplayer alone", () => {
    // The reported defect: these four all resolve the same map on this install.
    // Only the strongest claim keeps it, and the rest fall through to their
    // illustrations, which are four different pictures.
    const picks = contentPicks({
      ...populated,
      campaigns: [{ campaign: sharedCampaign }],
    });
    expect(picks.get("play.skirmish")).toEqual({
      kind: "map",
      mapName: SHARED,
    });
    expect(picks.has("play.replays")).toBe(false);
    expect(picks.has("scenario.list")).toBe(false);
    expect(picks.has("campaign.list")).toBe(false);
  });

  it("still gives every card a map when they are all different", () => {
    const picks = contentPicks({
      ...populated,
      replays: [{ mapName: "Isthmus v3" }],
      scenarios: [{ scenario: { setup: { mapName: "Tabula-v6" } } }],
    });
    expect(picks.get("play.replays")).toEqual({
      kind: "map",
      mapName: "Isthmus v3",
    });
    expect(picks.get("scenario.list")).toEqual({
      kind: "map",
      mapName: "Tabula-v6",
    });
    expect(picks.get("campaign.list")).toEqual({
      kind: "map",
      mapName: "Bismuth Valley v2.4.1",
    });
  });

  it("shows a map you own on the Maps card, and never the one already used", () => {
    const picks = contentPicks(populated);
    expect(picks.get("library.maps")).toEqual({
      kind: "map",
      mapName: "Isthmus v3",
    });
  });

  it("shows a game you own on the Games card", () => {
    expect(contentPicks(populated).get("library.games")).toEqual({
      kind: "game",
      gameName: "Metal Factions v2.58",
    });
  });

  it("falls back to the shelf when the saved setup names no game", () => {
    const picks = contentPicks({
      ...populated,
      draft: { gameName: "", mapName: SHARED },
      games: [{ name: "Balanced Annihilation V15.9.8" }],
    });
    expect(picks.get("library.games")).toEqual({
      kind: "game",
      gameName: "Balanced Annihilation V15.9.8",
    });
  });

  it("offers Warpath no map at all", () => {
    // Issue #1040. A run is a journey across a galaxy and one battle's map says
    // nothing about it, so the card takes its illustration at every priority.
    expect(contentOffers(populated).has("runlite.list")).toBe(false);
    expect(contentPicks(populated).has("runlite.list")).toBe(false);
  });

  it("gives the same answer on a second render", () => {
    expect([...contentPicks(populated)]).toEqual([...contentPicks(populated)]);
  });

  it("contributes nothing at all on a fresh install", () => {
    expect(
      contentPicks({
        draft: emptyDraft,
        replays: [],
        campaigns: [],
        progress: progressFile(),
        scenarios: [],
        ...noCollections,
      }).size,
    ).toBe(0);
  });

  it("drops only the sources that are missing", () => {
    const picks = contentPicks({ ...populated, replays: [] });
    expect(picks.has("play.replays")).toBe(false);
    expect(picks.has("play.skirmish")).toBe(true);
  });

  it("gives the shared map to the next card when the first is overridden", () => {
    // Issue #1000. A distribution that supplies its own Singleplayer picture has
    // taken that card out of the running, so the map it would have claimed goes
    // to the strongest card left rather than being held by a card that will
    // never paint it.
    const picks = contentPicks({
      ...populated,
      campaigns: [{ campaign: sharedCampaign }],
      overridden: new Set(["play.skirmish"]),
    });
    expect(picks.has("play.skirmish")).toBe(false);
    expect(picks.get("play.replays")).toEqual({ kind: "map", mapName: SHARED });
  });

  it("takes an overridden card out whether it was given an image or false", () => {
    // `art: false` is the icon-only card, which shows no picture at all, so it
    // yields its offer for exactly the same reason an image does.
    const offers = contentOffers({
      ...populated,
      overridden: new Set(["play.skirmish", "library.maps"]),
    });
    expect(offers.has("play.skirmish")).toBe(false);
    expect(offers.has("library.maps")).toBe(false);
    expect(offers.has("play.replays")).toBe(true);
  });

  it("leaves every card in the running when nothing is overridden", () => {
    // The vanilla install, which is every install today.
    expect([...contentPicks({ ...populated, overridden: new Set() })]).toEqual([
      ...contentPicks(populated),
    ]);
  });

  it("offers nothing for a tool the priority list does not rank", () => {
    // `assignPicks` walks the priority list, so a tool offering content without
    // a rank would be dropped without a word.
    for (const toolId of contentOffers(populated).keys()) {
      expect(PICK_PRIORITY, toolId).toContain(toolId);
    }
  });

  it("takes a claimed map off every card, however strong its claim", () => {
    // Issue #1055. The suggested map's card is showing this map and is not in
    // the grid, so no card in the grid may show it too. Singleplayer has the
    // top rank and still yields.
    const picks = contentPicks({
      ...populated,
      claimed: [{ kind: "map", mapName: SHARED }],
    });
    expect(picks.has("play.skirmish")).toBe(false);
    expect(picks.has("play.replays")).toBe(false);
    expect(picks.get("library.maps")).toEqual({
      kind: "map",
      mapName: "Isthmus v3",
    });
  });

  it("matches a claim to a card's pick whatever case each was written in", () => {
    // The claim is the catalog's spring name and the offer is a unitsync scan
    // name. Nothing makes the two agree on case, and a claim that missed would
    // be the defect back with no test failing.
    const picks = contentPicks({
      ...populated,
      claimed: [{ kind: "map", mapName: SHARED.toUpperCase() }],
    });
    expect(picks.has("play.skirmish")).toBe(false);
  });

  it("leaves the map alone when the claim is for something else", () => {
    const picks = contentPicks({
      ...populated,
      claimed: [{ kind: "map", mapName: "Somewhere Else v1" }],
    });
    expect(picks.get("play.skirmish")).toEqual({
      kind: "map",
      mapName: SHARED,
    });
    expect(picks.get("library.maps")).toEqual({
      kind: "map",
      mapName: "Isthmus v3",
    });
  });

  it("does not let a claimed map name take a game of the same name", () => {
    const picks = contentPicks({
      ...populated,
      claimed: [{ kind: "map", mapName: "Metal Factions v2.58" }],
    });
    expect(picks.get("library.games")).toEqual({
      kind: "game",
      gameName: "Metal Factions v2.58",
    });
  });

  it("leaves every card in the running when nothing is claimed", () => {
    // The page with no suggested map zone, and every page before #1055.
    expect([...contentPicks({ ...populated, claimed: [] })]).toEqual([
      ...contentPicks(populated),
    ]);
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
      ...noCollections,
    });
    const same = contentPicks({
      draft: { gameName: "g", mapName: "Map A" },
      replays: [],
      campaigns: [],
      progress: progressFile(),
      scenarios: [],
      ...noCollections,
    });
    const b = contentPicks({
      draft: { gameName: "g", mapName: "Map B" },
      replays: [],
      campaigns: [],
      progress: progressFile(),
      scenarios: [],
      ...noCollections,
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
    expect(
      contentCardArt({
        toolId: "play.skirmish",
        themeColor: "#fff",
        scheme: "dark",
      }),
    ).toBeUndefined();
  });

  it("answers the published URL once warm, and only for tools it has", () => {
    resetContentArt();
    publishContentArt(
      new Map([["play.skirmish", "coilbox://localhost/unitsyncthumb/a-3.png"]]),
    );
    expect(
      contentCardArt({
        toolId: "play.skirmish",
        themeColor: "#fff",
        scheme: "dark",
      }),
    ).toBe("coilbox://localhost/unitsyncthumb/a-3.png");
    expect(
      contentCardArt({
        toolId: "conquest.list",
        themeColor: "#fff",
        scheme: "dark",
      }),
    ).toBeUndefined();
  });

  it("falls through to a lower step while cold, and wins once warm", () => {
    resetContentArt();
    const cold = resolveCardArt("play.skirmish", "#3b82f6");
    expect(cold.source).not.toBe("content");

    publishContentArt(
      new Map([["play.skirmish", "coilbox://localhost/unitsyncthumb/a-3.png"]]),
    );
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
    // an equal-but-new Map has to be a no-op or the home page loops forever.
    // Counted through a real subscriber, because the cached value looking right
    // afterwards is true whether or not the subscribers were woken.
    resetContentArt();
    const woken = vi.fn();
    const unsubscribe = subscribeContentArt(woken);
    publishContentArt(new Map([["play.skirmish", "coilbox://x"]]));
    expect(woken).toHaveBeenCalledTimes(1);
    publishContentArt(new Map([["play.skirmish", "coilbox://x"]]));
    expect(woken).toHaveBeenCalledTimes(1);
    publishContentArt(new Map([["play.skirmish", "coilbox://y"]]));
    expect(woken).toHaveBeenCalledTimes(2);
    unsubscribe();
    resetContentArt();
  });

  it("counts a version up so useSyncExternalStore sees a new snapshot", () => {
    resetContentArt();
    const before = contentArtVersion();
    publishContentArt(new Map([["play.skirmish", "coilbox://x"]]));
    expect(contentArtVersion()).toBeGreaterThan(before);
    resetContentArt();
  });
});

/* -------------------------------------------------------------------------- *
 * What the last launch painted.
 * -------------------------------------------------------------------------- */

const mapPick = (mapName: string): ContentPick => ({ kind: "map", mapName });

function snapshot(
  entries: [string, ContentPick, string][],
): Map<string, RememberedArt> {
  return new Map(entries.map(([tool, pick, url]) => [tool, { pick, url }]));
}

describe("pruneRemembered", () => {
  const last = snapshot([
    ["play.skirmish", mapPick("Valles Marineris 2.6.1"), "coilbox://a"],
    ["library.maps", mapPick("Isthmus v3"), "coilbox://b"],
  ]);

  it("keeps a picture this launch has picked again", () => {
    const kept = pruneRemembered(
      last,
      new Map([["play.skirmish", mapPick("Valles Marineris 2.6.1")]]),
    );
    expect(kept.get("play.skirmish")?.url).toBe("coilbox://a");
  });

  it("keeps a picture for a card this launch has no answer for yet", () => {
    // The ordinary state of the first few hundred milliseconds, and the case the
    // snapshot exists for. Dropping here would put the flash straight back.
    expect(pruneRemembered(last, new Map()).size).toBe(2);
  });

  it("drops a picture the card has moved off", () => {
    // The launch after you change your skirmish map. Showing the old one would
    // be a wrong answer rather than a slow one.
    const kept = pruneRemembered(
      last,
      new Map([["play.skirmish", mapPick("Somewhere Else v1")]]),
    );
    expect(kept.has("play.skirmish")).toBe(false);
    expect(kept.has("library.maps")).toBe(true);
  });

  it("drops a picture another card has been given", () => {
    // Priority is the declared list, so a warm start must not paint the map on
    // the card a cold start would have taken it off.
    const kept = pruneRemembered(
      last,
      new Map([["play.skirmish", mapPick("Isthmus v3")]]),
    );
    expect(kept.has("library.maps")).toBe(false);
  });

  it("drops a picture the suggested map has claimed", () => {
    const kept = pruneRemembered(last, new Map(), [
      mapPick("Valles Marineris 2.6.1"),
    ]);
    expect(kept.has("play.skirmish")).toBe(false);
    expect(kept.has("library.maps")).toBe(true);
  });

  it("matches a claim whatever case each side was written in", () => {
    // The claim is the catalog's spring name and the snapshot holds a unitsync
    // scan name, exactly as `contentPicks` has to reconcile them.
    const kept = pruneRemembered(last, new Map(), [
      mapPick("VALLES MARINERIS 2.6.1"),
    ]);
    expect(kept.has("play.skirmish")).toBe(false);
  });

  it("keeps a game whose name matches a claimed map", () => {
    const games = snapshot([
      ["library.games", { kind: "game", gameName: "Twin" }, "coilbox://g"],
    ]);
    expect(pruneRemembered(games, new Map(), [mapPick("Twin")]).size).toBe(1);
  });

  it("never paints one picture on two cards, on any install", () => {
    // The property the two drops above exist for, asserted against a real
    // assignment rather than a hand-built collision, and at the moment it is
    // hardest: the saved setup has loaded and the unitsync scan has not, so this
    // launch has an answer for Singleplayer and none for Maps. The map the setup
    // now names is the one the Maps card was showing last launch.
    const stale = snapshot([
      ["play.skirmish", mapPick("Isthmus v3"), "coilbox://old"],
      ["library.maps", mapPick("Tabula-v6"), "coilbox://maps"],
      ["library.games", { kind: "game", gameName: "MF" }, "coilbox://games"],
    ]);
    const fresh = contentPicks({
      draft: { gameName: "MF", mapName: "Tabula-v6" },
      replays: [],
      campaigns: [],
      progress: progressFile(),
      scenarios: [],
      ...noCollections,
    });
    expect(fresh.has("library.maps")).toBe(false);
    const kept = pruneRemembered(stale, fresh);
    const painted = new Map(fresh);
    for (const [toolId, entry] of kept)
      if (!painted.has(toolId)) painted.set(toolId, entry.pick);
    const keys = [...painted.values()].map((p) =>
      p.kind === "map" ? `m:${p.mapName}` : `g:${p.gameName}`,
    );
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("rememberedFrom", () => {
  it("writes down what was resolved, with the pick that explains it", () => {
    const next = rememberedFrom(
      new Map([["play.skirmish", "coilbox://a"]]),
      new Map([["play.skirmish", mapPick("Valles Marineris 2.6.1")]]),
      new Map(),
    );
    expect(next.get("play.skirmish")).toEqual({
      pick: mapPick("Valles Marineris 2.6.1"),
      url: "coilbox://a",
    });
  });

  it("leaves out a URL with no pick behind it", () => {
    // Unverifiable next launch, so remembering it would be remembering exactly
    // the thing this design rejected.
    expect(
      rememberedFrom(
        new Map([["play.skirmish", "coilbox://a"]]),
        new Map(),
        new Map(),
      ).size,
    ).toBe(0);
  });

  it("carries an entry this publish said nothing about", () => {
    // The stores settle at different times, so the first publish of a launch is
    // often one card. Overwriting with it would cost the others their head start.
    const next = rememberedFrom(
      new Map([["play.skirmish", "coilbox://new"]]),
      new Map([["play.skirmish", mapPick("A")]]),
      snapshot([["library.maps", mapPick("B"), "coilbox://old"]]),
    );
    expect(next.get("library.maps")?.url).toBe("coilbox://old");
  });

  it("refuses to carry a picture this publish gave to another card", () => {
    const next = rememberedFrom(
      new Map([["play.skirmish", "coilbox://new"]]),
      new Map([["play.skirmish", mapPick("B")]]),
      snapshot([["library.maps", mapPick("B"), "coilbox://old"]]),
    );
    expect(next.has("library.maps")).toBe(false);
  });
});

describe("the stored snapshot", () => {
  it("round trips both kinds of pick", () => {
    const entries = snapshot([
      ["play.skirmish", mapPick("Valles Marineris 2.6.1"), "coilbox://a"],
      ["library.games", { kind: "game", gameName: "MF v2.58" }, "coilbox://b"],
    ]);
    expect([...decodeRemembered(encodeRemembered(entries))]).toEqual([
      ...entries,
    ]);
  });

  it("reads nothing at all rather than half a page", () => {
    // Half a snapshot is not a safer snapshot: the entries only avoid each
    // other's pictures as a set.
    for (const text of [
      null,
      "",
      "{",
      "[]",
      '{"version":2,"entries":[]}',
      '{"version":1}',
      '{"version":1,"entries":[{"tool":"a","kind":"map","name":"M"}]}',
      '{"version":1,"entries":[{"tool":"a","kind":"other","name":"M","url":"u"}]}',
      '{"version":1,"entries":[{"tool":"","kind":"map","name":"M","url":"u"}]}',
    ]) {
      expect(decodeRemembered(text).size, String(text)).toBe(0);
    }
  });
});

describe("painting from the snapshot", () => {
  beforeEach(() => {
    resetContentArt();
  });

  const remembered = () =>
    rememberContentArt(
      snapshot([["play.skirmish", mapPick("A"), "coilbox://remembered"]]),
    );

  it("answers before this launch has resolved anything", () => {
    remembered();
    expect(resolveCardArt("play.skirmish", "#3b82f6")).toEqual({
      kind: "art",
      url: "coilbox://remembered",
      source: "content",
    });
  });

  it("yields to this launch's own answer", () => {
    remembered();
    publishContentArt(
      new Map([["play.skirmish", "coilbox://fresh"]]),
      new Map([["play.skirmish", mapPick("A")]]),
    );
    expect(
      contentCardArt({
        toolId: "play.skirmish",
        themeColor: "#fff",
        scheme: "dark",
      }),
    ).toBe("coilbox://fresh");
  });

  it("stops answering once this launch's picks contradict it", () => {
    remembered();
    validateRememberedArt(new Map([["play.skirmish", mapPick("B")]]));
    expect(resolveCardArt("play.skirmish", "#3b82f6").source).not.toBe(
      "content",
    );
  });

  it("keeps answering while this launch's picks agree", () => {
    remembered();
    validateRememberedArt(new Map([["play.skirmish", mapPick("A")]]));
    expect(resolveCardArt("play.skirmish", "#3b82f6").source).toBe("content");
  });

  it("falls through to an illustration when the picture will not load", () => {
    // An evicted cache file. The icon-only card would be worse than the drawing
    // the remembered picture displaced, so the step withdraws its answer and the
    // chain carries on below it.
    remembered();
    forgetContentArt("coilbox://remembered");
    const after = resolveCardArt("play.skirmish", "#3b82f6");
    expect(after.source).not.toBe("content");
    expect(after.kind).toBe("art");
  });

  it("withdraws a URL this launch resolved when it will not load either", () => {
    publishContentArt(
      new Map([["play.skirmish", "coilbox://fresh"]]),
      new Map([["play.skirmish", mapPick("A")]]),
    );
    forgetContentArt("coilbox://fresh");
    expect(resolveCardArt("play.skirmish", "#3b82f6").source).not.toBe(
      "content",
    );
  });

  it("leaves the other cards alone when one picture fails", () => {
    rememberContentArt(
      snapshot([
        ["play.skirmish", mapPick("A"), "coilbox://one"],
        ["library.maps", mapPick("B"), "coilbox://two"],
      ]),
    );
    forgetContentArt("coilbox://one");
    expect(rememberedContentArt().get("library.maps")?.url).toBe(
      "coilbox://two",
    );
  });

  it("wakes the subscribers when it drops a picture", () => {
    // The card is already painted, so nothing re-renders it unless the store
    // says so, and it would sit on the icon card for the rest of the session.
    remembered();
    const woken = vi.fn();
    const unsubscribe = subscribeContentArt(woken);
    forgetContentArt("coilbox://remembered");
    expect(woken).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it("says nothing about a URL it never offered", () => {
    remembered();
    const before = contentArtVersion();
    forgetContentArt("coilbox://somewhere-else");
    expect(contentArtVersion()).toBe(before);
    expect(rememberedContentArt().size).toBe(1);
  });

  it("keeps what the publish said, for the next launch to check", () => {
    publishContentArt(
      new Map([["play.skirmish", "coilbox://fresh"]]),
      new Map([["play.skirmish", mapPick("A")]]),
    );
    expect(rememberedContentArt().get("play.skirmish")).toEqual({
      pick: mapPick("A"),
      url: "coilbox://fresh",
    });
  });
});

/* -------------------------------------------------------------------------- *
 * One snapshot per install (issue #1115).
 * -------------------------------------------------------------------------- */

describe("where the snapshot is kept", () => {
  const VANILLA = "coilbox.home.contentArt";
  const PACKAGE = "coilbox.home.contentArt:/pkg/.coilbox";

  // The node test env has no localStorage at all, so the whole store is a Map.
  const store = new Map<string, string>();

  beforeEach(() => {
    store.clear();
    resetContentArt();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
      removeItem: (key: string) => {
        store.delete(key);
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    // Put the module's key back, so a later suite writing through `remember`
    // does not write under a portable root this one made up.
    loadContentArt("");
  });

  it("keeps the bare key for an ordinary install", () => {
    expect(contentArtStorageKey("")).toBe(VANILLA);
  });

  it("names the portable root for a distribution shipped in a game", () => {
    expect(contentArtStorageKey("/pkg/.coilbox")).toBe(PACKAGE);
  });

  it("reads back what this install wrote, not the other one's", () => {
    store.set(
      VANILLA,
      encodeRemembered(snapshot([["play.skirmish", mapPick("A"), "vanilla"]])),
    );
    store.set(
      PACKAGE,
      encodeRemembered(snapshot([["library.maps", mapPick("B"), "package"]])),
    );
    loadContentArt("/pkg/.coilbox");
    expect([...rememberedContentArt().keys()]).toEqual(["library.maps"]);
  });

  it("starts a portable package empty rather than on the other install's picks", () => {
    store.set(
      VANILLA,
      encodeRemembered(snapshot([["play.skirmish", mapPick("A"), "vanilla"]])),
    );
    loadContentArt("/pkg/.coilbox");
    expect(rememberedContentArt().size).toBe(0);
  });

  it("leaves the other install's snapshot alone when it prunes its own", () => {
    // The reported symptom: a package with an empty inventory ran once and the
    // ordinary install's next launch was three pictures short.
    const vanilla = encodeRemembered(
      snapshot([
        ["play.skirmish", mapPick("A"), "vanilla-a"],
        ["library.maps", mapPick("B"), "vanilla-b"],
      ]),
    );
    store.set(VANILLA, vanilla);
    loadContentArt("/pkg/.coilbox");
    publishContentArt(new Map(), new Map());
    expect(store.get(VANILLA)).toBe(vanilla);
    expect(store.get(PACKAGE)).toBe(encodeRemembered(new Map()));
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
    minimap.mockResolvedValue({
      startPositions: [],
      errors: ["archive missing"],
    });
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
    const args = [
      mapPicks([["play.skirmish", "Broken"]]),
      "/engine",
      "/root",
      new Map(),
    ] as const;
    expect((await resolvePicks(...args)).has("play.skirmish")).toBe(false);
    expect((await resolvePicks(...args)).has("play.skirmish")).toBe(false);
    expect(minimap).toHaveBeenCalledTimes(1);
  });

  it("takes a game's header art from the batch the Games grid already fetched", async () => {
    const out = await resolvePicks(
      new Map([
        ["library.games", { kind: "game", gameName: "Metal Factions v2.58" }],
      ]),
      "/engine",
      "/root",
      new Map([
        ["Metal Factions v2.58", "coilbox://localhost/unitsyncheader/h-1.jpg"],
      ]),
    );
    expect(out.get("library.games")).toBe(
      "coilbox://localhost/unitsyncheader/h-1.jpg",
    );
  });

  it("leaves a game with no header art out of the result", async () => {
    const out = await resolvePicks(
      new Map([["library.games", { kind: "game", gameName: "No Art" }]]),
      "/engine",
      "/root",
      new Map(),
    );
    expect(out.has("library.games")).toBe(false);
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

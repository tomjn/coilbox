import { describe, expect, it, vi } from "vitest";

// The module exports the collector hook alongside the pure functions, so loading
// it pulls in picoframe's frame and plugin SDK (via the settings-backed preset
// store and the Tauri command bindings), whose published dists use extensionless
// relative imports Vitest's node resolver won't load from node_modules. Nothing
// here calls the hook, so stubbing the leaves is enough (same mocks as
// store.test.ts, same reason as layout.test.ts).
vi.mock("@picoframe/frame", () => ({
  useSetting: () => [{}, () => {}],
}));
vi.mock("@picoframe/plugin-sdk", () => ({
  defineCommand: () => async () => ({}),
}));
// The lobby store's audio cues attach window listeners at module top level, which
// the node environment has no window for. Nothing here rings or cues.
vi.mock("../multiplayer/ringEffect", () => ({ triggerRing: () => {} }));
vi.mock("../multiplayer/ingameCue", () => ({ triggerIngameCue: () => {} }));
vi.mock("../multiplayer/chat/mentionCue", () => ({
  triggerMentionCue: () => {},
}));

import type { Campaign, ProgressFile } from "../campaign/model";
import type { ConquestStateFile } from "../conquest/model";
import { defaultSkirmishDraft, type StoredSkirmishDraft } from "../play/drafts";
import type { SkirmishPreset } from "../play/presets";
import type { RunStatus } from "../runlite/model";
import {
  battleCandidate,
  campaignCandidate,
  collectCandidates,
  conquestCandidate,
  type LobbySnapshot,
  type ResumeCandidate,
  type ResumeSources,
  type RunSummary,
  rankCandidates,
  skirmishCandidate,
  updateCandidate,
  warpathCandidate,
} from "./continue";

const NOW = Date.parse("2026-08-07T12:00:00.000Z");
const minutesAgo = (n: number) => new Date(NOW - n * 60_000).toISOString();

/** A candidate that waits indefinitely, which is everything saved to disk. */
function waiting(id: string, touchedAt: number): ResumeCandidate {
  return {
    id,
    kind: "warpath",
    title: id,
    detail: "",
    to: `/${id}`,
    touchedAt,
  };
}

/** A candidate whose window closes at `expiresAt`. */
function closing(
  id: string,
  touchedAt: number,
  expiresAt: number | "soon",
): ResumeCandidate {
  return { ...waiting(id, touchedAt), kind: "battle", expiresAt };
}

const ids = (cs: readonly ResumeCandidate[]) => cs.map((c) => c.id);

describe("rankCandidates", () => {
  it("returns nothing for an empty set", () => {
    expect(rankCandidates([], NOW)).toEqual([]);
  });

  it("returns a lone candidate", () => {
    const only = waiting("run", NOW - 1000);
    expect(rankCandidates([only], NOW)).toEqual([only]);
  });

  it("puts the most recently touched first, whatever its type", () => {
    const run = waiting("run", NOW - 60_000);
    const campaign: ResumeCandidate = {
      ...waiting("campaign", NOW - 1000),
      kind: "campaign",
    };
    const conquest: ResumeCandidate = {
      ...waiting("conquest", NOW - 3_600_000),
      kind: "conquest",
    };
    expect(ids(rankCandidates([run, campaign, conquest], NOW))).toEqual([
      "campaign",
      "run",
      "conquest",
    ]);
  });

  it("lets a closing window beat a more recently touched run", () => {
    // The rejoin shuts and the run waits, so the run is still there afterwards
    // and the battle is not.
    const run = waiting("run", NOW - 1000);
    const battle = closing("battle", NOW - 3_600_000, "soon");
    expect(ids(rankCandidates([run, battle], NOW))).toEqual(["battle", "run"]);
  });

  it("keeps the input order when two candidates were touched at once", () => {
    // Ties must not shuffle between renders, so the collector's fixed order is
    // what decides them.
    const a = waiting("a", NOW - 5000);
    const b = waiting("b", NOW - 5000);
    expect(ids(rankCandidates([a, b], NOW))).toEqual(["a", "b"]);
    expect(ids(rankCandidates([b, a], NOW))).toEqual(["b", "a"]);
  });

  it("drops a window that has already closed rather than promoting it", () => {
    const run = waiting("run", NOW - 3_600_000);
    const shut = closing("shut", NOW - 1000, NOW - 1);
    expect(ids(rankCandidates([run, shut], NOW))).toEqual(["run"]);
  });

  it("keeps a window that closes in a moment", () => {
    const shut = closing("open", NOW - 1000, NOW + 1);
    expect(ids(rankCandidates([shut], NOW))).toEqual(["open"]);
  });

  it("orders two closing windows by recency", () => {
    // There is only ever one closing candidate today, so recency is enough and
    // soonest-deadline-first would be a third rule to explain.
    const older = closing("older", NOW - 60_000, NOW + 60_000);
    const newer = closing("newer", NOW - 1000, NOW + 60_000);
    expect(ids(rankCandidates([older, newer], NOW))).toEqual([
      "newer",
      "older",
    ]);
  });

  it("drops a candidate whose timestamp did not parse", () => {
    // Campaign progress can carry an empty `updatedAt`, and a NaN comparison
    // would leave the page in an arbitrary order.
    const broken = waiting("broken", Number.NaN);
    const run = waiting("run", NOW - 1000);
    expect(ids(rankCandidates([broken, run], NOW))).toEqual(["run"]);
  });

  it("does not mutate the array it was given", () => {
    const a = waiting("a", NOW - 1000);
    const b = waiting("b", NOW - 60_000);
    const input = [b, a];
    rankCandidates(input, NOW);
    expect(ids(input)).toEqual(["b", "a"]);
  });
});

// --- Sources -----------------------------------------------------------------

function run(
  name: string,
  updatedAt: string,
  status: RunStatus = "active",
): Record<string, RunSummary> {
  return {
    [name]: {
      name,
      updatedAt,
      settings: { game: { shortname: "BAR" } },
      progress: { status, hull: 8, maxHull: 10 },
    },
  };
}

describe("warpathCandidate", () => {
  it("finds nothing on a fresh install", () => {
    expect(warpathCandidate({})).toBeUndefined();
  });

  it("offers the most recently updated active run", () => {
    const runs = {
      ...run("old", minutesAgo(60)),
      ...run("new", minutesAgo(1)),
    };
    const c = warpathCandidate(runs);
    expect(c?.title).toBe("new");
    expect(c?.to).toBe("/warpath/new");
    expect(c?.detail).toBe("BAR · health 8/10");
    expect(c?.touchedAt).toBe(Date.parse(minutesAgo(1)));
    expect(c?.expiresAt).toBeUndefined();
  });

  it("ignores a run that is already won or lost", () => {
    const runs = {
      ...run("won", minutesAgo(1), "won"),
      ...run("still going", minutesAgo(60)),
    };
    expect(warpathCandidate(runs)?.title).toBe("still going");
  });

  it("finds nothing when every run is finished", () => {
    expect(warpathCandidate(run("won", minutesAgo(1), "won"))).toBeUndefined();
  });
});

function mission(id: string, title: string): Campaign["missions"][number] {
  return {
    id,
    title,
    briefing: "",
    objectives: [],
    disabledUnits: [],
    skippable: false,
    snapshot: defaultSkirmishDraft,
  };
}

function campaign(id: string, title: string): { campaign: Campaign } {
  return {
    campaign: {
      schemaVersion: 1,
      id,
      type: "ta",
      title,
      description: "",
      missions: [mission("m1", "Landfall"), mission("m2", "The Ridge")],
      createdAt: minutesAgo(500),
      updatedAt: minutesAgo(500),
    },
  };
}

const noProgress: ProgressFile = { schemaVersion: 1, campaigns: {} };

describe("campaignCandidate", () => {
  it("finds nothing on a fresh install", () => {
    expect(campaignCandidate([], noProgress)).toBeUndefined();
  });

  it("finds nothing when a campaign exists but was never played", () => {
    expect(
      campaignCandidate([campaign("c1", "Core War")], noProgress),
    ).toBeUndefined();
  });

  it("offers the mission left hanging mid-attempt", () => {
    const progress: ProgressFile = {
      schemaVersion: 1,
      campaigns: {
        c1: {
          completedMissionIds: ["m1"],
          lastPlayedMissionId: "m2",
          updatedAt: minutesAgo(5),
        },
      },
    };
    const c = campaignCandidate([campaign("c1", "Core War")], progress);
    expect(c?.title).toBe("Core War");
    expect(c?.detail).toBe("The Ridge");
    expect(c?.to).toBe("/campaign/c1/m2");
  });

  it("finds nothing when the last-played mission is already complete", () => {
    const progress: ProgressFile = {
      schemaVersion: 1,
      campaigns: {
        c1: {
          completedMissionIds: ["m1", "m2"],
          lastPlayedMissionId: "m2",
          updatedAt: minutesAgo(5),
        },
      },
    };
    expect(
      campaignCandidate([campaign("c1", "Core War")], progress),
    ).toBeUndefined();
  });

  it("skips a campaign whose progress has no readable timestamp", () => {
    // `applyDefeat` synthesises an entry with an empty `updatedAt` for a
    // campaign that was never played, which parses to NaN.
    const progress: ProgressFile = {
      schemaVersion: 1,
      campaigns: {
        c1: {
          completedMissionIds: [],
          lastPlayedMissionId: "m2",
          updatedAt: "",
        },
      },
    };
    expect(
      campaignCandidate([campaign("c1", "Core War")], progress),
    ).toBeUndefined();
  });
});

const noConquests: ConquestStateFile = { schemaVersion: 1, conquests: {} };

function conquestFile(
  id: string,
  updatedAt: string,
  status: "active" | "won" | "lost" = "active",
): ConquestStateFile {
  return {
    schemaVersion: 1,
    conquests: {
      [id]: {
        seed: 1,
        turn: 7,
        playerFactionId: "arm",
        owners: {},
        incursions: [],
        status,
        history: [],
        updatedAt,
      },
    },
  };
}

describe("conquestCandidate", () => {
  it("finds nothing on a fresh install", () => {
    expect(conquestCandidate([], noConquests)).toBeUndefined();
  });

  it("finds nothing when a galaxy exists but was never started", () => {
    const galaxies = [{ galaxy: { id: "g1", title: "The Rim" } }];
    expect(conquestCandidate(galaxies, noConquests)).toBeUndefined();
  });

  it("offers the active run and says which turn it is on", () => {
    const galaxies = [{ galaxy: { id: "g1", title: "The Rim" } }];
    const c = conquestCandidate(galaxies, conquestFile("g1", minutesAgo(2)));
    expect(c?.title).toBe("The Rim");
    expect(c?.detail).toBe("Turn 7");
    expect(c?.to).toBe("/conquest/g1");
  });

  it("ignores a run that is already won", () => {
    const galaxies = [{ galaxy: { id: "g1", title: "The Rim" } }];
    const file = conquestFile("g1", minutesAgo(2), "won");
    expect(conquestCandidate(galaxies, file)).toBeUndefined();
  });
});

function lobby(over: Partial<LobbySnapshot> = {}): LobbySnapshot {
  return {
    myUsername: "Zephyr",
    currentBattle: 7,
    battles: { "7": { host: "Autohost", title: "[A] Team Game" } },
    users: { Autohost: { status: { ingame: true } } },
    ...over,
  };
}

describe("battleCandidate", () => {
  it("finds nothing when logged out", () => {
    expect(battleCandidate(null, NOW)).toBeUndefined();
  });

  it("finds nothing when connected but not in a battle", () => {
    expect(
      battleCandidate(lobby({ currentBattle: null }), NOW),
    ).toBeUndefined();
  });

  it("finds nothing while the host is still in the lobby", () => {
    const state = lobby({ users: { Autohost: { status: { ingame: false } } } });
    expect(battleCandidate(state, NOW)).toBeUndefined();
  });

  it("finds nothing when we are the host", () => {
    // Hosting means we start the match from the battle room, not rejoin it.
    const state = lobby({
      myUsername: "Autohost",
      users: { Autohost: { status: { ingame: true } } },
    });
    expect(battleCandidate(state, NOW)).toBeUndefined();
  });

  it("offers the match the host is already in, as a closing window", () => {
    const c = battleCandidate(lobby(), NOW);
    expect(c?.title).toBe("[A] Team Game");
    expect(c?.detail).toBe("Match in progress · hosted by Autohost");
    expect(c?.to).toBe("/battle");
    expect(c?.touchedAt).toBe(NOW);
    expect(c?.expiresAt).toBe("soon");
  });
});

function preset(over: Partial<SkirmishPreset>): SkirmishPreset {
  return {
    id: "p1",
    name: "Duel",
    gameName: "Beyond All Reason",
    mapName: "Comet Catcher",
    participants: [],
    startPosType: 2,
    modOptionValues: {},
    createdAt: minutesAgo(500),
    lastUsedAt: minutesAgo(500),
    ...over,
  };
}

function draft(over: Partial<StoredSkirmishDraft> = {}): StoredSkirmishDraft {
  return {
    ...defaultSkirmishDraft,
    gameName: "Beyond All Reason",
    mapName: "Supreme Isthmus",
    ...over,
  };
}

/** The draft as an install that predates the stamp holds it: set up, unstamped. */
const unstamped = draft();

describe("skirmishCandidate", () => {
  it("finds nothing on a fresh install", () => {
    expect(skirmishCandidate(defaultSkirmishDraft, [])).toBeUndefined();
  });

  it("offers the working draft, named by its map and game", () => {
    const c = skirmishCandidate(draft({ touchedAt: NOW - 60_000 }), []);
    expect(c?.title).toBe("Supreme Isthmus");
    expect(c?.detail).toBe("Beyond All Reason");
    expect(c?.to).toBe("/play/skirmish");
    expect(c?.touchedAt).toBe(NOW - 60_000);
  });

  it("prefers the draft to the preset you last loaded", () => {
    // The point of the whole change: ten minutes of tweaking beats the name of
    // whatever preset the setup started from, even a preset used since.
    const c = skirmishCandidate(draft({ touchedAt: NOW - 5_400_000 }), [
      preset({ name: "Duel", lastUsedAt: minutesAgo(9) }),
    ]);
    expect(c?.title).toBe("Supreme Isthmus");
  });

  it("offers the most recently used preset when the draft is unstamped", () => {
    // An install upgraded into the stamp has a draft with no `touchedAt`, and it
    // must not rank as epoch zero or as now. It is not offered at all until the
    // setup screen next writes, so the old preset answer stands for one visit.
    const c = skirmishCandidate(unstamped, [
      preset({ id: "old", name: "Old", lastUsedAt: minutesAgo(90) }),
      preset({ id: "new", name: "New", lastUsedAt: minutesAgo(9) }),
    ]);
    expect(c?.title).toBe("New");
    expect(c?.detail).toBe("Beyond All Reason on Comet Catcher");
    expect(c?.to).toBe("/play/skirmish");
  });

  it("finds nothing when an unstamped draft is all there is", () => {
    expect(skirmishCandidate(unstamped, [])).toBeUndefined();
  });

  it("skips a draft whose stamp is not a number", () => {
    // Settings are JSON on disk, so a null or a string can arrive here, and a
    // NaN would be dropped silently by the ranking rather than falling back.
    const broken = draft({ touchedAt: Number.NaN });
    expect(skirmishCandidate(broken, [preset({})])?.title).toBe("Duel");
  });

  it("skips a stamped draft that names no map yet", () => {
    // The map and game are the whole card, so a stamped but empty draft is worse
    // than the preset it would displace.
    const empty = draft({ mapName: "", touchedAt: NOW - 1000 });
    expect(skirmishCandidate(empty, [preset({})])?.title).toBe("Duel");
  });

  it("skips a preset whose timestamp did not parse", () => {
    expect(
      skirmishCandidate(unstamped, [preset({ lastUsedAt: "" })]),
    ).toBeUndefined();
  });
});

describe("updateCandidate", () => {
  it("offers the available update, naming both versions", () => {
    const c = updateCandidate(
      { version: "1.12.0", date: minutesAgo(60) },
      "1.11.1",
    );
    expect(c?.title).toBe("Coilbox 1.12.0");
    expect(c?.detail).toBe("You have 1.11.1");
    expect(c?.to).toBe("/settings/updates");
  });

  it("offers nothing when there is no update", () => {
    expect(updateCandidate(null, "1.11.1")).toBeUndefined();
  });

  it("ranks on the release date, not on when the check found it", () => {
    // The whole reason the date is read off the manifest. Detection time is
    // always this session, which would pin the card to the top of the page
    // every launch until it was installed.
    const c = updateCandidate(
      { version: "1.12.0", date: minutesAgo(60) },
      "1.11.1",
    );
    expect(c?.touchedAt).toBe(NOW - 60 * 60_000);
  });

  it("waits indefinitely, so it never pre-empts a rejoinable battle", () => {
    expect(
      updateCandidate({ version: "1.12.0", date: minutesAgo(1) }, "1.11.1")
        ?.expiresAt,
    ).toBeUndefined();
  });

  it("offers nothing when the manifest carried no date", () => {
    // Nothing to rank on. The topbar badge is the surface that always shows an
    // update, so there is no need to invent a timestamp for this one.
    expect(updateCandidate({ version: "1.12.0" }, "1.11.1")).toBeUndefined();
  });

  it("offers nothing when the date did not parse", () => {
    expect(
      updateCandidate({ version: "1.12.0", date: "soon" }, "1.11.1"),
    ).toBeUndefined();
  });

  it("still offers when the running version is not known yet", () => {
    const c = updateCandidate(
      { version: "1.12.0", date: minutesAgo(60) },
      null,
    );
    expect(c?.detail).toBe("Ready to install");
  });
});

// --- Collection --------------------------------------------------------------

const emptySources: ResumeSources = {
  runs: {},
  campaigns: [],
  progress: noProgress,
  galaxies: [],
  conquests: noConquests,
  lobby: null,
  draft: defaultSkirmishDraft,
  presets: [],
  update: null,
  installedVersion: null,
};

describe("collectCandidates", () => {
  it("finds nothing on a fresh install, with every source absent", () => {
    expect(collectCandidates(emptySources, NOW)).toEqual([]);
  });

  it("skips only the absent sources", () => {
    const sources: ResumeSources = {
      ...emptySources,
      runs: run("Kappa Reach", minutesAgo(30)),
      presets: [preset({ lastUsedAt: minutesAgo(120) })],
    };
    expect(collectCandidates(sources, NOW).map((c) => c.kind)).toEqual([
      "warpath",
      "skirmish",
    ]);
  });

  it("builds one candidate per source in a fixed order", () => {
    const sources: ResumeSources = {
      runs: run("Kappa Reach", minutesAgo(30)),
      campaigns: [campaign("c1", "Core War")],
      progress: {
        schemaVersion: 1,
        campaigns: {
          c1: {
            completedMissionIds: [],
            lastPlayedMissionId: "m1",
            updatedAt: minutesAgo(30),
          },
        },
      },
      galaxies: [{ galaxy: { id: "g1", title: "The Rim" } }],
      conquests: conquestFile("g1", minutesAgo(30)),
      lobby: lobby(),
      draft: draft({ touchedAt: NOW - 30 * 60_000 }),
      presets: [],
      update: { version: "1.12.0", date: minutesAgo(30) },
      installedVersion: "1.11.1",
    };
    // Every disk-backed source is touched at the same moment on purpose: this is
    // the order that decides a tie, so it is asserted rather than assumed.
    expect(collectCandidates(sources, NOW).map((c) => c.kind)).toEqual([
      "battle",
      "warpath",
      "conquest",
      "campaign",
      "skirmish",
      "update",
    ]);
  });

  it("lets a fresh release outrank a run you have not touched in a while", () => {
    const ranked = rankCandidates(
      collectCandidates(
        {
          ...emptySources,
          runs: run("Kappa Reach", minutesAgo(4000)),
          update: { version: "1.12.0", date: minutesAgo(60) },
          installedVersion: "1.11.1",
        },
        NOW,
      ),
      NOW,
    );
    expect(ranked.map((c) => c.kind)).toEqual(["update", "warpath"]);
  });

  it("lets a run you played yesterday push a week-old release down", () => {
    // What "competes as a normal candidate" buys, and its cost: an update can be
    // pushed off the row entirely. The topbar badge is the guaranteed surface.
    const ranked = rankCandidates(
      collectCandidates(
        {
          ...emptySources,
          runs: run("Kappa Reach", minutesAgo(60)),
          update: { version: "1.12.0", date: minutesAgo(10080) },
          installedVersion: "1.11.1",
        },
        NOW,
      ),
      NOW,
    );
    expect(ranked.map((c) => c.kind)).toEqual(["warpath", "update"]);
  });

  it("keeps a rejoinable battle above an update released minutes ago", () => {
    // The battle's window shuts and the update's does not, so rule 2 applies
    // to the update exactly as it does to everything else.
    const ranked = rankCandidates(
      collectCandidates(
        {
          ...emptySources,
          lobby: lobby(),
          update: { version: "1.12.0", date: minutesAgo(1) },
          installedVersion: "1.11.1",
        },
        NOW,
      ),
      NOW,
    );
    expect(ranked.map((c) => c.kind)).toEqual(["battle", "update"]);
  });

  it("ranks the live battle over everything, then recency", () => {
    const sources: ResumeSources = {
      ...emptySources,
      lobby: lobby(),
      runs: run("Kappa Reach", minutesAgo(90)),
      presets: [preset({ lastUsedAt: minutesAgo(1) })],
    };
    const ranked = rankCandidates(collectCandidates(sources, NOW), NOW);
    expect(ranked.map((c) => c.kind)).toEqual([
      "battle",
      "skirmish",
      "warpath",
    ]);
  });

  it("ranks the skirmish on the draft's stamp, not the preset's", () => {
    // Issue #1011: a setup tweaked a minute ago, from a preset last opened a week
    // back, used to rank behind an hour-old run because only the preset had a
    // timestamp.
    const sources: ResumeSources = {
      ...emptySources,
      runs: run("Kappa Reach", minutesAgo(60)),
      draft: draft({ touchedAt: NOW - 60_000 }),
      presets: [preset({ lastUsedAt: minutesAgo(10_080) })],
    };
    const ranked = rankCandidates(collectCandidates(sources, NOW), NOW);
    expect(ranked.map((c) => c.kind)).toEqual(["skirmish", "warpath"]);
    expect(ranked[0].title).toBe("Supreme Isthmus");
  });
});

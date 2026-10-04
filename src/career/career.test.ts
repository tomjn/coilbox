import { describe, expect, it } from "vitest";
import type { AchievementResult } from "../content/achievements";
import type { StatAi, StatPlayer, StatRecord } from "../content/bindings";
import { emptyMeta } from "../runlite/model";
import {
  achievementDigest,
  buildCareer,
  type Career,
  type CareerGame,
  type CareerInput,
  careerTotals,
} from "./career";
import { createGameResolver, stripVersion } from "./games";

const installed = (name: string, shortname: string, version: string) => ({
  name,
  info: { shortname, version },
});

const BA = installed("Balanced Annihilation V15.9.8", "BA", "V15.9.8");
const SF = installed("SplinterFaction 0.1.86", "SF", "0.1.86");

let seq = 0;
/** A 1v1 against one AI on `gameType`, with `me` winning or losing. */
function duel(gameType: string, won: boolean | undefined): StatRecord {
  seq += 1;
  const players: StatPlayer[] = [
    { name: "me", allyTeam: 0, won, spectator: false },
  ];
  const ais: StatAi[] = [{ name: "AI 1", shortName: "BARb", allyTeam: 1 }];
  return {
    filename: `r${seq}.sdfz`,
    path: `/demos/r${seq}.sdfz`,
    mapName: "Comet",
    gameType,
    engineVersion: "105",
    durationSec: 600,
    startTimeMs: seq,
    sizeBytes: 1,
    modifiedMs: 1,
    winnersKnown: won !== undefined,
    winningAllyTeams: [0],
    remixed: false,
    players,
    ais,
    statsKnown: false,
    teamTotals: [],
    ingestedAt: 0,
  };
}

const none: CareerInput = {
  installed: [],
  campaigns: null,
  conquest: null,
  ai: null,
  warpath: null,
};

const campaign = (
  id: string,
  title: string,
  games: (string | undefined)[],
) => ({
  campaign: {
    id,
    title,
    missions: games.map((g, i) => ({
      id: `${id}-m${i}`,
      title: `Mission ${i + 1}`,
      snapshot: g === undefined ? undefined : { gameName: g },
    })),
  },
});

describe("createGameResolver", () => {
  it("meets a shortname, a pinned archive and a replay's archive at the installed game", () => {
    const r = createGameResolver([BA, SF]);
    const a = r.byShortname("ba");
    const b = r.byName("Balanced Annihilation V15.9.8");
    const c = r.byName("Balanced Annihilation V15.9.8-coilbox3do");
    const d = r.byName("Balanced Annihilation V14.0");
    expect(new Set([a.key, b.key, c.key, d.key]).size).toBe(1);
    expect(a.title).toBe("Balanced Annihilation");
    expect(a.installed).toBe(true);
  });

  it("groups two versions of one game that is not installed", () => {
    const r = createGameResolver([]);
    const a = r.byName("SplinterFaction 0.1.78");
    const b = r.byName("SplinterFaction 0.1.84");
    const c = r.byName("SplinterFaction $VERSION");
    expect(a.key).toBe(b.key);
    expect(a.key).toBe(c.key);
    expect(a.title).toBe("SplinterFaction");
    expect(a.installed).toBe(false);
  });

  it("does not claim a game is missing when the installed games are unknown", () => {
    const r = createGameResolver(null);
    expect(r.byName("Zero-K v1.12.3").installed).toBeNull();
    expect(r.byShortname("zk").installed).toBeNull();
  });

  it("does not take another game for an installed one because it starts with its name", () => {
    const r = createGameResolver([BA]);
    const remix = r.byName("Balanced Annihilation Remix 1.0");
    expect(remix.key).not.toBe(r.byName("Balanced Annihilation V15.9.8").key);
    expect(remix.installed).toBe(false);
  });

  it("keeps a name with no version, and a year that is not one", () => {
    expect(stripVersion("Coilbox unit test scratch")).toBe(
      "Coilbox unit test scratch",
    );
    expect(stripVersion("Spring 1944 2.31")).toBe("Spring 1944");
    expect(stripVersion("Beyond All Reason test-30018-d71d659")).toBe(
      "Beyond All Reason",
    );
  });

  it("puts a blank name under one unknown game", () => {
    const r = createGameResolver([]);
    expect(r.byName("").key).toBe(r.byName(undefined).key);
    expect(r.byName("").title).toBe("Game not named");
  });
});

describe("buildCareer", () => {
  it("shows one game across all four stores as one entry", () => {
    const career = buildCareer({
      installed: [BA],
      campaigns: {
        campaigns: [
          campaign("c1", "Ridge", [
            "Balanced Annihilation V15.9.8",
            "Balanced Annihilation V15.9.8",
          ]),
        ],
        progress: {
          campaigns: {
            c1: {
              completedMissionIds: ["c1-m0"],
              lastPlayedMissionId: "c1-m0",
            },
          },
        },
      },
      conquest: {
        galaxies: [
          { galaxy: { id: "g1", game: { shortname: "BA" } } },
          { galaxy: { id: "g2", game: { shortname: "ba" } } },
        ],
        state: {
          conquests: { g1: { status: "active" }, g2: { status: "won" } },
        },
        unlocks: { ba: { threatLevel: 2, finished: 3, won: 2, seen: [] } },
      },
      ai: {
        records: [
          duel("Balanced Annihilation V15.9.8", true),
          duel("Balanced Annihilation V15.9.8-coilbox3do", false),
          duel("Balanced Annihilation V15.9.8", undefined),
        ],
        player: "me",
        refights: new Set(),
        scripted: new Set(),
      },
      warpath: null,
    });

    expect(career.isEmpty).toBe(false);
    expect(career.games).toHaveLength(1);
    const [game] = career.games;
    expect(game.title).toBe("Balanced Annihilation");
    expect(game.campaigns).toEqual([
      {
        id: "c1",
        title: "Ridge",
        missions: 2,
        completed: 1,
        finished: false,
        nextMission: "Mission 2",
      },
    ]);
    expect(game.conquest).toEqual({
      finished: 3,
      won: 2,
      lost: 1,
      threatLevel: 2,
      inProgress: 1,
    });
    expect(game.ai).toMatchObject({
      games: 3,
      wins: 1,
      losses: 1,
      undecided: 1,
    });
    expect(game.ai?.topAi?.ai).toBe("BARb");
  });

  it("shows a game that is in one store only, with only that section", () => {
    const career = buildCareer({
      ...none,
      installed: [SF],
      conquest: {
        galaxies: [],
        state: { conquests: {} },
        unlocks: { sf: { threatLevel: 1, finished: 1, won: 1, seen: ["x"] } },
      },
    });
    expect(career.games).toHaveLength(1);
    expect(career.games[0].title).toBe("SplinterFaction");
    expect(career.games[0].conquest?.won).toBe(1);
    expect(career.games[0].campaigns).toEqual([]);
    expect(career.games[0].ai).toBeNull();
  });

  it("groups two versions of one game in replays, however many are installed", () => {
    const career = buildCareer({
      ...none,
      installed: null,
      ai: {
        records: [
          duel("SplinterFaction 0.1.78", true),
          duel("SplinterFaction 0.1.84", true),
          duel("SplinterFaction $VERSION", false),
        ],
        player: "me",
        refights: new Set(),
        scripted: new Set(),
      },
    });
    expect(career.games).toHaveLength(1);
    expect(career.games[0].ai).toMatchObject({ games: 3, wins: 2, losses: 1 });
    expect(career.games[0].installed).toBeNull();
  });

  it("keeps a store's game that matches nothing, under the name the store has", () => {
    const career = buildCareer({
      ...none,
      installed: [BA],
      conquest: {
        galaxies: [{ galaxy: { id: "g", game: { shortname: "Mystery" } } }],
        state: { conquests: { g: { status: "active" } } },
        unlocks: {},
      },
      ai: {
        records: [duel("Beyond All Reason test-30018-d71d659", true)],
        player: "me",
        refights: new Set(),
        scripted: new Set(),
      },
    });
    expect(career.games.map((g) => g.title).sort()).toEqual([
      "Beyond All Reason",
      "Mystery",
    ]);
    const mystery = career.games.find((g) => g.title === "Mystery");
    expect(mystery?.installed).toBe(false);
    expect(mystery?.conquest).toMatchObject({ inProgress: 1, finished: 0 });
  });

  it("joins a galaxy to its replays through the archive it is pinned to", () => {
    const career = buildCareer({
      ...none,
      installed: [],
      conquest: {
        galaxies: [
          {
            galaxy: {
              id: "g",
              game: { shortname: "SF", pinnedName: "SplinterFaction 0.1.78" },
            },
          },
        ],
        state: { conquests: { g: { status: "active" } } },
        unlocks: {},
      },
      ai: {
        records: [duel("SplinterFaction 0.1.84", true)],
        player: "me",
        refights: new Set(),
        scripted: new Set(),
      },
    });
    expect(career.games).toHaveLength(1);
  });

  it("is empty when no store has anything", () => {
    const career = buildCareer({
      installed: [BA],
      campaigns: {
        campaigns: [campaign("c", "Unplayed", ["x"])],
        progress: { campaigns: {} },
      },
      conquest: { galaxies: [], state: { conquests: {} }, unlocks: {} },
      ai: { records: [], player: "", refights: new Set(), scripted: new Set() },
      warpath: emptyMeta,
    });
    expect(career).toEqual({ games: [], warpath: null, isEmpty: true });
  });

  it("is empty when every store is unavailable", () => {
    expect(buildCareer({ ...none, installed: null }).isEmpty).toBe(true);
  });

  it("reports Warpath once, not per game, and only when there is something", () => {
    const career = buildCareer({
      ...none,
      warpath: {
        ...emptyMeta,
        loadouts: ["vanguard"],
        eventPools: ["anomalies"],
        ascensionTier: 1,
        stats: { runs: 2, wins: 1, deepest: 8 },
      },
    });
    expect(career.isEmpty).toBe(false);
    expect(career.games).toEqual([]);
    expect(career.warpath).toEqual({
      runs: 2,
      wins: 1,
      deepest: 8,
      ascensionTier: 1,
      maxAscension: 5,
      loadouts: ["Armoured vanguard"],
      eventPools: ["anomalies"],
    });
  });

  it("files a campaign under the game most of its missions name", () => {
    const career = buildCareer({
      ...none,
      installed: [BA, SF],
      campaigns: {
        campaigns: [
          campaign("c", "Mixed", [
            "SplinterFaction 0.1.86",
            "Balanced Annihilation V15.9.8",
            "Balanced Annihilation V15.9.8",
          ]),
        ],
        progress: {
          campaigns: { c: { completedMissionIds: ["c-m0", "gone"] } },
        },
      },
    });
    expect(career.games).toHaveLength(1);
    expect(career.games[0].title).toBe("Balanced Annihilation");
    // A completed id the campaign no longer has is not counted.
    expect(career.games[0].campaigns[0].completed).toBe(1);
  });

  it("marks a campaign with every mission done as finished, with nothing next", () => {
    const career = buildCareer({
      ...none,
      campaigns: {
        campaigns: [campaign("c", "Short", ["Zero-K v1.0"])],
        progress: { campaigns: { c: { completedMissionIds: ["c-m0"] } } },
      },
    });
    expect(career.games[0].campaigns[0]).toMatchObject({
      finished: true,
      nextMission: undefined,
    });
  });

  it("files a campaign naming no game under the unknown game", () => {
    const career = buildCareer({
      ...none,
      campaigns: {
        campaigns: [campaign("c", "Bare", [undefined])],
        progress: { campaigns: { c: { completedMissionIds: ["c-m0"] } } },
      },
    });
    expect(career.games[0].title).toBe("Game not named");
  });

  it("leaves out games against AI that are not skirmishes, and other players' games", () => {
    const refight = duel("Zero-K v1.0", true);
    const career = buildCareer({
      ...none,
      ai: {
        records: [refight, duel("Zero-K v1.0", true)],
        player: "someone else",
        refights: new Set(),
        scripted: new Set([refight.filename]),
      },
    });
    expect(career.isEmpty).toBe(true);
  });
});

describe("careerTotals", () => {
  const game = (over: Partial<CareerGame>): CareerGame => ({
    key: "g",
    title: "G",
    installed: true,
    campaigns: [],
    conquest: null,
    ai: null,
    ...over,
  });
  const row = (id: string, finished: boolean) => ({
    id,
    title: id,
    missions: 3,
    completed: finished ? 3 : 1,
    finished,
    nextMission: undefined,
  });

  it("adds each game's results together and counts finished campaigns", () => {
    const career: Career = {
      isEmpty: false,
      warpath: {
        runs: 5,
        wins: 2,
        deepest: 4,
        ascensionTier: 0,
        maxAscension: 5,
        loadouts: [],
        eventPools: [],
      },
      games: [
        game({
          campaigns: [row("a", true), row("b", false)],
          conquest: {
            finished: 3,
            won: 2,
            lost: 1,
            threatLevel: 1,
            inProgress: 0,
          },
          ai: { games: 10, wins: 6, losses: 3, undecided: 1, topAi: null },
        }),
        game({
          key: "h",
          campaigns: [row("c", true)],
          ai: { games: 4, wins: 1, losses: 3, undecided: 0, topAi: null },
        }),
      ],
    };
    expect(careerTotals(career)).toEqual({
      aiGames: 14,
      aiWins: 7,
      conquestsFinished: 3,
      conquestsWon: 2,
      warpathRuns: 5,
      warpathWins: 2,
      campaignsFinished: 2,
      campaignsStarted: 3,
    });
  });

  it("is all zeros for a career with nothing in it", () => {
    expect(careerTotals({ isEmpty: true, warpath: null, games: [] })).toEqual({
      aiGames: 0,
      aiWins: 0,
      conquestsFinished: 0,
      conquestsWon: 0,
      warpathRuns: 0,
      warpathWins: 0,
      campaignsFinished: 0,
      campaignsStarted: 0,
    });
  });
});

describe("achievementDigest", () => {
  const result = (
    id: string,
    earned: boolean,
    earnedAtMs?: number,
  ): AchievementResult => ({
    id,
    name: id,
    description: id,
    category: "Milestones",
    target: 1,
    current: earned ? 1 : 0,
    earned,
    earnedAtMs,
  });

  it("shows the most recently earned first, up to the limit, and counts them all", () => {
    const digest = achievementDigest(
      [
        result("old", true, 100),
        result("locked", false),
        result("new", true, 300),
        result("mid", true, 200),
      ],
      2,
    );
    expect(digest.shown.map((r) => r.id)).toEqual(["new", "mid"]);
    expect(digest.earned).toBe(3);
    expect(digest.total).toBe(4);
  });

  it("shows nothing when nothing is earned", () => {
    const digest = achievementDigest([result("a", false)], 6);
    expect(digest).toEqual({ shown: [], earned: 0, total: 1 });
  });
});

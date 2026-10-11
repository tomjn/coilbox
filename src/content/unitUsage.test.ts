import { describe, expect, it } from "vitest";
import type {
  GameItem,
  MatchSetup,
  ReplayUnitOrders,
  StatRecord,
  UnitDatasetEntry,
  UnitDefLink,
  UnitDefOrders,
} from "./bindings";
import { gamesFor } from "./stats";
import {
  DEFAULT_USAGE_SORT,
  foldUnitUsage,
  nextUsageSort,
  type ReplayLists,
  replayLists,
  sortUsageRows,
  storedLists,
  streamNaming,
  totalsMisfits,
  type UnitUsageRow,
} from "./unitUsage";

// Two builds of one invented game. The second adds a unit ahead of the rest,
// so every id moves, and reprices the tank.

const unit = (
  name: string,
  mobile: boolean,
  stats: Record<string, unknown>,
  buildOptions: string[] = [],
): UnitDatasetEntry =>
  ({
    name,
    fullName: name[0].toUpperCase() + name.slice(1),
    mobile,
    buildOptions,
    stats,
  }) as UnitDatasetEntry;

const mex = unit("mex", false, { metalCost: 50, extractsMetal: 1 });
const lab = unit("lab", false, { metalCost: 600, builder: true }, ["tank"]);
const scout = unit("scout", true, {});

/** Ids: 1 mex, 2 tank, 3 lab. */
const V1 = [mex, unit("tank", true, { metalCost: 100, weapons: [{}] }), lab];
/** Ids: 1 lab, 2 mex, 3 scout, 4 tank. */
const V2 = [
  lab,
  mex,
  scout,
  unit("tank", true, { metalCost: 120, weapons: [{}] }),
];

const placed = (def: number, n: number): UnitDefOrders => ({
  def,
  placed: n,
  queued: 0,
  units: n,
});
const queued = (def: number, n: number, units: number): UnitDefOrders => ({
  def,
  placed: 0,
  queued: n,
  units,
});

function replay(
  path: string,
  ann: UnitDefOrders[],
  over: Partial<ReplayUnitOrders> = {},
): ReplayUnitOrders {
  return {
    path,
    gameId: path,
    remixed: false,
    gameType: "Game 1.0",
    lastFrame: 9000,
    incomplete: false,
    removals: 0,
    seats: [{ player: 0, name: "Ann", defs: ann }],
    fromCache: true,
    ...over,
  };
}

function record(path: string, startTimeMs: number, won?: boolean): StatRecord {
  return {
    filename: path,
    path,
    startTimeMs,
    winnersKnown: won !== undefined,
    players: [
      { name: "Ann", team: 0, spectator: false, won },
      { name: "Bea", team: 1, spectator: false },
    ],
  } as unknown as StatRecord;
}

const named = (units: UnitDatasetEntry[], engine = false): ReplayLists => ({
  stream: { kind: "named", units, engine },
  events: null,
});

function fold(
  records: StatRecord[],
  replays: ReplayUnitOrders[],
  listsFor: (r: ReplayUnitOrders) => ReplayLists,
  failed: string[] = [],
) {
  return foldUnitUsage(
    gamesFor(records, "Ann"),
    "Ann",
    new Map(replays.map((r) => [r.path, r])),
    new Set(failed),
    listsFor,
  );
}

const row = (rows: UnitUsageRow[], unitKey: string) =>
  rows.find((r) => r.unitKey === unitKey);

describe("foldUnitUsage", () => {
  it("adds two builds of one game on the unit's key, each priced from its own list", () => {
    const usage = fold(
      [record("a", 1, true), record("b", 2, false)],
      [
        // Two mexes, and six tanks in two factory orders.
        replay("a", [placed(1, 2), queued(2, 2, 6)]),
        // On the second build the mex is id 2 and the tank id 4.
        replay("b", [placed(2, 1), queued(4, 1, 1)]),
      ],
      (r) => named(r.path === "a" ? V1 : V2),
    );
    expect(usage.counted).toBe(2);
    expect(usage.rows).toHaveLength(2);
    expect(row(usage.rows, "mex")).toMatchObject({
      name: "Mex",
      game: "Game",
      category: "economy",
      matches: 2,
      decided: 2,
      won: 1,
      orders: 3,
      units: 3,
      metal: 150,
      analysed: null,
    });
    // 6 at 100 and 1 at 120.
    expect(row(usage.rows, "tank")).toMatchObject({
      category: "offence",
      matches: 2,
      orders: 3,
      units: 7,
      metal: 720,
    });
    expect(usage.split).toEqual({
      economy: 150,
      defence: 0,
      offence: 720,
      other: 0,
      unclassified: 0,
    });
  });

  it("counts a game with no recorded result as played and not as decided", () => {
    const usage = fold(
      [record("a", 1, true), record("b", 2)],
      [replay("a", [placed(1, 1)]), replay("b", [placed(1, 1)])],
      () => named(V1),
    );
    expect(row(usage.rows, "mex")).toMatchObject({
      matches: 2,
      decided: 1,
      won: 1,
    });
  });

  it("leaves another player's orders and a skirmish AI's out of the rows", () => {
    const usage = fold(
      [record("a", 1, true)],
      [
        replay("a", [placed(1, 1)], {
          seats: [
            { player: 0, name: "Ann", defs: [placed(1, 1)] },
            { player: 1, name: "Bea", defs: [placed(3, 4)] },
            // Sent by Ann's player number, for the AI on team 5.
            { player: 0, aiTeam: 5, defs: [queued(2, 1, 20)] },
          ],
        }),
      ],
      () => named(V1),
    );
    expect(usage.rows.map((r) => [r.unitKey, r.units])).toEqual([["mex", 1]]);
  });

  it("leaves out a game with no unit list and counts it and its orders", () => {
    const usage = fold(
      [record("a", 1, true), record("b", 2, true)],
      [replay("a", [placed(1, 1)]), replay("b", [placed(1, 2), placed(3, 1)])],
      (r) =>
        r.path === "a" ? named(V1) : { stream: { kind: "none" }, events: null },
    );
    expect(usage.counted).toBe(1);
    expect(usage.noList).toEqual({ games: 1, orders: 3 });
    expect(row(usage.rows, "mex")).toMatchObject({ matches: 1, units: 1 });
  });

  it("leaves out a whole game when any seat's order does not fit the list", () => {
    // Ann's own orders fit the first build. Bea queued id 3 at a factory, and
    // on that build id 3 is the lab, which does not move. So the list is not
    // the one the match was played on, and Ann's mex may not be a mex.
    const usage = fold(
      [record("a", 1, true)],
      [
        replay("a", [placed(1, 2)], {
          seats: [
            { player: 0, name: "Ann", defs: [placed(1, 2)] },
            { player: 1, name: "Bea", defs: [queued(3, 1, 1)] },
          ],
        }),
      ],
      () => named(V1),
    );
    expect(usage.rows).toEqual([]);
    expect(usage.counted).toBe(0);
    expect(usage.misfit).toEqual({ games: 1, orders: 2 });
  });

  it("does not check the engine's own list, and leaves out only an id past its end", () => {
    const usage = fold(
      [record("a", 1, true)],
      // A placed tank does not fit, and id 9 is past the end.
      [replay("a", [placed(2, 1), placed(9, 3)])],
      () => named(V1, true),
    );
    expect(usage.counted).toBe(1);
    expect(usage.misfit.games).toBe(0);
    expect(usage.unnamedOrders).toBe(3);
    expect(usage.rows.map((r) => r.unitKey)).toEqual(["tank"]);
  });

  it("counts games that are not read yet, are waiting on a list, or would not read", () => {
    const usage = fold(
      [record("a", 1), record("b", 2), record("c", 3), record("d", 4)],
      [replay("a", [placed(1, 1)]), replay("b", [placed(1, 1)])],
      (r) =>
        r.path === "a"
          ? named(V1)
          : { stream: { kind: "waiting" }, events: null },
      ["c"],
    );
    expect(usage).toMatchObject({
      games: 4,
      counted: 1,
      waiting: 1,
      failed: 1,
      unread: 1,
    });
  });

  it("counts a game with no build orders, and one whose recording stops early", () => {
    const usage = fold(
      [record("a", 1, true), record("b", 2, true)],
      [replay("a", []), replay("b", [placed(1, 1)], { incomplete: true })],
      () => named(V1),
    );
    expect(usage).toMatchObject({ counted: 2, noOrders: 1, incomplete: 1 });
  });

  it("counts units with no metal cost apart, and adds nothing to the metal for them", () => {
    const usage = fold(
      [record("a", 1, true)],
      [replay("a", [queued(3, 1, 5), placed(2, 1)])],
      () => named(V2),
    );
    expect(row(usage.rows, "scout")).toMatchObject({
      units: 5,
      metal: 0,
      unpriced: 5,
    });
    expect(usage.unpriced).toBe(5);
    expect(usage.split.economy).toBe(50);
  });

  it("takes finished and died from the player's team, for units they ordered in that game", () => {
    const events = [
      {
        team: 0,
        defs: [
          // The analysis ran on the second build: id 2 is the mex, 4 the tank.
          { def: 2, finished: 3, died: 1 },
          { def: 4, finished: 9, died: 9 },
        ],
      },
      { team: 1, defs: [{ def: 2, finished: 50, died: 50 }] },
    ];
    const usage = fold(
      [record("a", 1, true), record("b", 2, true), record("c", 3, true)],
      [
        // Analysed. Ann ordered mexes here and no tank.
        replay("a", [placed(1, 4)], { events }),
        // Not analysed.
        replay("b", [placed(1, 2), queued(2, 1, 1)]),
        // Analysed before the engine's list was kept.
        replay("c", [placed(1, 1)], { events }),
      ],
      (r) => ({
        stream: { kind: "named", units: V1, engine: false },
        events: r.path === "a" ? V2 : null,
      }),
    );
    expect(usage.analysed).toBe(1);
    expect(usage.analysedUnnamed).toBe(1);
    expect(row(usage.rows, "mex")).toMatchObject({
      matches: 3,
      units: 7,
      analysed: { replays: 1, ordered: 4, finished: 3, died: 1 },
    });
    // The team finished tanks in the analysed game, but Ann ordered none
    // there, so the tank has no analysed game.
    expect(row(usage.rows, "tank")?.analysed).toBeNull();
  });

  it("counts an analysed game whose record has no team for the player, and takes no events from it", () => {
    const old = record("a", 1, true);
    // A record from before team ids were kept. Team 0 is a real team, so an
    // absent one must not be read as it.
    old.players = [{ name: "Ann", spectator: false, won: true }];
    const usage = fold(
      [old],
      [
        replay("a", [placed(1, 4)], {
          events: [{ team: 0, defs: [{ def: 1, finished: 4, died: 0 }] }],
        }),
      ],
      () => ({
        stream: { kind: "named", units: V1, engine: false },
        events: V1,
      }),
    );
    expect(usage).toMatchObject({ analysed: 0, analysedNoTeam: 1 });
    expect(row(usage.rows, "mex")?.analysed).toBeNull();
  });

  it("shows nothing finished as nought, not as absent, in an analysed game", () => {
    const usage = fold(
      [record("a", 1, true)],
      [replay("a", [placed(1, 4)], { events: [] })],
      () => ({
        stream: { kind: "named", units: V1, engine: false },
        events: V1,
      }),
    );
    expect(row(usage.rows, "mex")?.analysed).toEqual({
      replays: 1,
      ordered: 4,
      finished: 0,
      died: 0,
    });
  });

  it("keeps two games' units apart when they share a key", () => {
    const usage = fold(
      [record("a", 1, true), record("b", 2, true)],
      [
        replay("a", [placed(1, 1)]),
        replay("b", [placed(1, 1)], { gameType: "Other Game 2.0" }),
      ],
      () => named(V1),
    );
    expect(usage.rows.map((r) => r.game).sort()).toEqual([
      "Game",
      "Other Game",
    ]);
  });
});

describe("totalsMisfits", () => {
  it("counts a placed unit that moves, a queued one that does not, and an id past the end", () => {
    const seats = (defs: UnitDefOrders[]) => ({
      seats: [{ player: 0, name: "Ann", defs }],
    });
    expect(totalsMisfits(seats([placed(1, 2), queued(2, 3, 9)]), V1)).toBe(0);
    expect(totalsMisfits(seats([placed(2, 2)]), V1)).toBe(2);
    expect(totalsMisfits(seats([queued(1, 3, 15)]), V1)).toBe(3);
    expect(totalsMisfits(seats([placed(4, 1), placed(0, 1)]), V1)).toBe(2);
  });
});

const link = (origin: UnitDefLink["origin"], digest = "d1"): UnitDefLink => ({
  digest,
  origin,
  game: "Game 1.0",
  takenAtMs: 1,
});

const game = (name: string, archive: string): GameItem =>
  ({ name, primaryArchive: { name: archive } }) as GameItem;

describe("streamNaming and replayLists", () => {
  const lists = new Map([["d1", V1]]);
  const packaged = game("Game 1.0", "game-1.0.sdz");
  const folder = game("Game 1.0", "game.sdd");
  const newer = game("Game 2.0", "game-2.0.sdz");

  it("reads a kept list back into the shape the classifier reads", () => {
    const got = storedLists({
      d1: [{ name: "mex", humanName: "Mex", metalCost: 50 }],
    });
    expect(got.get("d1")?.[0]).toMatchObject({
      name: "mex",
      fullName: "Mex",
      mobile: false,
      stats: { metalCost: 50 },
    });
  });

  it("names a replay from the engine's list ahead of an installed game", () => {
    const got = streamNaming(
      { gameType: "Game 1.0", streamList: link("engine") },
      lists,
      [packaged],
    );
    expect(got).toEqual({ kind: "named", units: V1, engine: true });
  });

  it("reads a packaged archive of the exact name ahead of a kept list from one", () => {
    const got = streamNaming(
      { gameType: "Game 1.0", streamList: link("archive") },
      lists,
      [packaged],
    );
    expect(got).toEqual({
      kind: "installed",
      archive: "game-1.0.sdz",
      read: "game-1.0.sdz",
    });
  });

  it("reads an installed game with the replay's own match setup", () => {
    const setup = { modOptions: { unit_pack: "1" } } as unknown as MatchSetup;
    const got = streamNaming(
      { gameType: "Game 1.0", matchSetup: setup },
      lists,
      [packaged],
    );
    expect(got).toMatchObject({
      kind: "installed",
      archive: "game-1.0.sdz",
      setup,
    });
    // Two replays with one setup share a read, and another setup has its own.
    const read = (matchSetup: MatchSetup) => {
      const naming = streamNaming({ gameType: "Game 1.0", matchSetup }, lists, [
        packaged,
      ]);
      return naming.kind === "installed" ? naming.read : null;
    };
    expect(read({ ...setup })).toBe(read(setup));
    expect(
      read({ modOptions: { unit_pack: "0" } } as unknown as MatchSetup),
    ).not.toBe(read(setup));
    expect(read(setup)).not.toBe("game-1.0.sdz");
  });

  it("names a replay from the read made with its own setup and no other", () => {
    const setup = { modOptions: { unit_pack: "1" } } as unknown as MatchSetup;
    const replay = { gameType: "Game 1.0", matchSetup: setup };
    const naming = streamNaming(replay, lists, [packaged]);
    const read = naming.kind === "installed" ? naming.read : "";
    // The game's own list is not this match's.
    expect(
      replayLists(replay, lists, [packaged], new Map([["game-1.0.sdz", V1]]))
        .stream,
    ).toEqual({ kind: "waiting" });
    expect(
      replayLists(replay, lists, [packaged], new Map([[read, V1]])).stream,
    ).toEqual({ kind: "named", units: V1, engine: false });
  });

  it("uses the kept list when the build is gone or is a loose folder", () => {
    const kept = { gameType: "Game 1.0", streamList: link("archive") };
    for (const installed of [[], [newer], [folder]]) {
      expect(streamNaming(kept, lists, installed)).toEqual({
        kind: "named",
        units: V1,
        engine: false,
      });
    }
  });

  it("names nothing from another version of the game", () => {
    expect(streamNaming({ gameType: "Game 1.0" }, lists, [newer])).toEqual({
      kind: "none",
    });
    expect(streamNaming({ gameType: "Game 1.0" }, lists, [])).toEqual({
      kind: "none",
    });
  });

  it("waits for the installed games, then for the installed game's units", () => {
    const bare = { gameType: "Game 1.0" };
    expect(replayLists(bare, lists, null, new Map()).stream).toEqual({
      kind: "waiting",
    });
    expect(replayLists(bare, lists, [packaged], new Map()).stream).toEqual({
      kind: "waiting",
    });
    expect(
      replayLists(bare, lists, [packaged], new Map([["game-1.0.sdz", V1]]))
        .stream,
    ).toEqual({ kind: "named", units: V1, engine: false });
    // A read that failed is no list, and the wait is over.
    expect(
      replayLists(bare, lists, [packaged], new Map([["game-1.0.sdz", null]]))
        .stream,
    ).toEqual({ kind: "none" });
  });

  it("does not wait for the installed games when the engine's list is kept", () => {
    const got = replayLists(
      { gameType: "Game 1.0", streamList: link("engine") },
      lists,
      null,
      new Map(),
    );
    expect(got.stream).toEqual({ kind: "named", units: V1, engine: true });
  });

  it("waits on a kept archive list until it is known whether that build is installed", () => {
    const kept = { gameType: "Game 1.0", streamList: link("archive") };
    expect(replayLists(kept, lists, null, new Map()).stream).toEqual({
      kind: "waiting",
    });
  });

  it("names events from the kept events list only", () => {
    const both = new Map([
      ["d1", V1],
      ["d2", V2],
    ]);
    const with_ = replayLists(
      { gameType: "Game 1.0", eventsList: link("engine", "d2") },
      both,
      [],
      new Map(),
    );
    expect(with_.events).toBe(V2);
    expect(
      replayLists({ gameType: "Game 1.0" }, both, [], new Map()).events,
    ).toBeNull();
  });
});

describe("sorting the rows", () => {
  const base: UnitUsageRow = {
    key: "",
    unitKey: "",
    name: "",
    game: "Game",
    category: "economy",
    matches: 0,
    decided: 0,
    won: 0,
    orders: 0,
    units: 0,
    metal: 0,
    unpriced: 0,
    analysed: null,
  };
  const rows: UnitUsageRow[] = [
    { ...base, key: "a", name: "Alpha", metal: 10, matches: 5 },
    {
      ...base,
      key: "b",
      name: "beta",
      metal: 30,
      matches: 1,
      analysed: { replays: 1, ordered: 2, finished: 0, died: 0 },
    },
    { ...base, key: "c", name: "Gamma", metal: 20, matches: 5 },
  ];
  const order = (sort: Parameters<typeof sortUsageRows>[1]) =>
    sortUsageRows(rows, sort).map((r) => r.key);

  it("opens on metal, largest first", () => {
    expect(order(DEFAULT_USAGE_SORT)).toEqual(["b", "c", "a"]);
  });

  it("sorts a new number column largest first and a text one from A, and flips on a second click", () => {
    const byGames = nextUsageSort(DEFAULT_USAGE_SORT, "matches");
    expect(byGames).toEqual({ column: "matches", dir: "desc" });
    // The two with five games fall back to metal.
    expect(order(byGames)).toEqual(["c", "a", "b"]);
    expect(nextUsageSort(byGames, "matches")).toEqual({
      column: "matches",
      dir: "asc",
    });
    const byName = nextUsageSort(byGames, "name");
    expect(byName).toEqual({ column: "name", dir: "asc" });
    expect(order(byName)).toEqual(["a", "b", "c"]);
  });

  it("puts a unit with no analysed game below one that finished none", () => {
    expect(order({ column: "finished", dir: "desc" })[0]).toBe("b");
  });
});

import { describe, expect, it } from "vitest";
import type { Battle, MemberStatus } from "../bindings";
import {
  matchesSearch,
  newMatches,
  type SavedBattleSearch,
  type ToldBattles,
} from "./savedSearch";

function mk(p: Partial<Battle>): Battle {
  return {
    id: 1,
    tachyonId: null,
    host: "host",
    ip: "",
    port: "",
    natType: "0",
    relayed: false,
    map: "Map",
    maphash: "",
    modname: "Game",
    engine: "",
    version: "",
    maxPlayers: 8,
    playerCount: null,
    passworded: false,
    locked: false,
    spectatorCount: 0,
    title: "Title",
    channel: null,
    members: {},
    bots: {},
    scriptTags: {},
    startRects: {},
    bosses: [],
    bossesEnabled: false,
    inProgress: false,
    runningSince: null,
    mode: null,
    ...p,
  };
}

function search(p: Partial<SavedBattleSearch> = {}): SavedBattleSearch {
  return {
    id: "s1",
    game: "Game",
    map: "",
    minPlayers: 0,
    freeSlot: false,
    noPassword: false,
    enabled: true,
    ...p,
  };
}

const M = {} as MemberStatus;

/** Feed a sequence of battle lists through `newMatches` as one connection would. */
function run(
  searches: SavedBattleSearch[],
  lists: Battle[][],
  joinedId: number | null = null,
  start: ToldBattles = new Map(),
) {
  let told = start;
  const out: { searchId: string; battleId: number }[][] = [];
  for (const list of lists) {
    const r = newMatches(searches, list, joinedId, told);
    told = r.told;
    out.push(
      r.matches.map((m) => ({ searchId: m.search.id, battleId: m.battle.id })),
    );
  }
  return out;
}

describe("matchesSearch", () => {
  it("matches the game by a case-insensitive part of its name", () => {
    const s = search({ game: "beyond all" });
    expect(matchesSearch(s, mk({ modname: "Beyond All Reason test-1" }))).toBe(
      true,
    );
    expect(matchesSearch(s, mk({ modname: "Zero-K" }))).toBe(false);
  });

  it("only constrains the map when one is named", () => {
    expect(matchesSearch(search(), mk({ map: "Anything" }))).toBe(true);
    const s = search({ map: "tabula" });
    expect(matchesSearch(s, mk({ map: "Tabula-v6" }))).toBe(true);
    expect(matchesSearch(s, mk({ map: "Comet" }))).toBe(false);
  });

  it("counts players for the minimum, host included", () => {
    const s = search({ minPlayers: 3 });
    expect(matchesSearch(s, mk({ members: { a: M } }))).toBe(false);
    expect(matchesSearch(s, mk({ members: { a: M, b: M } }))).toBe(true);
    expect(matchesSearch(s, mk({ playerCount: 3 }))).toBe(true);
  });

  it("requires a free slot and no password when asked", () => {
    const s = search({ freeSlot: true, noPassword: true });
    expect(matchesSearch(s, mk({ playerCount: 8, maxPlayers: 8 }))).toBe(false);
    expect(matchesSearch(s, mk({ passworded: true }))).toBe(false);
    expect(matchesSearch(s, mk({ playerCount: 7, maxPlayers: 8 }))).toBe(true);
  });
});

describe("newMatches", () => {
  it("says nothing about battles already listed when the search first sees the list", () => {
    const [first] = run([search()], [[mk({ id: 1 }), mk({ id: 2 })]]);
    expect(first).toEqual([]);
  });

  it("notifies when a battle appears that matches", () => {
    const out = run(
      [search()],
      [[mk({ id: 1 })], [mk({ id: 1 }), mk({ id: 2 })]],
    );
    expect(out[1]).toEqual([{ searchId: "s1", battleId: 2 }]);
  });

  it("notifies when an already listed battle starts matching", () => {
    const s = search({ minPlayers: 2 });
    const out = run([s], [[mk({ id: 1 })], [mk({ id: 1, members: { a: M } })]]);
    expect(out[1]).toEqual([{ searchId: "s1", battleId: 1 }]);
  });

  it("notifies once and not again when the player count changes", () => {
    const s = search({ minPlayers: 2 });
    const at = (n: number) => [mk({ id: 1, playerCount: n })];
    const out = run([s], [at(1), at(2), at(3), at(4), at(3)]);
    expect(out.map((o) => o.length)).toEqual([0, 1, 0, 0, 0]);
  });

  it("does not notify again when a battle stops matching and matches again", () => {
    const s = search({ minPlayers: 2 });
    const at = (n: number) => [mk({ id: 1, playerCount: n })];
    const out = run([s], [at(1), at(2), at(1), at(2)]);
    expect(out.map((o) => o.length)).toEqual([0, 1, 0, 0]);
  });

  it("notifies again for a battle id that closed and came back", () => {
    const s = search();
    const out = run([s], [[], [mk({ id: 1 })], [], [mk({ id: 1 })]]);
    expect(out.map((o) => o.length)).toEqual([0, 1, 0, 1]);
  });

  it("never notifies for the battle the player is in, even after leaving it", () => {
    const s = search();
    let told: ToldBattles = new Map();
    told = newMatches([s], [], null, told).told;
    const joined = newMatches([s], [mk({ id: 4 })], 4, told);
    expect(joined.matches).toEqual([]);
    const left = newMatches([s], [mk({ id: 4 })], null, joined.told);
    expect(left.matches).toEqual([]);
  });

  it("stays quiet for a search that is switched off", () => {
    const off = search({ enabled: false });
    const out = run([off], [[], [mk({ id: 1 })]]);
    expect(out[1]).toEqual([]);
  });

  it("does not notify for battles that appeared while a search was off once it is switched on", () => {
    const off = search({ enabled: false });
    const on = search({ enabled: true });
    let told: ToldBattles = new Map();
    told = newMatches([off], [], null, told).told;
    told = newMatches([off], [mk({ id: 1 })], null, told).told;
    const resumed = newMatches([on], [mk({ id: 1 })], null, told);
    expect(resumed.matches).toEqual([]);
    const later = newMatches(
      [on],
      [mk({ id: 1 }), mk({ id: 2 })],
      null,
      resumed.told,
    );
    expect(later.matches.map((m) => m.battle.id)).toEqual([2]);
  });

  it("treats a search saved after the baseline as new without announcing what is already listed", () => {
    const first = search({ id: "s1" });
    const second = search({ id: "s2" });
    const out = run([first], [[mk({ id: 1 })]], null);
    expect(out[0]).toEqual([]);
    const told = newMatches([first], [mk({ id: 1 })], null, new Map()).told;
    const r = newMatches([first, second], [mk({ id: 1 })], null, told);
    expect(r.matches).toEqual([]);
  });

  it("reports each matching search for a battle", () => {
    const a = search({ id: "a" });
    const b = search({ id: "b", game: "Gam" });
    const out = run([a, b], [[], [mk({ id: 3 })]]);
    expect(out[1]).toEqual([
      { searchId: "a", battleId: 3 },
      { searchId: "b", battleId: 3 },
    ]);
  });

  it("keeps each server's battles apart when one search runs on two connections", () => {
    const s = search();
    // Each connection keeps its own record, and both use the battle id 7.
    const serverA = run([s], [[], [mk({ id: 7 })], [mk({ id: 7 })]]);
    const serverB = run([s], [[], [], [mk({ id: 7 })]]);
    expect(serverA.map((o) => o.length)).toEqual([0, 1, 0]);
    expect(serverB.map((o) => o.length)).toEqual([0, 0, 1]);
  });
});

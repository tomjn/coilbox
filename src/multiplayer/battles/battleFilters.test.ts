import { describe, expect, it } from "vitest";
import type { Battle, MemberStatus } from "../bindings";
import {
  type BattleFilters,
  battleRowAction,
  filterSortBattles,
  groupBattles,
  occupancy,
  otherEngineName,
  scopeToProfileGame,
} from "./battleFilters";

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

const M = {} as MemberStatus;

const base: BattleFilters = {
  search: "",
  hideEmpty: false,
  hideLockedPassworded: false,
  hideFull: false,
  hideOpenAnnihilation: false,
  sortKey: "players",
  sortDir: "desc",
};

const oa = (p: Partial<Battle> = {}) =>
  mk({
    engine: "Open Annihilation",
    modname: "Total Annihilation",
    title: "[OA] Skirmish",
    ...p,
  });

describe("otherEngineName", () => {
  it("names an engine that is not Spring or Recoil", () => {
    expect(otherEngineName(oa())).toBe("Open Annihilation");
  });

  it("reads Spring, Recoil and a lobby that names no engine as Recoil", () => {
    expect(otherEngineName(mk({ engine: "spring" }))).toBeNull();
    expect(otherEngineName(mk({ engine: "Recoil" }))).toBeNull();
    expect(otherEngineName(mk({ engine: "" }))).toBeNull();
  });
});

describe("hideOpenAnnihilation", () => {
  const list = [mk({ id: 1, engine: "spring" }), oa({ id: 2 }), mk({ id: 3 })];

  it("keeps Open Annihilation battles by default", () => {
    expect(
      filterSortBattles(list, base)
        .map((b) => b.id)
        .sort(),
    ).toEqual([1, 2, 3]);
  });

  it("drops them when asked, leaving Recoil battles", () => {
    expect(
      filterSortBattles(list, { ...base, hideOpenAnnihilation: true })
        .map((b) => b.id)
        .sort(),
    ).toEqual([1, 3]);
  });
});

describe("scopeToProfileGame", () => {
  const list = [mk({ id: 1, modname: "Splinter Faction" }), oa({ id: 2 })];

  it("changes nothing without a profile game filter", () => {
    expect(scopeToProfileGame(list, null)).toEqual(list);
  });

  it("drops Open Annihilation even when the pattern matches its game name", () => {
    const loose = (name: string) => /annihilation|splinter/i.test(name);
    expect(scopeToProfileGame(list, loose).map((b) => b.id)).toEqual([1]);
  });

  it("matches Recoil battles on their game name as before", () => {
    const only = (name: string) => name === "Other";
    expect(scopeToProfileGame(list, only)).toEqual([]);
  });
});

describe("occupancy", () => {
  it("counts the host when absent from members", () => {
    expect(occupancy(mk({ members: {} }))).toBe(1);
    expect(occupancy(mk({ members: { alice: M } }))).toBe(2);
  });

  it("does not double-count a host present in members", () => {
    expect(
      occupancy(mk({ host: "host", members: { host: M, alice: M } })),
    ).toBe(2);
  });

  it("takes the server's own count where there is one", () => {
    // A Tachyon lobby list carries a player count and no roster at all.
    expect(occupancy(mk({ playerCount: 9, host: "", members: {} }))).toBe(9);
    expect(occupancy(mk({ playerCount: 0, host: "", members: {} }))).toBe(0);
  });

  it("counts a host whose name collides with an Object.prototype key", () => {
    // `constructor`/`toString` etc. exist on the prototype chain, so a naive
    // `host in members` check would wrongly treat the host as already present.
    expect(occupancy(mk({ host: "constructor", members: {} }))).toBe(1);
    expect(occupancy(mk({ host: "toString", members: { alice: M } }))).toBe(2);
  });
});

describe("battleRowAction", () => {
  it("offers Join on an open, joinable battle", () => {
    const a = battleRowAction(mk({}), { canJoin: true, inProgress: false });
    expect(a).toEqual({ kind: "join", label: "Join", disabled: false });
  });

  it("offers Spectate on a full open battle", () => {
    const a = battleRowAction(mk({ maxPlayers: 2, members: { x: M } }), {
      canJoin: true,
      inProgress: false,
    });
    expect(a).toEqual({ kind: "join", label: "Spectate", disabled: false });
  });

  it("disables Join when not joinable", () => {
    const a = battleRowAction(mk({}), { canJoin: false, inProgress: false });
    expect(a.disabled).toBe(true);
  });

  // The row gets you into the room. Whether to start the engine and watch is
  // decided there, so the row does not promise a match on the other side of it.
  it("offers Join on a running battle too", () => {
    const a = battleRowAction(mk({}), { canJoin: true, inProgress: true });
    expect(a).toEqual({ kind: "watch", label: "Join", disabled: false });
  });

  it("joins a full running battle, where nobody is taking a player slot", () => {
    const a = battleRowAction(mk({ maxPlayers: 2, members: { x: M } }), {
      canJoin: true,
      inProgress: true,
    });
    expect(a.kind).toBe("watch");
    expect(a.disabled).toBe(false);
  });

  it("disables joining a running battle when not joinable", () => {
    const a = battleRowAction(mk({}), { canJoin: false, inProgress: true });
    expect(a.disabled).toBe(true);
  });
});

describe("filterSortBattles", () => {
  it("search matches title, map, host, and game case-insensitively", () => {
    const list = [
      mk({ id: 1, title: "Alpha" }),
      mk({ id: 2, title: "Beta", map: "DeltaVista" }),
      mk({ id: 3, title: "Gamma", host: "zed" }),
      mk({ id: 4, title: "Delta", modname: "BAR" }),
    ];
    const ids = (q: string) =>
      filterSortBattles(list, { ...base, search: q })
        .map((b) => b.id)
        .sort();
    expect(ids("delta")).toEqual([2, 4]);
    expect(ids("ZED")).toEqual([3]);
    expect(ids("bar")).toEqual([4]);
  });

  it("hideEmpty drops host-only battles", () => {
    const list = [mk({ id: 1, members: {} }), mk({ id: 2, members: { a: M } })];
    expect(
      filterSortBattles(list, { ...base, hideEmpty: true }).map((b) => b.id),
    ).toEqual([2]);
  });

  it("hideLockedPassworded drops locked or passworded battles", () => {
    const list = [
      mk({ id: 1 }),
      mk({ id: 2, locked: true }),
      mk({ id: 3, passworded: true }),
    ];
    expect(
      filterSortBattles(list, { ...base, hideLockedPassworded: true }).map(
        (b) => b.id,
      ),
    ).toEqual([1]);
  });

  it("hideFull drops battles at or over capacity", () => {
    const list = [
      mk({ id: 1, maxPlayers: 2, members: { a: M } }), // occ 2 == max
      mk({ id: 2, maxPlayers: 4, members: { a: M } }), // occ 2 < max
    ];
    expect(
      filterSortBattles(list, { ...base, hideFull: true }).map((b) => b.id),
    ).toEqual([2]);
  });

  it("sorts by player count descending then ascending", () => {
    const list = [
      mk({ id: 1, members: {} }), // occ 1
      mk({ id: 2, members: { a: M, b: M } }), // occ 3
      mk({ id: 3, members: { a: M } }), // occ 2
    ];
    expect(
      filterSortBattles(list, { ...base, sortDir: "desc" }).map((b) => b.id),
    ).toEqual([2, 3, 1]);
    expect(
      filterSortBattles(list, { ...base, sortDir: "asc" }).map((b) => b.id),
    ).toEqual([1, 3, 2]);
  });

  it("sorts by map name", () => {
    const list = [
      mk({ id: 1, map: "Charlie" }),
      mk({ id: 2, map: "Alpha" }),
      mk({ id: 3, map: "Bravo" }),
    ];
    expect(
      filterSortBattles(list, { ...base, sortKey: "map", sortDir: "asc" }).map(
        (b) => b.id,
      ),
    ).toEqual([2, 3, 1]);
  });
});

describe("groupBattles", () => {
  const ids = (bs: Battle[]) => bs.map((b) => b.id);

  it("puts every locked battle in locked, waiting or running, passworded or not", () => {
    const g = groupBattles(
      [
        mk({ id: 1, locked: true }),
        mk({ id: 2, locked: true, passworded: true }),
        mk({ id: 3, locked: true }),
      ],
      null,
      new Set([3]),
    );
    expect(ids(g.locked)).toEqual([1, 2, 3]);
    expect(g.open).toEqual([]);
    expect(g.passworded).toEqual([]);
    expect(g.running).toEqual([]);
  });

  it("sorts the unlocked battles by state, running before passworded", () => {
    const g = groupBattles(
      [
        mk({ id: 1 }),
        mk({ id: 2, passworded: true }),
        mk({ id: 3, passworded: true }),
        mk({ id: 4 }),
      ],
      null,
      new Set([3, 4]),
    );
    expect(ids(g.open)).toEqual([1]);
    expect(ids(g.passworded)).toEqual([2]);
    expect(ids(g.running)).toEqual([3, 4]);
    expect(g.locked).toEqual([]);
  });

  it("leaves out the battle you are in, even when it is locked", () => {
    const g = groupBattles(
      [mk({ id: 1, locked: true }), mk({ id: 2, locked: true })],
      1,
      new Set(),
    );
    expect(ids(g.locked)).toEqual([2]);
  });

  it("keeps the hide locked filter removing locked battles entirely", () => {
    const filtered = filterSortBattles(
      [mk({ id: 1, locked: true }), mk({ id: 2 })],
      { ...base, hideLockedPassworded: true },
    );
    const g = groupBattles(filtered, null, new Set());
    expect(g.locked).toEqual([]);
    expect(ids(g.open)).toEqual([2]);
  });
});

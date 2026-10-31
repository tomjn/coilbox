import { describe, expect, it } from "vitest";
import type { StatRecord } from "./bindings";
import {
  type AggregateMatch,
  matchFormat,
  type ReplayCounts,
} from "./mapAggregate";
import { namedMapsOf, playerStarts } from "./playerStarts";
import type { StoredName } from "./startNames";

const WORLD = { worldWidth: 8192, worldHeight: 8192 };
const FRONT = { x: 1000, z: 1000 };
const BACK = { x: 7000, z: 7000 };
const DECLARED = [FRONT, BACK];

const NAMES: StoredName[] = [
  { key: "d1", name: "front", ...FRONT },
  { key: "d2", name: "back", ...BACK },
];

function match(
  filename: string,
  seats: { name: string; team: number; allyTeam: number }[],
  winner: number | null,
  mapName = "Some Map 1.0",
): AggregateMatch {
  const record = {
    filename,
    path: `/demos/${filename}`,
    mapName,
    winnersKnown: winner !== null,
    winningAllyTeams: winner === null ? [] : [winner],
    remixed: false,
    players: seats.map((s) => ({ ...s, spectator: false })),
    ais: [],
  } as unknown as StatRecord;
  return {
    record,
    playerCount: seats.length,
    format: matchFormat(record),
    analysis: "none",
  };
}

/** Ann on team 0 and Ben on team 1, as two sides of one. */
const duel = (filename: string, winner: number | null, mapName?: string) =>
  match(
    filename,
    [
      { name: "Ann", team: 0, allyTeam: 0 },
      { name: "Ben", team: 1, allyTeam: 1 },
    ],
    winner,
    mapName,
  );

function readOf(
  m: AggregateMatch,
  starts: { team: number; x: number; z: number }[],
): [string, ReplayCounts] {
  return [m.record.path, { path: m.record.path, starts } as ReplayCounts];
}

describe("playerStarts", () => {
  it("counts the starts of the player's own team and not the other side's", () => {
    // Ann starts at the front and wins. Ben, her opponent, starts at the back.
    const a = duel("a", 0);
    const counts = new Map([
      readOf(a, [
        { team: 0, ...FRONT },
        { team: 1, ...BACK },
      ]),
    ]);
    const out = playerStarts([a], "Ann", counts, DECLARED, WORLD, NAMES);
    expect(out.rows.map((r) => [r.name, r.taken, r.won, r.known])).toEqual([
      ["front", 1, 1, 1],
    ]);
    expect(out.placed).toBe(1);
  });

  it("follows the player to the position they took in each match", () => {
    // Ann is at the front in two matches, winning one, and at the back in one.
    const a = duel("a", 0);
    const b = duel("b", 1);
    const c = duel("c", 0);
    const counts = new Map([
      readOf(a, [{ team: 0, ...FRONT }]),
      readOf(b, [{ team: 0, x: 1100, z: 950 }]),
      readOf(c, [{ team: 0, ...BACK }]),
    ]);
    const out = playerStarts([a, b, c], "Ann", counts, DECLARED, WORLD, NAMES);
    expect(out.rows.map((r) => [r.name, r.taken, r.won])).toEqual([
      ["front", 2, 1],
      ["back", 1, 1],
    ]);
  });

  it("counts a loss as taken and not won, and a match with no result as taken only", () => {
    const a = duel("a", 1);
    const b = duel("b", null);
    const counts = new Map([
      readOf(a, [{ team: 0, ...FRONT }]),
      readOf(b, [{ team: 0, ...FRONT }]),
    ]);
    const [row] = playerStarts(
      [a, b],
      "Ann",
      counts,
      DECLARED,
      WORLD,
      NAMES,
    ).rows;
    expect([row.taken, row.known, row.won]).toEqual([2, 1, 0]);
  });

  it("follows the player when they are on the second team", () => {
    const a = match(
      "a",
      [
        { name: "Ben", team: 0, allyTeam: 0 },
        { name: "Ann", team: 1, allyTeam: 1 },
      ],
      1,
    );
    const counts = new Map([
      readOf(a, [
        { team: 0, ...FRONT },
        { team: 1, ...BACK },
      ]),
    ]);
    const [row] = playerStarts([a], "Ann", counts, DECLARED, WORLD, NAMES).rows;
    expect([row.name, row.taken, row.won]).toEqual(["back", 1, 1]);
  });

  it("lists nothing for a map whose positions have no names", () => {
    const a = duel("a", 0);
    const counts = new Map([readOf(a, [{ team: 0, ...FRONT }])]);
    const out = playerStarts([a], "Ann", counts, DECLARED, WORLD, []);
    expect(out.rows).toEqual([]);
    expect(out.unnamed).toBe(1);
    expect(out.placed).toBe(1);
  });

  it("leaves out a position that has no name and counts it", () => {
    const a = duel("a", 0);
    const b = duel("b", 0);
    const counts = new Map([
      readOf(a, [{ team: 0, ...FRONT }]),
      readOf(b, [{ team: 0, ...BACK }]),
    ]);
    const out = playerStarts([a, b], "Ann", counts, DECLARED, WORLD, [
      NAMES[0],
    ]);
    expect(out.rows.map((r) => r.name)).toEqual(["front"]);
    expect(out.unnamed).toBe(1);
  });

  it("joins positions that share a name into one row", () => {
    const a = duel("a", 0);
    const b = duel("b", 1);
    const counts = new Map([
      readOf(a, [{ team: 0, ...FRONT }]),
      readOf(b, [{ team: 0, ...BACK }]),
    ]);
    const shared = NAMES.map((n) => ({ ...n, name: "edge" }));
    const out = playerStarts([a, b], "Ann", counts, DECLARED, WORLD, shared);
    expect(out.rows.map((r) => [r.name, r.taken, r.won])).toEqual([
      ["edge", 2, 1],
    ]);
  });

  it("counts a match whose replay is not read yet as nothing", () => {
    const a = duel("a", 0);
    const out = playerStarts([a], "Ann", new Map(), DECLARED, WORLD, NAMES);
    expect(out.rows).toEqual([]);
    expect(out.placed).toBe(0);
  });

  it("does not take a spectator of the same name as a player", () => {
    const a = match(
      "a",
      [
        { name: "Ben", team: 0, allyTeam: 0 },
        { name: "Cat", team: 1, allyTeam: 1 },
      ],
      0,
    );
    a.record.players.push({
      name: "Ann",
      team: 0,
      allyTeam: 0,
      spectator: true,
    } as never);
    const counts = new Map([readOf(a, [{ team: 0, ...FRONT }])]);
    const out = playerStarts([a], "Ann", counts, DECLARED, WORLD, NAMES);
    expect(out.rows).toEqual([]);
  });
});

describe("namedMapsOf", () => {
  const book = { "Some Map 1.0": NAMES };

  it("lists a map the player played that has names", () => {
    const a = duel("a", 0);
    const out = namedMapsOf([a.record], "Ann", new Set(), book);
    expect(out.map((m) => [m.mapName, m.matches.length])).toEqual([
      ["Some Map 1.0", 1],
    ]);
  });

  it("lists no map when none has names", () => {
    const a = duel("a", 0);
    expect(namedMapsOf([a.record], "Ann", new Set(), {})).toEqual([]);
    expect(
      namedMapsOf([a.record], "Ann", new Set(), { "Some Map 1.0": [] }),
    ).toEqual([]);
  });

  it("does not use the names on another version of the map", () => {
    const old = duel("old", 0);
    const next = duel("next", 0, "Some Map 1.1");
    const out = namedMapsOf([old.record, next.record], "Ann", new Set(), book);
    expect(out.map((m) => m.mapName)).toEqual(["Some Map 1.0"]);
    expect(out[0].matches.map((m) => m.record.filename)).toEqual(["old"]);
    // Only the newer version was played, so nothing is listed.
    expect(namedMapsOf([next.record], "Ann", new Set(), book)).toEqual([]);
  });

  it("leaves out maps the player did not play and refights", () => {
    const others = match(
      "others",
      [
        { name: "Ben", team: 0, allyTeam: 0 },
        { name: "Cat", team: 1, allyTeam: 1 },
      ],
      0,
    );
    const refought = duel("refought", 0);
    expect(
      namedMapsOf(
        [others.record, refought.record],
        "Ann",
        new Set(["refought"]),
        book,
      ),
    ).toEqual([]);
  });

  it("puts the most played map first", () => {
    const out = namedMapsOf(
      [
        duel("a", 0, "Alpha 1.0").record,
        duel("b", 0, "Beta 1.0").record,
        duel("c", 0, "Beta 1.0").record,
      ],
      "Ann",
      new Set(),
      { "Alpha 1.0": NAMES, "Beta 1.0": NAMES },
    );
    expect(out.map((m) => m.mapName)).toEqual(["Beta 1.0", "Alpha 1.0"]);
  });
});

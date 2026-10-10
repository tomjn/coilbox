import { describe, expect, it } from "vitest";
import type { BuildOrder, GameItem, UnitDatasetEntry } from "./bindings";
import {
  buildOrderSeats,
  buildOrderTime,
  pickUnitSource,
  recordedGame,
  resolveBuildUnit,
  slotNote,
} from "./replayBuildOrders";

const game = (name: string, archive: string): GameItem => ({
  name,
  primaryArchive: { name: archive },
  dependencyArchives: [],
  info: {},
});

const order = (over: Partial<BuildOrder>): BuildOrder => ({
  frame: 0,
  player: 0,
  origin: { kind: "selection" },
  unitDefId: 1,
  count: 1,
  slot: { kind: "append" },
  builders: 1,
  options: 0,
  ...over,
});

const units: UnitDatasetEntry[] = [
  { name: "armcom", fullName: "Commander" },
  { name: "armmex", fullName: "Metal Extractor" },
  { name: "armsolar" },
];

describe("buildOrderTime", () => {
  it("turns a frame into match time at 30 frames a second", () => {
    expect(buildOrderTime(0)).toBe("0:00");
    expect(buildOrderTime(30 * 65 + 29)).toBe("1:05");
  });

  it("labels an order from before the game started", () => {
    expect(buildOrderTime(-1)).toBe("Pre-game");
  });
});

describe("recordedGame", () => {
  it("is the game the replay names", () => {
    expect(
      recordedGame({ gameType: "SplinterFaction 0.1.88", remixed: false }),
    ).toBe("SplinterFaction 0.1.88");
  });

  it("is the game a remix was recorded on, not the one it now points at", () => {
    expect(
      recordedGame({
        gameType: "Balanced Annihilation V15.9.8",
        remixed: true,
        sourceGametype: "Beyond All Reason test-30018-d71d659",
      }),
    ).toBe("Beyond All Reason test-30018-d71d659");
  });
});

describe("pickUnitSource", () => {
  const installed = [
    game("Metal Factions v2.58", "metal_factions-v2.58.sdz"),
    game("SplinterFaction 0.1.88", "SplinterFaction_0.1.88.sdz"),
    game("SplinterFaction 0.1.89", "SplinterFaction_0.1.89.sdz"),
  ];

  it("takes the installed game with the replay's name and version", () => {
    const source = pickUnitSource("SplinterFaction 0.1.88", installed);
    expect(source).toEqual({ kind: "installed", game: installed[1] });
  });

  it("matches however the version is written", () => {
    const source = pickUnitSource("Metal Factions V2.58", installed);
    expect(source).toEqual({ kind: "installed", game: installed[0] });
  });

  it("falls back to another version of the game and says it is another build", () => {
    const source = pickUnitSource("SplinterFaction 0.1.84", installed);
    expect(source).toEqual({ kind: "differentBuild", game: installed[2] });
  });

  it("has nothing to read from when no version of the game is installed", () => {
    expect(
      pickUnitSource("Beyond All Reason test-30018-d71d659", installed),
    ).toEqual({ kind: "notInstalled" });
    expect(pickUnitSource("SplinterFaction 0.1.88", [])).toEqual({
      kind: "notInstalled",
    });
  });
});

describe("resolveBuildUnit", () => {
  it("reads id n as entry n - 1, because the engine numbers units from 1", () => {
    expect(resolveBuildUnit(1, units)?.name).toBe("armcom");
    expect(resolveBuildUnit(3, units)?.name).toBe("armsolar");
  });

  it("names nothing for an id the dataset does not reach", () => {
    expect(resolveBuildUnit(0, units)).toBeUndefined();
    expect(resolveBuildUnit(4, units)).toBeUndefined();
  });

  it("names nothing with no dataset", () => {
    expect(resolveBuildUnit(1, null)).toBeUndefined();
  });
});

describe("buildOrderSeats", () => {
  it("splits the orders by player and keeps each player's in order", () => {
    const seats = buildOrderSeats(
      {
        orders: [
          order({ player: 3, team: 1, unitDefId: 2, frame: 10 }),
          order({ player: 0, team: 0, unitDefId: 3, frame: 20 }),
          order({ player: 3, team: 1, unitDefId: 3, frame: 30 }),
        ],
        players: [{ player: 3, name: "Alice" }],
      },
      { ais: [] },
    );
    expect(
      seats.map((s) => [s.name, s.team, s.orders.map((o) => o.frame)]),
    ).toEqual([
      ["Alice", 1, [10, 30]],
      ["Player 0", 0, [20]],
    ]);
  });

  it("keeps a skirmish AI's orders apart from the player hosting it", () => {
    const seats = buildOrderSeats(
      {
        orders: [
          order({ player: 0, team: 0 }),
          order({ player: 0, team: 4, origin: { kind: "ai", ai: 1, team: 4 } }),
          order({ player: 0, team: 5, origin: { kind: "ai", ai: 2, team: 5 } }),
        ],
        players: [{ player: 0, name: "Host" }],
      },
      { ais: [{ name: "AI 1", shortName: "BARb", team: 4 }] },
    );
    expect(seats.map((s) => s.name)).toEqual(["Host", "AI 1", "AI on team 5"]);
  });

  it("counts a widget's orders as the player's own", () => {
    const seats = buildOrderSeats(
      {
        orders: [
          order({ player: 2 }),
          order({ player: 2, origin: { kind: "lua" } }),
        ],
        players: [],
      },
      { ais: [] },
    );
    expect(seats).toHaveLength(1);
    expect(seats[0].orders).toHaveLength(2);
  });
});

describe("slotNote", () => {
  it("says nothing for an order added to the end or replacing the queue", () => {
    expect(slotNote(order({ slot: { kind: "append" } }))).toBeNull();
    expect(slotNote(order({ slot: { kind: "replace" } }))).toBeNull();
  });

  it("says when an order jumped the queue", () => {
    expect(slotNote(order({ slot: { kind: "front" } }))).toBe("front of queue");
    expect(slotNote(order({ slot: { kind: "insertAt", position: 0 } }))).toBe(
      "inserted first",
    );
    expect(slotNote(order({ slot: { kind: "insertAt", position: -1 } }))).toBe(
      "inserted last",
    );
    expect(slotNote(order({ slot: { kind: "insertAt", position: 2 } }))).toBe(
      "inserted at 2",
    );
    expect(
      slotNote(order({ slot: { kind: "insertAtTag", tag: 9, after: false } })),
    ).toBe("inserted mid-queue");
  });
});

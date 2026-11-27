import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  GameItem,
  RecordedPick,
  ReplayUnitDefSets,
  StatRecord,
} from "./bindings";
import {
  pickedSide,
  resetStatSidesForTests,
  resolveStatSides,
  type StatFactionReads,
  withPickedSides,
} from "./replayFactions";

const SIDES = [
  { name: "Armada", startUnit: "armcom" },
  { name: "Legion", startUnit: "LegCom" },
];
// In id order: id 1 is the first.
const UNITS = [{ name: "armcom" }, { name: "armpw" }, { name: "legcom" }];

describe("pickedSide", () => {
  it("names the side whose start unit the picked id is", () => {
    expect(pickedSide({ frame: -1, unitDefId: 3 }, UNITS, SIDES)).toBe(
      "Legion",
    );
  });

  it("takes the replay's own name for the unit over the list's", () => {
    const pick = { frame: -1, unitDefId: 1, unit: "legcom" };
    expect(pickedSide(pick, UNITS, SIDES)).toBe("Legion");
    expect(pickedSide(pick, null, SIDES)).toBe("Legion");
  });

  it("has no answer for an id the list cannot name", () => {
    expect(pickedSide({ frame: -1, unitDefId: 9 }, UNITS, SIDES)).toBe(
      undefined,
    );
    expect(pickedSide({ frame: -1, unitDefId: 3 }, null, SIDES)).toBe(
      undefined,
    );
  });

  it("has no answer for a unit that is no side's start unit", () => {
    expect(pickedSide({ frame: -1, unitDefId: 2 }, UNITS, SIDES)).toBe(
      undefined,
    );
  });

  it("spells a picked name as the game does, else as it was sent", () => {
    const sides = [{ name: "Aven" }];
    expect(pickedSide({ frame: -1, name: "aven" }, null, sides)).toBe("Aven");
    expect(pickedSide({ frame: -1, name: "gear" }, null, [])).toBe("gear");
  });
});

describe("withPickedSides", () => {
  it("puts the picked side in place of the script's, and keeps the rest", () => {
    const players = [
      { name: "A", side: "Armada", pick: { frame: -1, unitDefId: 3 } },
      { name: "B", side: "Armada" },
      { name: "C", side: "Armada", pick: { frame: -1, unitDefId: 9 } },
    ];
    expect(withPickedSides(players, UNITS, SIDES).map((p) => p.side)).toEqual([
      "Legion",
      "Armada",
      "Armada",
    ]);
  });

  it("hands back the same list when nothing changes", () => {
    const players = [{ name: "B", side: "Armada" }];
    expect(withPickedSides(players, UNITS, SIDES)).toBe(players);
  });
});

function game(name: string, archive = `${name}.sdz`): GameItem {
  return { name, info: {}, primaryArchive: { name: archive } } as GameItem;
}

function record(
  gameType: string,
  pick: RecordedPick | undefined,
  more: Partial<StatRecord> = {},
): StatRecord {
  return {
    filename: `${gameType}.sdfz`,
    sizeBytes: 1,
    modifiedMs: 1,
    gameId: "abc",
    gameType,
    remixed: false,
    players: [{ name: "A", side: "Armada", spectator: false, pick }],
    ...more,
  } as StatRecord;
}

function reads(more: Partial<StatFactionReads> = {}): StatFactionReads {
  return {
    games: [game("Game 2")],
    sides: async () => SIDES,
    units: async () => UNITS,
    kept: async () => null,
    ...more,
  };
}

const sideOf = (records: StatRecord[]) => records[0].players[0].side;

describe("resolveStatSides", () => {
  beforeEach(resetStatSidesForTests);

  it("reads the installed game's own list for the recorded version", async () => {
    const records = [record("Game 2", { frame: -1, unitDefId: 3 })];
    expect(sideOf(await resolveStatSides(records, reads()))).toBe("Legion");
  });

  it("never names an id from another version of the game", async () => {
    const units = vi.fn(async () => UNITS);
    const records = [record("Game 1", { frame: -1, unitDefId: 3 })];
    const got = await resolveStatSides(records, reads({ units }));
    expect(sideOf(got)).toBe("Armada");
    expect(units).not.toHaveBeenCalled();
  });

  it("names an id from the list kept for the replay", async () => {
    const kept: ReplayUnitDefSets = {
      links: [],
      stream: { digest: "d", origin: "engine", game: "Game 1", takenAtMs: 0 },
      sets: { d: UNITS },
    } as unknown as ReplayUnitDefSets;
    const records = [record("Game 1", { frame: -1, unitDefId: 3 })];
    const got = await resolveStatSides(
      records,
      reads({ kept: async () => kept }),
    );
    // The sides come from the installed version of the same game.
    expect(sideOf(got)).toBe("Legion");
  });

  it("reads no unit list for picks the replay names itself", async () => {
    const units = vi.fn(async () => UNITS);
    const kept = vi.fn(async () => null);
    const records = [
      record(
        "Game 1",
        { frame: -1, unitDefId: 7, unit: "legcom" },
        { remixed: true },
      ),
    ];
    const got = await resolveStatSides(records, reads({ units, kept }));
    expect(sideOf(got)).toBe("Legion");
    expect(units).not.toHaveBeenCalled();
    expect(kept).not.toHaveBeenCalled();
  });

  it("leaves a remix's unit ids alone, which are another game's", async () => {
    const records = [
      record("Game 2", { frame: -1, unitDefId: 3 }, { remixed: true }),
    ];
    expect(sideOf(await resolveStatSides(records, reads()))).toBe("Armada");
  });

  it("takes a picked name with no game installed", async () => {
    const records = [record("Other 1", { frame: -1, name: "gear" })];
    expect(sideOf(await resolveStatSides(records, reads()))).toBe("gear");
  });

  it("keeps the script's side when a read fails", async () => {
    const records = [record("Game 2", { frame: -1, unitDefId: 3 })];
    const got = await resolveStatSides(
      records,
      reads({ units: () => Promise.reject(new Error("no")) }),
    );
    expect(sideOf(got)).toBe("Armada");
  });

  it("does not read a replay again once its picks are named", async () => {
    const records = [record("Game 2", { frame: -1, unitDefId: 3 })];
    await resolveStatSides(records, reads());
    const kept = vi.fn(async () => null);
    const units = vi.fn(async () => UNITS);
    const got = await resolveStatSides(records, reads({ kept, units }));
    expect(sideOf(got)).toBe("Legion");
    expect(units).not.toHaveBeenCalled();
    expect(kept).not.toHaveBeenCalled();
  });
});

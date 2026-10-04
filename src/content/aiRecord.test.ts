import { describe, expect, it } from "vitest";
import { aiGameFor, aiRecordFor, bonusLabel } from "./aiRecord";
import type { StatAi, StatPlayer, StatRecord } from "./bindings";

let seq = 0;

function human(
  name: string,
  allyTeam: number | undefined,
  won?: boolean,
  spectator = false,
): StatPlayer {
  return { name, allyTeam, won, spectator };
}

function bot(
  shortName: string,
  allyTeam: number | undefined,
  extra: Partial<StatAi> = {},
): StatAi {
  return { name: "AI 1", shortName, allyTeam, ...extra };
}

function rec(
  players: StatPlayer[],
  ais: StatAi[],
  opts: {
    winnersKnown?: boolean;
    gameType?: string;
    remixed?: boolean;
  } = {},
): StatRecord {
  seq += 1;
  return {
    filename: `r${seq}.sdfz`,
    path: `/demos/r${seq}.sdfz`,
    mapName: "Comet",
    gameType: opts.gameType ?? "BAR",
    engineVersion: "105",
    durationSec: 600,
    startTimeMs: seq * 1000,
    sizeBytes: 1,
    modifiedMs: 1,
    winnersKnown: opts.winnersKnown ?? true,
    winningAllyTeams: [0],
    remixed: opts.remixed ?? false,
    players,
    ais,
    statsKnown: false,
    teamTotals: [],
    ingestedAt: 0,
  };
}

/** A 1v1 against one AI where `me` is on ally team 0 and the AI on 1. */
function duel(won: boolean | undefined, ai: Partial<StatAi> = {}): StatRecord {
  return rec([human("me", 0, won)], [bot("BARb", 1, ai)], {
    winnersKnown: won !== undefined,
  });
}

describe("aiGameFor", () => {
  it("counts a game against one AI as a win or a loss from my result", () => {
    expect(aiGameFor(duel(true), "me")?.result).toBe("win");
    expect(aiGameFor(duel(false), "me")?.result).toBe("loss");
  });

  it("returns null when the game has no AI", () => {
    const r = rec([human("me", 0, true), human("foe", 1, false)], []);
    expect(aiGameFor(r, "me")).toBeNull();
  });

  it("returns null when I am not in the game", () => {
    expect(aiGameFor(duel(true), "someone else")).toBeNull();
  });

  it("does not count a game I only spectated", () => {
    const r = rec(
      [human("me", undefined, undefined, true), human("foe", 0, true)],
      [bot("BARb", 1)],
    );
    expect(aiGameFor(r, "me")).toBeNull();
  });

  it("counts a replay with no winner as played, neither a win nor a loss", () => {
    const game = aiGameFor(duel(undefined), "me");
    expect(game?.result).toBe("undecided");
  });

  it("does not count a game with a human opponent as well as an AI", () => {
    const r = rec(
      [human("me", 0, true), human("foe", 1, false)],
      [bot("BARb", 1)],
    );
    expect(aiGameFor(r, "me")).toBeNull();
  });

  it("treats an AI on my own ally team as an ally, not an opponent", () => {
    const r = rec([human("me", 0, true)], [bot("Helper", 0), bot("BARb", 1)]);
    const game = aiGameFor(r, "me");
    expect(game?.opponents.map((a) => a.shortName)).toEqual(["BARb"]);
  });

  it("does not count a game whose only AI is my ally", () => {
    const r = rec(
      [human("me", 0, true), human("foe", 1, false)],
      [bot("Helper", 0)],
    );
    expect(aiGameFor(r, "me")).toBeNull();
  });

  it("counts a co-op game against AIs where a human is my ally", () => {
    const r = rec(
      [human("me", 0, true), human("friend", 0, true)],
      [bot("BARb", 1)],
    );
    expect(aiGameFor(r, "me")?.result).toBe("win");
  });

  it("keeps every AI on another ally team as an opponent", () => {
    const r = rec(
      [human("me", 0, true)],
      [bot("BARb", 1), bot("SurvivalAI", 2)],
    );
    expect(aiGameFor(r, "me")?.opponents).toHaveLength(2);
  });

  it("does not count a game where an opponent's team is unknown", () => {
    const r = rec([human("me", 0, true)], [bot("BARb", undefined)]);
    expect(aiGameFor(r, "me")).toBeNull();
  });

  it("does not count a game where my own team is unknown", () => {
    const r = rec([human("me", undefined, true)], [bot("BARb", 1)]);
    expect(aiGameFor(r, "me")).toBeNull();
  });

  it("reads an undecided result when winners are unknown even if won is set", () => {
    const r = rec([human("me", 0, true)], [bot("BARb", 1)], {
      winnersKnown: false,
    });
    expect(aiGameFor(r, "me")?.result).toBe("undecided");
  });
});

describe("bonusLabel", () => {
  it("is null for no bonus, whether absent or at the neutral value", () => {
    expect(bonusLabel(bot("BARb", 1))).toBeNull();
    expect(
      bonusLabel(bot("BARb", 1, { advantage: 0, incomeMultiplier: 1 })),
    ).toBeNull();
  });

  it("shows an advantage as a percentage", () => {
    expect(bonusLabel(bot("BARb", 1, { advantage: 0.25 }))).toBe("+25%");
  });

  it("shows an income multiplier", () => {
    expect(bonusLabel(bot("BARb", 1, { incomeMultiplier: 1.5 }))).toBe(
      "x1.5 income",
    );
  });

  it("shows both when both are set", () => {
    expect(
      bonusLabel(bot("BARb", 1, { advantage: 0.1, incomeMultiplier: 2 })),
    ).toBe("+10%, x2 income");
  });
});

describe("aiRecordFor", () => {
  const none: ReadonlySet<string> = new Set();

  it("totals games, wins, losses and undecided games", () => {
    const record = aiRecordFor(
      [duel(true), duel(true), duel(false), duel(undefined)],
      "me",
      none,
      none,
    );
    expect(record.games).toBe(4);
    expect(record.wins).toBe(2);
    expect(record.losses).toBe(1);
    expect(record.undecided).toBe(1);
  });

  it("splits by AI", () => {
    const records = [
      duel(true),
      rec([human("me", 0, false)], [bot("SurvivalAI", 1)]),
    ];
    const { rows } = aiRecordFor(records, "me", none, none);
    expect(rows.map((r) => r.ai).sort()).toEqual(["BARb", "SurvivalAI"]);
  });

  it("splits by game", () => {
    const records = [
      rec([human("me", 0, true)], [bot("BARb", 1)], { gameType: "BAR" }),
      rec([human("me", 0, true)], [bot("BARb", 1)], { gameType: "ZK" }),
    ];
    const { rows } = aiRecordFor(records, "me", none, none);
    expect(rows.map((r) => r.game).sort()).toEqual(["BAR", "ZK"]);
  });

  it("does not merge the same AI at different bonuses", () => {
    const records = [
      duel(true),
      duel(true, { advantage: 0.25 }),
      duel(false, { advantage: 0.25 }),
    ];
    const { rows } = aiRecordFor(records, "me", none, none);
    expect(rows).toHaveLength(2);
    const plain = rows.find((r) => r.bonus === null);
    const boosted = rows.find((r) => r.bonus === "+25%");
    expect(plain).toMatchObject({ games: 1, wins: 1, losses: 0 });
    expect(boosted).toMatchObject({ games: 2, wins: 1, losses: 1 });
  });

  it("puts a game against several different AIs on each AI's row but once in the total", () => {
    const r = rec(
      [human("me", 0, true)],
      [bot("BARb", 1), bot("SurvivalAI", 2)],
    );
    const record = aiRecordFor([r], "me", none, none);
    expect(record.games).toBe(1);
    expect(record.wins).toBe(1);
    expect(record.rows).toHaveLength(2);
    for (const row of record.rows)
      expect(row).toMatchObject({ games: 1, wins: 1 });
  });

  it("counts a game once on a row when several identical AIs are in it", () => {
    const r = rec([human("me", 0, true)], [bot("BARb", 1), bot("BARb", 2)]);
    const { rows } = aiRecordFor([r], "me", none, none);
    expect(rows).toHaveLength(1);
    expect(rows[0].games).toBe(1);
  });

  it("leaves out remixed games and refights", () => {
    const remix = rec([human("me", 0, true)], [bot("BARb", 1)], {
      remixed: true,
    });
    const refight = duel(true);
    const record = aiRecordFor(
      [remix, refight, duel(true)],
      "me",
      new Set([refight.filename]),
      none,
    );
    expect(record.games).toBe(1);
  });

  it("leaves out games from campaign, Conquest and Warpath", () => {
    const scripted = duel(true);
    const record = aiRecordFor(
      [scripted, duel(false)],
      "me",
      none,
      new Set([scripted.filename]),
    );
    expect(record.games).toBe(1);
    expect(record.losses).toBe(1);
  });

  it("is empty when there are no games against AI", () => {
    const record = aiRecordFor(
      [rec([human("me", 0, true), human("foe", 1, false)], [])],
      "me",
      none,
      none,
    );
    expect(record.games).toBe(0);
    expect(record.rows).toEqual([]);
  });

  it("orders rows by games played, then name", () => {
    const records = [
      rec([human("me", 0, true)], [bot("Zed", 1)]),
      rec([human("me", 0, true)], [bot("Alpha", 1)]),
      rec([human("me", 0, true)], [bot("Zed", 1)]),
    ];
    const { rows } = aiRecordFor(records, "me", none, none);
    expect(rows.map((r) => r.ai)).toEqual(["Zed", "Alpha"]);
  });
});

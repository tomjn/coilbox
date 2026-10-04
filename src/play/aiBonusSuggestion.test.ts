import { describe, expect, it } from "vitest";
import type { StatAi, StatPlayer, StatRecord } from "@/content/bindings";
import { bonusSuggestionsFor, suggestAiBonus } from "./aiBonusSuggestion";
import { HANDICAP_TWEAKS } from "./debrief";
import type { Participant } from "./participants";

const GAME = "Beyond All Reason test-1";

let seq = 0;

function game(
  opts: {
    won?: boolean;
    ai?: Partial<StatAi>;
    gameType?: string;
    startTimeMs?: number;
    extraPlayers?: StatPlayer[];
    remixed?: boolean;
  } = {},
): StatRecord {
  seq += 1;
  const decided = "won" in opts ? opts.won !== undefined : true;
  const won = "won" in opts ? opts.won : true;
  return {
    filename: `g${seq}.sdfz`,
    path: `/demos/g${seq}.sdfz`,
    mapName: "Comet",
    gameType: opts.gameType ?? GAME,
    engineVersion: "105",
    durationSec: 600,
    startTimeMs: opts.startTimeMs ?? seq * 1000,
    sizeBytes: 1,
    modifiedMs: 1,
    winnersKnown: decided,
    winningAllyTeams: [0],
    remixed: opts.remixed ?? false,
    players: [
      { name: "me", allyTeam: 0, won, spectator: false },
      ...(opts.extraPlayers ?? []),
    ],
    ais: [{ name: "AI 1", shortName: "SimpleAI", allyTeam: 1, ...opts.ai }],
    statsKnown: false,
    teamTotals: [],
    ingestedAt: 0,
  };
}

const ask = (
  records: StatRecord[],
  over: Partial<Parameters<typeof suggestAiBonus>[0]> = {},
) =>
  suggestAiBonus({
    aiShortName: "SimpleAI",
    gameName: GAME,
    currentBonus: 0,
    me: "me",
    records,
    refights: new Set(),
    scripted: new Set(),
    ...over,
  });

const harder = Math.min(
  ...HANDICAP_TWEAKS.filter((t) => t.delta > 0).map((t) => t.delta),
);
const easier = Math.max(
  ...HANDICAP_TWEAKS.filter((t) => t.delta < 0).map((t) => t.delta),
);

describe("suggestAiBonus", () => {
  it("adds the smaller harder step after a win and names the replay", () => {
    const won = game({ won: true, ai: { advantage: 0.1 } });
    expect(ask([won])).toEqual({
      percent: 10 + harder,
      from: 10,
      result: "win",
      filename: won.filename,
    });
  });

  it("adds the easier step after a loss", () => {
    const lost = game({ won: false, ai: { advantage: 0.3 } });
    expect(ask([lost])).toEqual({
      percent: 30 + easier,
      from: 30,
      result: "loss",
      filename: lost.filename,
    });
  });

  it("reads a game with no bonus as 0", () => {
    expect(ask([game({ won: true })])?.from).toBe(0);
  });

  it("uses the newest game, wherever it sits in the list", () => {
    const old = game({ won: false, startTimeMs: 1, ai: { advantage: 0.5 } });
    const recent = game({ won: true, startTimeMs: 99, ai: { advantage: 0.1 } });
    expect(ask([recent, old])?.result).toBe("win");
    expect(ask([old, recent])?.from).toBe(10);
  });

  it("skips an undecided game and uses the older decided one", () => {
    const old = game({ won: false, startTimeMs: 1, ai: { advantage: 0.2 } });
    const undecided = game({ won: undefined, startTimeMs: 99 });
    expect(ask([undecided, old])).toMatchObject({
      result: "loss",
      from: 20,
      filename: old.filename,
    });
  });

  it("suggests nothing when the only game is undecided", () => {
    expect(ask([game({ won: undefined })])).toBeNull();
  });

  it("suggests nothing with no games", () => {
    expect(ask([])).toBeNull();
  });

  it("ignores a game against a different AI", () => {
    const other = game({ ai: { shortName: "BARb" } });
    expect(ask([other])).toBeNull();
  });

  it("ignores a game on a different game", () => {
    const other = game({ gameType: "Another Game 1.0" });
    expect(ask([other])).toBeNull();
  });

  it("does not count a game with a human opponent as well", () => {
    const mixed = game({
      extraPlayers: [
        { name: "foe", allyTeam: 1, won: false, spectator: false },
      ],
    });
    expect(ask([mixed])).toBeNull();
  });

  it("does not count a campaign, Conquest or Warpath replay", () => {
    const scripted = game();
    expect(
      ask([scripted], { scripted: new Set([scripted.filename]) }),
    ).toBeNull();
  });

  it("does not count a remix or refight", () => {
    const remix = game({ remixed: true });
    expect(ask([remix])).toBeNull();
    const refight = game();
    expect(
      ask([refight], { refights: new Set([refight.filename]) }),
    ).toBeNull();
  });

  it("suggests nothing when it equals the bonus already set", () => {
    const won = game({ won: true, ai: { advantage: 0.1 } });
    expect(ask([won], { currentBonus: 10 + harder })).toBeNull();
  });

  it("still suggests when the current bonus differs", () => {
    const won = game({ won: true, ai: { advantage: 0.1 } });
    expect(ask([won], { currentBonus: 5 })?.percent).toBe(10 + harder);
    expect(ask([won], { currentBonus: null })?.percent).toBe(10 + harder);
  });

  it("clamps at 100", () => {
    const won = game({ won: true, ai: { advantage: 0.95 } });
    expect(ask([won])?.percent).toBe(100);
  });

  it("suggests nothing when a win at 100 would suggest 100 again", () => {
    const won = game({ won: true, ai: { advantage: 1 } });
    expect(ask([won], { currentBonus: 100 })).toBeNull();
  });

  it("clamps at 0", () => {
    const lost = game({ won: false, ai: { advantage: 0.05 } });
    expect(ask([lost], { currentBonus: 5 })?.percent).toBe(0);
  });

  it("matches the same AI at two versions", () => {
    const v1 = game({
      won: false,
      startTimeMs: 1,
      ai: { version: "1.0", advantage: 0.2 },
    });
    const v2 = game({
      won: true,
      startTimeMs: 2,
      ai: { version: "2.0", advantage: 0.1 },
    });
    expect(ask([v1, v2])).toMatchObject({ result: "win", from: 10 });
    expect(ask([v2, v1], { aiShortName: "simpleai" })?.from).toBe(10);
  });

  it("suggests nothing when the last game had an income multiplier", () => {
    const odd = game({ ai: { incomeMultiplier: 2 } });
    expect(ask([odd])).toBeNull();
  });

  it("suggests nothing when two copies of the AI had different bonuses", () => {
    const r = game({ ai: { advantage: 0.1 } });
    r.ais.push({
      name: "AI 2",
      shortName: "SimpleAI",
      allyTeam: 2,
      advantage: 0.3,
    });
    expect(ask([r])).toBeNull();
  });
});

const you: Participant = {
  id: "you",
  kind: "you",
  name: "me",
  side: "",
  color: [1, 0, 0],
  allyTeam: 0,
  spectator: false,
};

const bot = (
  id: string,
  shortName: string,
  extra: Partial<Participant> = {},
): Participant => ({
  id,
  kind: "ai",
  name: id,
  ai: { kind: "native", shortName },
  side: "",
  color: [0, 0, 1],
  allyTeam: 1,
  spectator: false,
  ...extra,
});

const setup = (participants: Participant[], records: StatRecord[]) =>
  bonusSuggestionsFor({
    participants,
    gameName: GAME,
    records,
    refights: new Set(),
    scripted: new Set(),
  });

describe("bonusSuggestionsFor", () => {
  const won = game({ won: true });
  const wonBarb = game({ won: true, ai: { shortName: "BARb" } });

  it("gives one AI a suggestion on its own row", () => {
    const out = setup([you, bot("a", "SimpleAI")], [won]);
    expect(out.rows.a?.percent).toBe(harder);
    expect(out.all).toBeNull();
  });

  it("gives different AIs each their own row", () => {
    const out = setup(
      [you, bot("a", "SimpleAI"), bot("b", "BARb")],
      [won, wonBarb],
    );
    expect(Object.keys(out.rows).sort()).toEqual(["a", "b"]);
    expect(out.all).toBeNull();
  });

  it("puts two AIs of one kind in the footer, not on the rows", () => {
    const out = setup(
      [you, bot("a", "SimpleAI"), bot("b", "simpleai", { team: 5 })],
      [won],
    );
    expect(out.rows).toEqual({});
    expect(out.all?.percent).toBe(harder);
  });

  it("gives no footer suggestion when every AI already has it", () => {
    const out = setup(
      [
        you,
        bot("a", "SimpleAI", { handicap: harder }),
        bot("b", "SimpleAI", { handicap: harder, team: 5 }),
      ],
      [won],
    );
    expect(out).toEqual({ rows: {}, all: null });
  });

  it("keeps a row for each AI of a kind in a mixed setup, never the footer", () => {
    const out = setup(
      [
        you,
        bot("a", "SimpleAI", { team: 1 }),
        bot("b", "SimpleAI", { team: 2 }),
        bot("c", "BARb", { team: 3 }),
      ],
      [won],
    );
    expect(out.all).toBeNull();
    expect(Object.keys(out.rows).sort()).toEqual(["a", "b"]);
  });

  it("gives no suggestion to a row sharing a team", () => {
    const out = setup(
      [you, bot("a", "SimpleAI", { team: 1 }), bot("b", "BARb", { team: 1 })],
      [won, wonBarb],
    );
    expect(Object.keys(out.rows)).toEqual(["a"]);
  });

  it("gives nothing with no records, no AI or an open slot", () => {
    expect(setup([you, bot("a", "SimpleAI")], [])).toEqual({
      rows: {},
      all: null,
    });
    expect(setup([you], [won])).toEqual({ rows: {}, all: null });
    expect(
      setup([you, bot("a", "SimpleAI", { ai: undefined })], [won]).rows,
    ).toEqual({});
  });
});

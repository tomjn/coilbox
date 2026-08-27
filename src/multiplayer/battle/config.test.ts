import { describe, expect, it } from "vitest";
import type { Battle, BattleStatus, MemberStatus, Vote } from "../bindings";
import {
  aiShortNameFromDll,
  allyLetter,
  battleStartable,
  colorIntToHex,
  deriveSync,
  hexToColorInt,
  isAiUnavailable,
  type MemberRow,
  membersToRows,
  randomTeamColorHex,
  readableText,
  roomTakesBots,
  shouldNotifyVoteOpened,
  startPosTypeOf,
  usedColorsFromBattle,
} from "./config";

const status = (p: Partial<BattleStatus> = {}): BattleStatus => ({
  ready: false,
  teamId: 0,
  ally: 0,
  mode: true,
  handicap: 0,
  sync: 1,
  side: 0,
  ...p,
});

const member = (p: Partial<MemberStatus> = {}): MemberStatus => ({
  battleStatus: status(),
  teamColor: 0,
  scriptPassword: null,
  ...p,
});

function mkBattle(p: Partial<Battle> = {}): Battle {
  return {
    id: 1,
    tachyonId: null,
    host: "host",
    ip: "",
    port: "",
    natType: "0",
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
    mode: null,
    ...p,
  };
}

describe("teamColor codec (0xBBGGRR)", () => {
  it("decodes the low byte as red", () => {
    // Pure red = 0x0000FF in 0xBBGGRR.
    expect(colorIntToHex(0x0000ff)).toBe("#ff0000");
    // Pure blue = 0xFF0000 in 0xBBGGRR.
    expect(colorIntToHex(0xff0000)).toBe("#0000ff");
    // Pure green = 0x00FF00.
    expect(colorIntToHex(0x00ff00)).toBe("#00ff00");
  });

  it("round-trips hex -> int -> hex", () => {
    for (const hex of ["#ff0000", "#0000ff", "#123456", "#abcdef"]) {
      expect(colorIntToHex(hexToColorInt(hex))).toBe(hex);
    }
  });

  it("round-trips int -> hex -> int", () => {
    for (const c of [0x000000, 0xffffff, 0x123456, 0xab00cd]) {
      expect(hexToColorInt(colorIntToHex(c))).toBe(c);
    }
  });
});

describe("randomTeamColorHex", () => {
  it("returns a valid #rrggbb that survives the codec round-trip", () => {
    for (let i = 0; i < 50; i++) {
      const hex = randomTeamColorHex();
      expect(hex).toMatch(/^#[0-9a-f]{6}$/);
      // Must not be black — the whole point is escaping the teamColor-0 default.
      expect(hexToColorInt(hex)).not.toBe(0);
      expect(colorIntToHex(hexToColorInt(hex))).toBe(hex);
    }
  });
});

describe("allyLetter", () => {
  it("maps 0-based indices to A, B, C…", () => {
    expect(allyLetter(0)).toBe("A");
    expect(allyLetter(1)).toBe("B");
    expect(allyLetter(25)).toBe("Z");
  });
});

describe("readableText", () => {
  it("picks black on light colours and white on dark", () => {
    expect(readableText("#ffffff")).toBe("#000000");
    expect(readableText("#f5b342")).toBe("#000000"); // amber
    expect(readableText("#000000")).toBe("#ffffff");
    expect(readableText("#3f8cff")).toBe("#ffffff"); // blue
    expect(readableText("#e63d33")).toBe("#ffffff"); // red
  });
});

describe("startPosTypeOf", () => {
  it("reads game/startpostype from scriptTags", () => {
    expect(
      startPosTypeOf(mkBattle({ scriptTags: { "game/startpostype": "2" } })),
    ).toBe(2);
  });
  it("is case-insensitive on the tag key", () => {
    expect(
      startPosTypeOf(mkBattle({ scriptTags: { "GAME/StartPosType": "1" } })),
    ).toBe(1);
  });
  it("defaults to 0 (fixed) when absent or unparseable", () => {
    expect(startPosTypeOf(mkBattle())).toBe(0);
    expect(
      startPosTypeOf(mkBattle({ scriptTags: { "game/startpostype": "x" } })),
    ).toBe(0);
  });
});

describe("membersToRows", () => {
  it("puts the host first, then other humans, then bots", () => {
    const battle = mkBattle({
      host: "host",
      members: {
        zed: member(),
        host: member(),
        alice: member(),
      },
      bots: {
        BARb: {
          name: "BARb",
          owner: "host",
          aiDll: "BARb",
          battleStatus: status(),
          teamColor: 0x00ff00,
        },
      },
    });
    const rows = membersToRows(battle, "alice");
    expect(rows.map((r) => r.name)).toEqual(["host", "alice", "zed", "BARb"]);
    expect(rows.map((r) => r.kind)).toEqual(["human", "human", "human", "bot"]);
  });

  it("shows an autohost founder's row above ours", () => {
    // The reducer seats every founder, so a spectating autohost is a member like
    // any other and must appear even though it never joined explicitly.
    const battle = mkBattle({
      host: "sfhost1",
      members: {
        scarypoo: member(),
        sfhost1: member({ battleStatus: status({ mode: false }) }),
      },
    });
    const rows = membersToRows(battle, "scarypoo");
    expect(rows.map((r) => r.name)).toEqual(["sfhost1", "scarypoo"]);
    expect(rows[0].host).toBe(true);
    expect(rows[0].self).toBe(false);
    expect(rows[0].spectator).toBe(true);
  });

  it("marks the current user's row as self", () => {
    const battle = mkBattle({ members: { alice: member(), bob: member() } });
    const rows = membersToRows(battle, "bob");
    expect(rows.find((r) => r.self)?.name).toBe("bob");
    expect(rows.filter((r) => r.self)).toHaveLength(1);
  });

  it("carries decoded status and hex colour", () => {
    const battle = mkBattle({
      members: {
        alice: member({
          battleStatus: status({
            ready: true,
            ally: 1,
            teamId: 2,
            mode: false,
            sync: 2,
          }),
          teamColor: 0x0000ff,
        }),
      },
    });
    const [row] = membersToRows(battle, "alice");
    expect(row.ready).toBe(true);
    expect(row.ally).toBe(1);
    expect(row.teamId).toBe(2);
    expect(row.spectator).toBe(true);
    expect(row.sync).toBe(2);
    expect(row.colorHex).toBe("#ff0000");
  });

  it("enriches human rows with country + rank from the users map", () => {
    const battle = mkBattle({
      members: { alice: member() },
      bots: {
        BARb: {
          name: "BARb",
          owner: "alice",
          aiDll: "BARb",
          battleStatus: status(),
          teamColor: 0x00ff00,
        },
      },
    });
    const users = {
      alice: {
        name: "alice",
        country: "GB",
        userId: "1",
        agent: "coilbox",
        status: {
          ingame: false,
          away: false,
          rank: 4,
          access: false,
          bot: false,
        },
      },
    };
    const rows = membersToRows(battle, "alice", users);
    const alice = rows.find((r) => r.name === "alice");
    expect(alice?.country).toBe("GB");
    expect(alice?.rank).toBe(4);
    // Bots carry no country/rank.
    const bot = rows.find((r) => r.kind === "bot");
    expect(bot?.country).toBeUndefined();
    expect(bot?.rank).toBeUndefined();
  });

  it("leaves country/rank undefined when no users map is given", () => {
    const battle = mkBattle({ members: { alice: member() } });
    const [row] = membersToRows(battle, "alice");
    expect(row.country).toBeUndefined();
    expect(row.rank).toBeUndefined();
  });
});

describe("usedColorsFromBattle", () => {
  it("collects member + bot colours as hex, excluding self and dropping 0", () => {
    const battle = mkBattle({
      members: {
        me: member({ teamColor: 0x0000ff }), // self — excluded
        alice: member({ teamColor: 0x00ff00 }), // green
        bob: member({ teamColor: 0 }), // unset — dropped
      },
      bots: {
        BARb: {
          name: "BARb",
          owner: "me",
          aiDll: "BARb",
          battleStatus: status(),
          teamColor: 0xff0000, // blue in 0xBBGGRR
        },
      },
    });
    const used = usedColorsFromBattle(battle, "me");
    expect(used).toEqual(expect.arrayContaining(["#00ff00", "#0000ff"]));
    expect(used).not.toContain("#ff0000"); // that was self (0x0000ff -> #ff0000)
    expect(used).toHaveLength(2);
  });

  it("includes every member when self is null (host adding bots)", () => {
    const battle = mkBattle({
      members: { alice: member({ teamColor: 0x0000ff }) },
      bots: {},
    });
    expect(usedColorsFromBattle(battle, null)).toEqual(["#ff0000"]);
  });
});

describe("deriveSync", () => {
  it("errors when local map or game is missing", () => {
    const battle = mkBattle({ members: { alice: member() } });
    expect(deriveSync(battle, { mapMissing: true, gameMissing: false })).toBe(
      "error",
    );
    expect(deriveSync(battle, { mapMissing: false, gameMissing: true })).toBe(
      "error",
    );
  });

  it("errors when any present player is unsynced (sync=2)", () => {
    const battle = mkBattle({
      members: {
        alice: member({ battleStatus: status({ sync: 1 }) }),
        bob: member({ battleStatus: status({ sync: 2 }) }),
      },
    });
    expect(deriveSync(battle, { mapMissing: false, gameMissing: false })).toBe(
      "error",
    );
  });

  it("is pending when any player's sync is unknown (sync=0)", () => {
    const battle = mkBattle({
      members: {
        alice: member({ battleStatus: status({ sync: 1 }) }),
        bob: member({ battleStatus: status({ sync: 0 }) }),
      },
    });
    expect(deriveSync(battle, { mapMissing: false, gameMissing: false })).toBe(
      "pending",
    );
  });

  it("is synced when all present players are synced and content is present", () => {
    const battle = mkBattle({
      members: {
        alice: member({ battleStatus: status({ sync: 1 }) }),
        bob: member({ battleStatus: status({ sync: 1 }) }),
      },
    });
    expect(deriveSync(battle, { mapMissing: false, gameMissing: false })).toBe(
      "synced",
    );
  });

  it("ignores spectators' sync when deciding error/pending", () => {
    const battle = mkBattle({
      members: {
        alice: member({ battleStatus: status({ sync: 1, mode: true }) }),
        spec: member({ battleStatus: status({ sync: 2, mode: false }) }),
      },
    });
    expect(deriveSync(battle, { mapMissing: false, gameMissing: false })).toBe(
      "synced",
    );
  });
});

const row = (p: Partial<MemberRow> = {}): MemberRow => ({
  name: "x",
  kind: "human",
  self: false,
  host: false,
  boss: false,
  ready: false,
  sync: 1,
  spectator: false,
  teamId: 0,
  ally: 0,
  side: 0,
  colorHex: "#000000",
  ...p,
});

describe("battleStartable", () => {
  it("starts an all-bot match with the host spectating", () => {
    // The reported bug: host spectates, only bots play -> Start stayed disabled.
    expect(
      battleStartable([
        row({ kind: "human", host: true, spectator: true }),
        row({ kind: "bot", ready: true, ally: 0 }),
        row({ kind: "bot", ready: true, ally: 1 }),
      ]),
    ).toBe(true);
  });

  it("does not start an all-spectator room", () => {
    expect(
      battleStartable([
        row({ kind: "human", spectator: true }),
        row({ kind: "human", spectator: true }),
      ]),
    ).toBe(false);
  });

  it("does not start with no members", () => {
    expect(battleStartable([])).toBe(false);
  });

  it("blocks while a playing human is not ready", () => {
    expect(
      battleStartable([
        row({ kind: "human", spectator: false, ready: false }),
        row({ kind: "bot", ready: true }),
      ]),
    ).toBe(false);
  });

  it("starts when every playing human is ready", () => {
    expect(
      battleStartable([
        row({ kind: "human", spectator: false, ready: true }),
        row({ kind: "bot", ready: true }),
      ]),
    ).toBe(true);
  });

  it("ignores a non-ready spectating human", () => {
    expect(
      battleStartable([
        row({ kind: "human", spectator: true, ready: false }),
        row({ kind: "human", spectator: false, ready: true }),
      ]),
    ).toBe(true);
  });
});

describe("shouldNotifyVoteOpened", () => {
  const vote = (p: Partial<Vote> = {}): Vote => ({
    subject: "set map Red Comet",
    caller: "Bob",
    yes: 1,
    no: 0,
    yesNeeded: 3,
    noNeeded: 3,
    allowAbstain: true,
    endsAt: 0,
    ...p,
  });

  it("fires on the null -> set transition", () => {
    expect(shouldNotifyVoteOpened(null, vote())).toBe(true);
  });

  it("does not fire while there was never a vote", () => {
    expect(shouldNotifyVoteOpened(null, null)).toBe(false);
  });

  it("does not re-fire on a re-render with the same vote still open (tally ticking)", () => {
    const opened = vote({ yes: 1 });
    expect(shouldNotifyVoteOpened(opened, vote({ yes: 2 }))).toBe(false);
  });

  it("does not fire on the set -> null transition", () => {
    expect(shouldNotifyVoteOpened(vote(), null)).toBe(false);
  });

  it("fires again for a new distinct vote once the prior one has cleared", () => {
    // The caller resets its ref to null when currentVote clears, so the next
    // open is seen as a fresh null -> set transition.
    expect(shouldNotifyVoteOpened(null, vote({ subject: "set map DSD" }))).toBe(
      true,
    );
  });
});

describe("aiShortNameFromDll", () => {
  it("returns a bare shortName unchanged", () => {
    expect(aiShortNameFromDll("SimpleAI")).toBe("SimpleAI");
  });

  it("strips a leading numeric id prefix, keeping the shortName", () => {
    expect(aiShortNameFromDll("11772313 SimpleAI")).toBe("SimpleAI");
  });
});

describe("roomTakesBots", () => {
  // Upstream's `Process(UpdateBotStatus)` refuses a bot outside these two with
  // "Sorry, this room type does not support bots, please use cooperative or
  // custom", and the refusal arrives as a message box rather than as an error.
  it("takes bots in a custom or cooperative Zero-K room", () => {
    expect(roomTakesBots("custom")).toBe(true);
    expect(roomTakesBots("coop")).toBe(true);
  });

  it("refuses them in the room types the server refuses them in", () => {
    expect(roomTakesBots("teams")).toBe(false);
    expect(roomTakesBots("1v1")).toBe(false);
    expect(roomTakesBots("ffa")).toBe(false);
    expect(roomTakesBots("planetwars")).toBe(false);
  });

  it("takes bots where the protocol has no room type at all", () => {
    expect(roomTakesBots(null)).toBe(true);
  });
});

describe("isAiUnavailable", () => {
  const ais = [{ shortName: "SimpleAI" }, { shortName: "BARb" }];

  it("does not flag a valid shortName carrying an id prefix (#547)", () => {
    expect(isAiUnavailable("11772313 SimpleAI", ais, true)).toBe(false);
  });

  it("does not flag a valid bare shortName", () => {
    expect(isAiUnavailable("BARb", ais, true)).toBe(false);
  });

  it("flags a genuinely absent shortName", () => {
    expect(isAiUnavailable("SurvivalAI", ais, true)).toBe(true);
  });

  // Zero-K's Lua AIs are named "Chicken: Beginner" and the like, and the id
  // prefix rule above reduced that to "Beginner", which is nothing's name. So
  // every chicken added to a room was flagged as an AI the game does not have.
  it("does not flag a shortName that has a space in it", () => {
    const withSpaces = [
      { shortName: "Chicken: Beginner" },
      { shortName: "CAI" },
    ];
    expect(isAiUnavailable("Chicken: Beginner", withSpaces, true)).toBe(false);
  });

  it("still flags an absent AI whose name has a space in it", () => {
    expect(isAiUnavailable("Chicken: Suicidal", ais, true)).toBe(true);
  });

  it("does not flag while the addable list isn't ready yet (#531)", () => {
    expect(isAiUnavailable("SurvivalAI", [], false)).toBe(false);
  });

  it("does not flag a row with no aiDll", () => {
    expect(isAiUnavailable(undefined, ais, true)).toBe(false);
  });
});

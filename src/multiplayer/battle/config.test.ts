import { describe, expect, it } from "vitest";
import type { Battle, BattleStatus, MemberStatus } from "../bindings";
import {
  allyLetter,
  colorIntToHex,
  deriveSync,
  hexToColorInt,
  membersToRows,
  randomTeamColorHex,
  readableText,
  startPosTypeOf,
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
    host: "host",
    ip: "",
    port: "",
    map: "Map",
    maphash: "",
    modname: "Game",
    engine: "",
    version: "",
    maxPlayers: 8,
    passworded: false,
    locked: false,
    spectatorCount: 0,
    title: "Title",
    channel: null,
    members: {},
    bots: {},
    scriptTags: {},
    startRects: {},
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

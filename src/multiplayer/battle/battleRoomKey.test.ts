import { describe, expect, it } from "vitest";
import type { LobbyState } from "../bindings";
import { type Connections, newConnection } from "../connections";
import { battleRoomHref, battleRoomKey, inBattleKey } from "./battleRoomKey";

const A = "alice@server-a:8200";
const B = "alice@server-b:8200";

function entry(key: string, currentBattle: number | null, live = true) {
  const c = newConnection(key);
  return {
    ...c,
    live,
    mirror: {
      ...c.mirror,
      state: { currentBattle, battles: {} } as unknown as LobbyState,
    },
  };
}

function conns(...entries: ReturnType<typeof entry>[]): Connections {
  return Object.fromEntries(entries.map((e) => [e.serverKey, e]));
}

describe("battleRoomHref", () => {
  it("names the server a battle is on", () => {
    expect(battleRoomHref(A)).toBe("/battle?server=alice%40server-a%3A8200");
  });

  it("is the bare route with no server", () => {
    expect(battleRoomHref(null)).toBe("/battle");
    expect(battleRoomHref()).toBe("/battle");
  });
});

describe("inBattleKey", () => {
  it("is the focused connection when that one is in a battle", () => {
    expect(inBattleKey(conns(entry(A, 1), entry(B, 2)), B)).toBe(B);
  });

  it("finds a battle on a connection that is not focused", () => {
    expect(inBattleKey(conns(entry(A, 3), entry(B, null)), B)).toBe(A);
  });

  it("is null when no connection is in a battle", () => {
    expect(inBattleKey(conns(entry(A, null), entry(B, null)), A)).toBe(null);
  });

  // A dropped connection keeps its last mirror, battle and all, but the player
  // is not in that battle any more.
  it("ignores a connection that has dropped", () => {
    expect(inBattleKey(conns(entry(A, 3, false)), null)).toBe(null);
  });
});

describe("battleRoomKey", () => {
  it("opens the server the link named", () => {
    expect(battleRoomKey(conns(entry(A, 1), entry(B, 2)), A, B)).toBe(B);
  });

  it("keeps a named server that has gone, rather than showing another", () => {
    expect(battleRoomKey(conns(entry(A, 1)), A, B)).toBe(B);
  });

  // Old links, and the nav item, carry no server.
  it("opens the battle the player is in when the link names no server", () => {
    expect(battleRoomKey(conns(entry(A, null), entry(B, 4)), A, null)).toBe(B);
  });

  it("falls back to the focused connection when there is no battle", () => {
    expect(battleRoomKey(conns(entry(A, null)), A, null)).toBe(A);
  });
});

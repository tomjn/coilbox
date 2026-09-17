// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";
import type { LobbyState } from "../bindings";
import { type Connections, newConnection } from "../connections";
import { leaveAndLabel, leavesBattleNotice, otherBattleKey } from "./oneBattle";

const A = "alice@server-a:8200";
const B = "alice@server-b:8200";

function conns(battles: Record<string, number | null>): Connections {
  return Object.fromEntries(
    Object.entries(battles).map(([key, currentBattle]) => {
      const c = newConnection(key);
      return [
        key,
        {
          ...c,
          live: true,
          mirror: {
            ...c.mirror,
            state: { currentBattle } as unknown as LobbyState,
          },
        },
      ];
    }),
  );
}

describe("otherBattleKey", () => {
  it("names the other server the player is in a battle on", () => {
    expect(otherBattleKey(conns({ [A]: 3, [B]: null }), A, B)).toBe(A);
  });

  // The list refuses a second battle on the same server by itself.
  it("says nothing about a battle on the same server", () => {
    expect(otherBattleKey(conns({ [A]: 3, [B]: null }), A, A)).toBe(null);
  });

  it("says nothing when the player is in no battle", () => {
    expect(otherBattleKey(conns({ [A]: null, [B]: null }), A, B)).toBe(null);
  });

  it("says nothing with no target connection", () => {
    expect(otherBattleKey(conns({ [A]: 3 }), A, null)).toBe(null);
  });
});

describe("the one-battle wording", () => {
  it("names the server whose battle is left", () => {
    expect(leavesBattleNotice("BAR", "join")).toBe(
      "You are in a battle on BAR. Joining this one leaves it.",
    );
    expect(leavesBattleNotice("BAR", "host")).toBe(
      "You are in a battle on BAR. Hosting a battle here leaves it.",
    );
    expect(leavesBattleNotice("BAR", "create")).toBe(
      "You are in a battle on BAR. Creating a lobby here leaves it.",
    );
  });

  it("labels the confirming button with what it does", () => {
    expect(leaveAndLabel("join")).toBe("Leave and join");
    expect(leaveAndLabel("host")).toBe("Leave and host");
    expect(leaveAndLabel("create")).toBe("Leave and create");
  });
});

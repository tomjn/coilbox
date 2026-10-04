import { describe, expect, it } from "vitest";
import type { LobbyState } from "./bindings";
import { mergeFriends } from "./friendsAcrossServers";

const A = "me@alpha:8200";
const B = "me@beta:8200";

type UserSpec = { ingame?: boolean; away?: boolean };

function state(opts: {
  users?: Record<string, UserSpec>;
  friends?: string[];
  battles?: Record<
    string,
    { id: number; title: string; host: string; members: string[] }
  >;
}): LobbyState {
  const users: Record<string, unknown> = {};
  for (const [name, s] of Object.entries(opts.users ?? {})) {
    users[name] = {
      status: { ingame: s.ingame ?? false, away: s.away ?? false },
    };
  }
  const battles: Record<string, unknown> = {};
  for (const [id, b] of Object.entries(opts.battles ?? {})) {
    battles[id] = {
      id: b.id,
      title: b.title,
      host: b.host,
      members: Object.fromEntries(b.members.map((m) => [m, {}])),
    };
  }
  return {
    users,
    battles,
    friends: opts.friends ?? [],
  } as unknown as LobbyState;
}

describe("mergeFriends", () => {
  it("returns nothing when there are no friends", () => {
    expect(mergeFriends({}, {})).toEqual([]);
  });

  it("sorts online friends before offline ones", () => {
    const rows = mergeFriends(
      { [A]: ["amy", "zed"] },
      { [A]: state({ users: { zed: {} } }) },
    );
    expect(rows.map((r) => [r.name, r.status])).toEqual([
      ["zed", "online"],
      ["amy", "offline"],
    ]);
  });

  it("puts every non-offline presence ahead of offline, then sorts by name", () => {
    const rows = mergeFriends(
      { [A]: ["dee", "cat", "bob", "amy"] },
      {
        [A]: state({
          users: { dee: { away: true }, cat: { ingame: true }, bob: {} },
        }),
      },
    );
    expect(rows.map((r) => r.name)).toEqual(["bob", "cat", "dee", "amy"]);
  });

  it("says which battle a friend is in, whether host or member", () => {
    const rows = mergeFriends(
      { [A]: ["hostie", "joiner"] },
      {
        [A]: state({
          users: { hostie: {}, joiner: {} },
          battles: {
            "7": {
              id: 7,
              title: "Big one",
              host: "hostie",
              members: ["joiner"],
            },
          },
        }),
      },
    );
    expect(rows.map((r) => [r.name, r.status, r.battle])).toEqual([
      ["hostie", "inBattle", { id: 7, title: "Big one" }],
      ["joiner", "inBattle", { id: 7, title: "Big one" }],
    ]);
  });

  it("keeps the battle for a friend who is in-game in it", () => {
    const rows = mergeFriends(
      { [A]: ["gamer"] },
      {
        [A]: state({
          users: { gamer: { ingame: true } },
          battles: {
            "3": { id: 3, title: "Match", host: "x", members: ["gamer"] },
          },
        }),
      },
    );
    expect(rows[0].status).toBe("ingame");
    expect(rows[0].battle).toEqual({ id: 3, title: "Match" });
  });

  it("gives a friend who is not in a battle no battle", () => {
    const rows = mergeFriends(
      { [A]: ["amy"] },
      { [A]: state({ users: { amy: {} } }) },
    );
    expect(rows[0].battle).toBeNull();
  });

  it("lists friends on a server that is not connected as unknown, not offline", () => {
    const rows = mergeFriends({ [B]: ["amy"] }, {});
    expect(rows).toEqual([
      {
        serverKey: B,
        name: "amy",
        status: "unknown",
        battle: null,
        serverFriend: false,
      },
    ]);
  });

  it("sorts unknown after offline", () => {
    const rows = mergeFriends(
      { [A]: ["off"], [B]: ["lost"] },
      { [A]: state({}) },
    );
    expect(rows.map((r) => [r.name, r.status])).toEqual([
      ["off", "offline"],
      ["lost", "unknown"],
    ]);
  });

  it("keeps the same name on two servers as two rows", () => {
    const rows = mergeFriends(
      { [A]: ["amy"], [B]: ["amy"] },
      { [A]: state({ users: { amy: {} } }), [B]: state({}) },
    );
    expect(rows.map((r) => [r.serverKey, r.name, r.status])).toEqual([
      [A, "amy", "online"],
      [B, "amy", "offline"],
    ]);
  });

  it("adds server friends on a connected server and flags them", () => {
    const rows = mergeFriends(
      { [A]: ["amy"] },
      { [A]: state({ friends: ["amy", "bob"], users: { bob: {} } }) },
    );
    expect(rows.map((r) => [r.name, r.serverFriend])).toEqual([
      ["bob", true],
      ["amy", true],
    ]);
  });

  it("includes a connected server that has only server friends and no favourites", () => {
    const rows = mergeFriends({}, { [A]: state({ friends: ["bob"] }) });
    expect(rows.map((r) => r.name)).toEqual(["bob"]);
  });

  it("counts a name once when it is both a favourite and a server friend", () => {
    const rows = mergeFriends(
      { [A]: ["amy"] },
      { [A]: state({ friends: ["amy"] }) },
    );
    expect(rows).toHaveLength(1);
  });

  it("breaks a name tie by server key so the order is stable", () => {
    const rows = mergeFriends(
      { [B]: ["amy"], [A]: ["amy"] },
      { [A]: state({}), [B]: state({}) },
    );
    expect(rows.map((r) => r.serverKey)).toEqual([A, B]);
  });

  it("sorts names without regard to case", () => {
    const rows = mergeFriends(
      { [A]: ["bob", "Amy"] },
      { [A]: state({ users: { bob: {}, Amy: {} } }) },
    );
    expect(rows.map((r) => r.name)).toEqual(["Amy", "bob"]);
  });
});

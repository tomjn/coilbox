import { describe, expect, it } from "vitest";
import type { Battle } from "../bindings";
import { friendBattles } from "./friendBattles";

function battle(id: number, over: Partial<Battle> = {}): Battle {
  return {
    id,
    host: `host${id}`,
    title: `Battle ${id}`,
    passworded: false,
    locked: false,
    inProgress: false,
    members: {},
    ...over,
  } as unknown as Battle;
}

const amy = new Set(["amy"]);

describe("friendBattles", () => {
  it("lists only battles with a friend in them", () => {
    const found = friendBattles([
      {
        serverKey: "a",
        battles: [battle(1), battle(2, { members: { amy: {} } as never })],
        users: undefined,
        friends: amy,
      },
    ]);
    expect(found.map((f) => f.battle.id)).toEqual([2]);
    expect(found[0].names).toBe("amy");
  });

  it("matches a battle against its own connection's friends only", () => {
    const found = friendBattles([
      {
        serverKey: "a",
        battles: [battle(1, { host: "amy" })],
        users: {},
        friends: new Set(),
      },
      {
        serverKey: "b",
        battles: [battle(1, { host: "amy" })],
        users: {},
        friends: amy,
      },
    ]);
    expect(found.map((f) => f.serverKey)).toEqual(["b"]);
  });

  it("orders open, passworded, locked, then running, across connections", () => {
    const found = friendBattles([
      {
        serverKey: "a",
        battles: [
          battle(1, { host: "amy", inProgress: true }),
          battle(2, { host: "amy", locked: true, passworded: true }),
        ],
        users: {},
        friends: amy,
      },
      {
        serverKey: "b",
        battles: [
          battle(3, { host: "amy", passworded: true }),
          battle(4, { host: "amy" }),
        ],
        users: {},
        friends: amy,
      },
    ]);
    expect(found.map((f) => f.group)).toEqual([
      "open",
      "passworded",
      "locked",
      "running",
    ]);
    expect(found.map((f) => f.battle.id)).toEqual([4, 3, 2, 1]);
  });

  it("counts a battle as running when its host is in a game", () => {
    const found = friendBattles([
      {
        serverKey: "a",
        battles: [battle(1, { host: "amy" })],
        users: { amy: { status: { ingame: true } } },
        friends: amy,
      },
    ]);
    expect(found[0].group).toBe("running");
  });

  it("puts the battle with more friends first inside a group", () => {
    const found = friendBattles([
      {
        serverKey: "a",
        battles: [
          battle(1, { title: "A", host: "amy" }),
          battle(2, { title: "B", host: "bob", members: { cat: {} } as never }),
        ],
        users: {},
        friends: new Set(["amy", "bob", "cat"]),
      },
    ]);
    expect(found.map((f) => f.battle.id)).toEqual([2, 1]);
  });
});

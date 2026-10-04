import { describe, expect, it } from "vitest";
import { friendsInBattles } from "./friendsInBattles";

const battle = (id: number, host: string, members: string[]) => ({
  id,
  host,
  members: Object.fromEntries(members.map((m) => [m, {}])),
});

describe("friendsInBattles", () => {
  it("names the friends in each battle, host or member, in name order", () => {
    const found = friendsInBattles(
      [battle(1, "zed", ["amy", "stranger"]), battle(2, "nobody", ["x"])],
      new Set(["zed", "amy", "elsewhere"]),
    );
    expect(found.get(1)).toBe("amy, zed");
    expect(found.has(2)).toBe(false);
  });

  it("finds nothing when there are no friends", () => {
    expect(friendsInBattles([battle(1, "h", ["a"])], new Set()).size).toBe(0);
  });
});

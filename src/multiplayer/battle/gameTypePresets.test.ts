import { describe, expect, it } from "vitest";
import {
  balanceLayout,
  currentAllyCount,
  gameTypeLayout,
  layoutToForceCommand,
} from "./gameTypePresets";

describe("gameTypeLayout", () => {
  it("splits team into two alternating allies", () => {
    expect(gameTypeLayout("team", ["a", "b", "c", "d"])).toEqual([
      { name: "a", ally: 0, teamId: 0 },
      { name: "c", ally: 0, teamId: 1 },
      { name: "b", ally: 1, teamId: 2 },
      { name: "d", ally: 1, teamId: 3 },
    ]);
  });

  it("gives every ffa player their own ally", () => {
    expect(gameTypeLayout("ffa", ["a", "b", "c"])).toEqual([
      { name: "a", ally: 0, teamId: 0 },
      { name: "b", ally: 1, teamId: 1 },
      { name: "c", ally: 2, teamId: 2 },
    ]);
  });

  it("puts everyone on one ally for coop", () => {
    expect(gameTypeLayout("coop", ["a", "b", "c"])).toEqual([
      { name: "a", ally: 0, teamId: 0 },
      { name: "b", ally: 0, teamId: 1 },
      { name: "c", ally: 0, teamId: 2 },
    ]);
  });

  it("seats only the first two players for duel, leaving the rest untouched", () => {
    expect(gameTypeLayout("duel", ["a", "b", "c"])).toEqual([
      { name: "a", ally: 0, teamId: 0 },
      { name: "b", ally: 1, teamId: 1 },
    ]);
  });

  it("reuses duel's layout for tourney", () => {
    expect(gameTypeLayout("tourney", ["a", "b", "c"])).toEqual(
      gameTypeLayout("duel", ["a", "b", "c"]),
    );
  });

  it("produces nothing for an empty roster", () => {
    expect(gameTypeLayout("team", [])).toEqual([]);
    expect(gameTypeLayout("ffa", [])).toEqual([]);
    expect(gameTypeLayout("coop", [])).toEqual([]);
    expect(gameTypeLayout("duel", [])).toEqual([]);
  });
});

describe("balanceLayout", () => {
  it("round-robins across the requested ally count and fixes ids", () => {
    expect(balanceLayout(["a", "b", "c", "d"], 2)).toEqual([
      { name: "a", ally: 0, teamId: 0 },
      { name: "c", ally: 0, teamId: 1 },
      { name: "b", ally: 1, teamId: 2 },
      { name: "d", ally: 1, teamId: 3 },
    ]);
  });

  it("clamps below 2 up to 2 allies", () => {
    expect(balanceLayout(["a", "b"], 1)).toEqual([
      { name: "a", ally: 0, teamId: 0 },
      { name: "b", ally: 1, teamId: 1 },
    ]);
  });

  it("clamps ally count down to the player count", () => {
    expect(balanceLayout(["a"], 5)).toEqual([
      { name: "a", ally: 0, teamId: 0 },
    ]);
  });

  it("produces nothing for an empty roster", () => {
    expect(balanceLayout([], 2)).toEqual([]);
  });
});

describe("currentAllyCount", () => {
  it("counts distinct allies", () => {
    expect(currentAllyCount([0, 1, 0, 2])).toBe(3);
  });

  it("is zero for no players", () => {
    expect(currentAllyCount([])).toBe(0);
  });
});

describe("layoutToForceCommand", () => {
  it("builds one paren group per ally in ascending order", () => {
    expect(
      layoutToForceCommand([
        { name: "a", ally: 0, teamId: 0 },
        { name: "c", ally: 0, teamId: 1 },
        { name: "b", ally: 1, teamId: 2 },
      ]),
    ).toBe("!force * (a,c)(b)");
  });

  it("returns null for an empty layout", () => {
    expect(layoutToForceCommand([])).toBeNull();
  });
});

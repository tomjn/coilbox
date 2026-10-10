import { describe, expect, it } from "vitest";
import { gamesLabel, recordCounts } from "./matchupFormat";

describe("recordCounts", () => {
  it("shows a small sample as a count, with no percentage", () => {
    expect(recordCounts({ games: 3, decided: 3, wins: 2 })).toBe("2 of 3 won");
    expect(recordCounts({ games: 1, decided: 1, wins: 0 })).toBe("0 of 1 won");
  });

  it("never contains a percentage", () => {
    expect(recordCounts({ games: 40, decided: 38, wins: 19 })).not.toContain(
      "%",
    );
  });

  it("names games with no recorded result", () => {
    expect(recordCounts({ games: 4, decided: 3, wins: 1 })).toBe(
      "1 of 3 won, 1 with no recorded result",
    );
    expect(recordCounts({ games: 2, decided: 0, wins: 0 })).toBe(
      "no recorded result in 2 games",
    );
  });

  it("handles no games", () => {
    expect(recordCounts({ games: 0, decided: 0, wins: 0 })).toBe("no games");
  });
});

describe("gamesLabel", () => {
  it("pluralises", () => {
    expect(gamesLabel(1)).toBe("1 game");
    expect(gamesLabel(2)).toBe("2 games");
  });
});

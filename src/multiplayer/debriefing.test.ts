/**
 * The words a Zero-K debriefing turns into (issue #2003).
 *
 * The one rule everything here follows: a null rating change means the game
 * counted toward no rating, never that it was rated and moved nothing. Rust has
 * already turned the server's placeholders into nulls, so the wording only has
 * to keep the two apart rather than work out which is which.
 */

import { describe, expect, it } from "vitest";
import type { Debriefing, DebriefingPlayer } from "./bindings";
import {
  categoryLabel,
  formatRatingChange,
  headline,
  rankMove,
  rankName,
  teams,
} from "./debriefing";

function player(over: Partial<DebriefingPlayer> = {}): DebriefingPlayer {
  return {
    name: "someone",
    ally: 0,
    won: false,
    ratingChange: null,
    rating: null,
    rank: 0,
    rankedUp: false,
    rankedDown: false,
    nextRankRating: null,
    prevRankRating: null,
    xpChange: 0,
    xp: 0,
    awards: [],
    ...over,
  };
}

function report(over: Partial<Debriefing> = {}): Debriefing {
  return {
    battleId: 42,
    url: null,
    message: null,
    ratingCategory: null,
    chatChannel: null,
    players: [],
    ...over,
  };
}

describe("naming the rating a game counted toward", () => {
  // The server sends its own enum member name, which reads oddly as it stands.
  it("tidies the two the server spells as one word", () => {
    expect(categoryLabel("MatchMaking")).toBe("Matchmaking");
    expect(categoryLabel("Planetwars")).toBe("Planet Wars");
  });

  it("leaves a category it has not heard of in the server's words", () => {
    expect(categoryLabel("Casual")).toBe("Casual");
    expect(categoryLabel("Ladder")).toBe("Ladder");
  });

  it("calls a game that counted toward nothing unrated", () => {
    expect(categoryLabel(null)).toBe("Unrated");
  });
});

describe("a rating change", () => {
  it("carries its sign, so a gain reads as one", () => {
    expect(formatRatingChange(7)).toBe("+7");
    expect(formatRatingChange(-5)).toBe("-5");
  });

  // True, and a different statement from showing nothing at all.
  it("says zero on a rated game that moved nobody", () => {
    expect(formatRatingChange(0)).toBe("0");
  });

  it("is nothing at all where the game counted toward no rating", () => {
    expect(formatRatingChange(null)).toBeNull();
  });
});

describe("the headline", () => {
  // The rating change leads because it is the part the player cannot work out
  // for themselves. They already know whether they won.
  it("leads with what the game did to the reader's rating", () => {
    expect(
      headline(
        report({ ratingCategory: "MatchMaking" }),
        player({ won: true, ratingChange: 7 }),
      ),
    ).toBe("Won, +7 matchmaking");
  });

  it("says a game counted toward no rating rather than showing a zero", () => {
    expect(headline(report(), player({ won: false }))).toBe(
      "Lost, and it counted toward no rating",
    );
  });

  // A game the server would not count sends the reason and nobody at all.
  it("falls back to the server's own words when we are not in it", () => {
    expect(
      headline(report({ message: "Cheats were enabled" }), undefined),
    ).toBe("Cheats were enabled");
  });

  it("still says something when there is nobody and no message", () => {
    expect(headline(report(), undefined)).toBe("The game has finished");
  });
});

describe("a rank that moved", () => {
  // The server sends the rank they are at now, so a promotion names where they
  // arrived.
  it("names where a promotion landed them", () => {
    expect(rankMove(player({ rank: 6, rankedUp: true }))).toBe(
      "Promoted to Neutron Star",
    );
  });

  it("names where a demotion left them", () => {
    expect(rankMove(player({ rank: 2, rankedDown: true }))).toBe(
      "Dropped to Red Dwarf",
    );
  });

  it("says nothing where the rank held", () => {
    expect(rankMove(player({ rank: 3 }))).toBeNull();
  });

  // Zero-K has eight ranks and `Ranks.ValidateRank` refuses anything else.
  it("has no name for a rank Zero-K does not have", () => {
    expect(rankName(8)).toBeNull();
    expect(rankName(0)).toBe("Nebulous");
    expect(rankName(7)).toBe("Singularity");
  });
});

describe("grouping the players by side", () => {
  it("keeps the order Rust sorted them into", () => {
    const grouped = teams([
      player({ name: "beth", ally: 0 }),
      player({ name: "zoe", ally: 0 }),
      player({ name: "adam", ally: 1, won: true }),
    ]);

    expect(grouped.map((team) => team.ally)).toEqual([0, 1]);
    expect(grouped[0].players.map((p) => p.name)).toEqual(["beth", "zoe"]);
    expect(grouped[0].won).toBe(false);
    expect(grouped[1].won).toBe(true);
  });

  // The server marks every member of the winning team, so one marked player is
  // enough to call the side.
  it("counts a side as winning when anybody on it did", () => {
    const grouped = teams([
      player({ name: "beth", ally: 0, won: true }),
      player({ name: "zoe", ally: 0, won: false }),
    ]);
    expect(grouped[0].won).toBe(true);
  });
});

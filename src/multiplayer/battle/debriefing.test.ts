import { describe, expect, it } from "vitest";
import type { Debriefing } from "../bindings";
import {
  debriefingHeadline,
  debriefingNotice,
  debriefingRank,
  debriefingRating,
  debriefingXp,
} from "./debriefing";

function debriefing(over: Partial<Debriefing> = {}): Debriefing {
  return {
    serverBattleId: 1580342,
    ratingCategory: "MatchMaking",
    won: true,
    eloChange: 12,
    newElo: 1662,
    newRank: 4,
    rankUp: false,
    rankDown: false,
    prevRankElo: 1600,
    nextRankElo: 1800,
    xpChange: 230,
    newXp: 41230,
    chatChannel: "debriefing_1580342",
    url: "https://zero-k.info/Battles/Detail/1580342",
    message: null,
    ...over,
  };
}

describe("the headline of a debriefing", () => {
  it("says whether the match was won", () => {
    expect(debriefingHeadline(debriefing({ won: true }))).toBe("You won");
    expect(debriefingHeadline(debriefing({ won: false }))).toBe("You lost");
  });
});

describe("what the match did to the rating", () => {
  // The category is the whole point: Zero-K keeps two ratings and a player who
  // is told "1662, up 12" without being told which one has been told nothing
  // they can use.
  it("names the rating that moved, not just the number", () => {
    expect(debriefingRating(debriefing())).toBe(
      "Matchmaking rating 1662, up 12",
    );
  });

  it("counts a loss down rather than up by a negative", () => {
    expect(debriefingRating(debriefing({ eloChange: -12, newElo: 1638 }))).toBe(
      "Matchmaking rating 1638, down 12",
    );
  });

  it("says a rating stood still rather than moving by nothing", () => {
    expect(debriefingRating(debriefing({ eloChange: 0 }))).toBe(
      "Matchmaking rating 1662, unchanged",
    );
  });

  it("gives the casual rating its own name", () => {
    expect(debriefingRating(debriefing({ ratingCategory: "Casual" }))).toBe(
      "Casual rating 1662, up 12",
    );
  });

  // Most Zero-K games are custom games. Saying "Unrated rating 1662" would be
  // worse than saying nothing, and 1662 did not move.
  it("has no rating to report for a game that counted toward none", () => {
    expect(
      debriefingRating(
        debriefing({ ratingCategory: "Unrated", eloChange: 0, newElo: 0 }),
      ),
    ).toBe(null);
  });

  // A category the server adds after this was written. Better its own word than
  // a number nobody can name.
  it("passes on a category it has never heard of", () => {
    expect(debriefingRating(debriefing({ ratingCategory: "Planetwars" }))).toBe(
      "Planetwars rating 1662, up 12",
    );
  });
});

describe("the rank a match left somebody on", () => {
  // Upstream's own names, from `Ranks.RankNames`. A rank is a percentile
  // standing among active players rather than a rating band, so the number the
  // server sent is the only honest source for it.
  it("names the rank in Zero-K's own words", () => {
    expect(debriefingRank(debriefing({ newRank: 4 }))).toBe("Giant");
    expect(debriefingRank(debriefing({ newRank: 0 }))).toBe("Nebulous");
    expect(debriefingRank(debriefing({ newRank: 7 }))).toBe("Singularity");
  });

  it("says when the match moved somebody up or down one", () => {
    expect(debriefingRank(debriefing({ newRank: 4, rankUp: true }))).toBe(
      "Promoted to Giant",
    );
    expect(debriefingRank(debriefing({ newRank: 3, rankDown: true }))).toBe(
      "Dropped to Subgiant",
    );
  });

  // An unrated game moves nobody's rank, and the field arrives as 0, which is a
  // real rank. Naming it would tell a Singularity they are Nebulous.
  it("says nothing about a rank a rated game did not decide", () => {
    expect(debriefingRank(debriefing({ ratingCategory: "Unrated" }))).toBe(
      null,
    );
  });
});

describe("the result as a notification", () => {
  // For the player whose room closed at the end of the game, which leaves the
  // panel nowhere to draw and the result unread.
  it("carries the result and the rating in two lines", () => {
    expect(debriefingNotice(debriefing())).toEqual({
      title: "You won",
      body: "Matchmaking rating 1662, up 12",
    });
  });

  // "You lost" with nothing under it reads as a rating drop that was left
  // unsaid, so the unrated case says so rather than saying nothing.
  it("answers the rating question even when the answer is none", () => {
    expect(
      debriefingNotice(debriefing({ won: false, ratingCategory: "Unrated" })),
    ).toEqual({
      title: "You lost",
      body: "This game counted toward no rating.",
    });
  });
});

describe("the experience a match earned", () => {
  it("counts experience apart from the rating, because it is not skill", () => {
    expect(debriefingXp(debriefing())).toBe("230 experience, 41230 in total");
  });

  // Experience is earned for playing, so an unrated game still pays it.
  it("reports experience from an unrated game too", () => {
    expect(debriefingXp(debriefing({ ratingCategory: "Unrated" }))).toBe(
      "230 experience, 41230 in total",
    );
  });

  it("says nothing when a match earned none", () => {
    expect(debriefingXp(debriefing({ xpChange: 0 }))).toBe(null);
  });
});

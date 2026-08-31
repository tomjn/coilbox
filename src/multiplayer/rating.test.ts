import { describe, expect, it } from "vitest";
import type { Rating } from "./bindings";
import { ratingParts, ratingSummary } from "./rating";

function rating(over: Partial<Rating> = {}): Rating {
  return { casual: null, matchmaking: null, overall: null, ...over };
}

describe("the ratings a server sent", () => {
  // The normal case on two of the three protocols, and the whole point of the
  // shape: a player nobody rated shows nothing rather than a zero or a dash.
  it("has nothing to say about a player nobody rated", () => {
    expect(ratingParts(rating())).toEqual([]);
    expect(ratingSummary(rating())).toBe(null);
  });

  it("says nothing at all when there is no record to read", () => {
    expect(ratingParts(undefined)).toEqual([]);
  });

  // Zero-K's two are both live and mean different things, so both are kept and
  // both are named. Casual leads because most rooms in the list are custom
  // battles, which is what it counts toward.
  it("keeps Zero-K's two apart and leads with the one a custom battle counts", () => {
    expect(ratingParts(rating({ casual: 1650, matchmaking: 1720 }))).toEqual([
      { label: "Casual", value: 1650 },
      { label: "Matchmaking", value: 1720 },
    ]);
  });

  it("names a matchmaking rating even when it is the only one", () => {
    expect(ratingParts(rating({ matchmaking: 1720 }))).toEqual([
      { label: "Matchmaking", value: 1720 },
    ]);
  });

  // Tachyon carries one number and no category, so the label claims none.
  it("leaves an uncategorised rating uncategorised", () => {
    expect(ratingParts(rating({ overall: 25 }))).toEqual([
      { label: "Rating", value: 25 },
    ]);
  });

  // What a reader gets on hover, where there is room to name what each number
  // is. The inline badge shows one of them and cannot say which.
  it("reads out every rating it has, named", () => {
    expect(ratingSummary(rating({ casual: 1650, matchmaking: 1720 }))).toBe(
      "Casual 1650, matchmaking 1720",
    );
  });

  it("reads out a single rating without a list", () => {
    expect(ratingSummary(rating({ overall: 25 }))).toBe("Rating 25");
  });
});

// @vitest-environment happy-dom

/**
 * The rating as a roster reads it (issue #2002).
 *
 * `ratingParts` proves which numbers there are and what they are called. What
 * it cannot prove is the rule that matters on screen: coilbox talks to three
 * kinds of server and only one of them rates anybody, so the common case is a
 * player with no rating, and that has to draw nothing at all. A badge that drew
 * itself empty would put a stray gap in every row of every roster on Beyond All
 * Reason.
 */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { Rating } from "./bindings";
import { RatingBadge } from "./UserBadges";

function rating(over: Partial<Rating> = {}): Rating {
  return { casual: null, matchmaking: null, overall: null, ...over };
}

afterEach(cleanup);

describe("the rating badge", () => {
  it("draws nothing for a player the server said nothing about", () => {
    render(<RatingBadge rating={rating()} />);
    expect(document.body.textContent).toBe("");
  });

  it("draws nothing when there is no record at all, as for a bot", () => {
    render(<RatingBadge rating={undefined} />);
    expect(document.body.textContent).toBe("");
  });

  // The number a custom battle counts toward, which is what most rooms are.
  it("shows the casual rating of a Zero-K player", () => {
    render(
      <RatingBadge rating={rating({ casual: 1650, matchmaking: 1720 })} />,
    );
    expect(screen.getByText("1650")).toBeTruthy();
  });

  // One number on screen and two in the record, so the label has to say which
  // is which. Without it the row shows a figure nobody can name.
  it("names both of them to anybody who asks", () => {
    render(
      <RatingBadge rating={rating({ casual: 1650, matchmaking: 1720 })} />,
    );
    expect(screen.getByRole("img").getAttribute("aria-label")).toBe(
      "Casual 1650, matchmaking 1720",
    );
  });
});

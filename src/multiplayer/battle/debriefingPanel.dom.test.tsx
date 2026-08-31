// @vitest-environment happy-dom

/**
 * The match result as the battle room shows it (issue #2003).
 *
 * The wording has its own tests. What those cannot cover is the rule the panel
 * itself carries: it is one strip that has to hold four different facts without
 * inventing any of them, and the case it gets wrong most easily is the common
 * one, a custom game that counted toward nothing.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { Debriefing } from "../bindings";
import { DebriefingPanel } from "./DebriefingPanel";
import { forgetDebriefing, recordDebriefing } from "./debriefing";

function debriefing(over: Partial<Debriefing> = {}): Debriefing {
  return {
    serverBattleId: 1580342,
    ratingCategory: "MatchMaking",
    won: true,
    eloChange: 12,
    newElo: 1662,
    newRank: 4,
    rankUp: true,
    rankDown: false,
    prevRankElo: 1600,
    nextRankElo: 1800,
    xpChange: 230,
    newXp: 41230,
    chatChannel: "debriefing_1580342",
    url: null,
    message: null,
    ...over,
  };
}

afterEach(() => {
  cleanup();
  forgetDebriefing();
});

describe("the match result strip", () => {
  // Nothing has finished, so there is nothing to draw. The element and not only
  // its words, because an empty strip would put a bordered bar under the header
  // of every battle room anybody walks into.
  it("draws nothing until a match has finished", () => {
    render(<DebriefingPanel />);
    expect(document.body.textContent).toBe("");
  });

  it("says what the match did, in one strip", () => {
    recordDebriefing(debriefing());
    render(<DebriefingPanel />);

    expect(screen.getByText("You won")).toBeTruthy();
    expect(
      screen.getByText(
        "Matchmaking rating 1662, up 12. Promoted to Giant. 230 experience, 41230 in total",
      ),
    ).toBeTruthy();
  });

  // The common case. A custom game moves nothing, and a strip that fell silent
  // about the rating would leave the reader wondering whether it had moved.
  it("says a game counted toward nothing rather than leaving a gap", () => {
    recordDebriefing(
      debriefing({
        ratingCategory: "Unrated",
        won: false,
        rankUp: false,
        xpChange: 0,
      }),
    );
    render(<DebriefingPanel />);

    expect(screen.getByText("You lost")).toBeTruthy();
    expect(
      screen.getByText("This game counted toward no rating."),
    ).toBeTruthy();
  });

  // It arrives while somebody is reading the roster of the room they are still
  // sitting in, so it has to be heard as well as seen.
  it("says it out loud", () => {
    recordDebriefing(debriefing());
    render(<DebriefingPanel />);
    expect(screen.getByRole("status").textContent).toContain("You won");
  });

  // A result is news. Once it has been read it is in the way of the room.
  it("goes away when it has been read", () => {
    recordDebriefing(debriefing());
    render(<DebriefingPanel />);

    fireEvent.click(screen.getByLabelText("Dismiss the match result"));

    expect(document.body.textContent).toBe("");
  });
});

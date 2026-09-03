// @vitest-environment happy-dom

/**
 * The match result as a player reads it (issue #2003).
 *
 * `debriefing.test.ts` proves the wording. What it cannot prove is what reaches
 * the screen, and the case that matters most is a game that counted toward no
 * rating: the server sends one of those with a full set of placeholder numbers
 * on it, so a drawer that drew them would tell everybody their rating moved by
 * nothing when in fact it did not move at all.
 *
 * The drawer is always mounted, because it slides rather than appears, so the
 * shut case is proved by what a screen reader can reach rather than by what is
 * in the document.
 *
 * Every render goes through a memory router (issue #2406): the drawer's link
 * to the debriefing channel calls `useNavigate`, which throws outside one. The
 * `/chat` route is a probe that renders the search string it was reached with,
 * so a test can read the address off the screen rather than reaching into the
 * router's internals.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import {
  createMemoryRouter,
  RouterProvider,
  useSearchParams,
} from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Debriefing, DebriefingPlayer } from "./bindings";
import { DebriefingDrawer } from "./DebriefingDrawer";

vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: vi.fn(() => Promise.resolve()),
}));

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
    battleId: 1234567,
    url: null,
    message: null,
    ratingCategory: null,
    chatChannel: null,
    players: [],
    ...over,
  };
}

/** A rated game the reader won, which is the case the whole issue is about. */
function rated(): Debriefing {
  return report({
    ratingCategory: "MatchMaking",
    url: "https://zero-k.info/Battles/Detail/1234567",
    chatChannel: "debriefing_1234567",
    players: [
      player({
        name: "me",
        ally: 0,
        won: true,
        ratingChange: 7,
        rating: 1672,
        rank: 6,
        rankedUp: true,
        nextRankRating: 1800,
        xpChange: 120,
        xp: 9000,
        awards: [{ key: "mostDamage", description: "Most damage dealt" }],
      }),
      player({ name: "them", ally: 1, ratingChange: -7, rating: 1601 }),
    ],
  });
}

/** Stands in for `ChatPage` at `/chat`: shows the search string it was
 * reached with, which is all a test needs to prove the drawer's button sent
 * it to the right conversation. */
function ChatProbe() {
  const [params] = useSearchParams();
  return <p>Chat page opened on {params.toString()}</p>;
}

function renderDrawer(props: {
  open: boolean;
  report: Debriefing | null;
  myUsername: string | null;
  onClose: () => void;
}) {
  const router = createMemoryRouter(
    [
      { path: "/", element: <DebriefingDrawer {...props} /> },
      { path: "/chat", element: <ChatProbe /> },
    ],
    { initialEntries: ["/"] },
  );
  render(<RouterProvider router={router} />);
  return router;
}

afterEach(cleanup);

describe("the match result drawer", () => {
  it("puts the rating change in the headline", () => {
    renderDrawer({
      open: true,
      report: rated(),
      myUsername: "me",
      onClose: () => {},
    });
    expect(screen.getByText("Won, +7 matchmaking")).toBeTruthy();
  });

  it("shows what the game did to everybody else's rating too", () => {
    renderDrawer({
      open: true,
      report: rated(),
      myUsername: "me",
      onClose: () => {},
    });
    expect(screen.getByText("them")).toBeTruthy();
    expect(screen.getByText("-7")).toBeTruthy();
  });

  it("names the rank the game promoted the reader to", () => {
    renderDrawer({
      open: true,
      report: rated(),
      myUsername: "me",
      onClose: () => {},
    });
    expect(screen.getByText("Promoted to Neutron Star")).toBeTruthy();
  });

  it("names the chat channel the server put everybody in", () => {
    renderDrawer({
      open: true,
      report: rated(),
      myUsername: "me",
      onClose: () => {},
    });
    expect(
      screen.getByText(/debriefing_1234567, which is in your chat list/),
    ).toBeTruthy();
  });

  // The case the placeholders would ruin. An unrated game arrives with a zero
  // change on every row, and Rust has already turned that into nothing, so
  // nothing is what has to reach the screen.
  it("shows no rating figures at all on a game that counted toward none", () => {
    const unrated = report({
      players: [player({ name: "me", ally: 0, xpChange: 40, xp: 500 })],
    });
    renderDrawer({
      open: true,
      report: unrated,
      myUsername: "me",
      onClose: () => {},
    });

    expect(
      screen.getByText("Lost, and it counted toward no rating"),
    ).toBeTruthy();
    expect(screen.queryByText("0")).toBeNull();
    // Experience goes up for playing rather than for winning, so it is the one
    // number that did move.
    expect(screen.getByText(/\+40/)).toBeTruthy();
  });

  // A game the server would not count sends the reason and nobody at all.
  it("shows the server's own reason for a game it would not count", () => {
    renderDrawer({
      open: true,
      report: report({ message: "Cheats were enabled during this game" }),
      myUsername: "me",
      onClose: () => {},
    });
    expect(
      screen.getAllByText("Cheats were enabled during this game").length,
    ).toBeGreaterThan(0);
  });

  // It slides rather than appears, so it is in the document either way. What
  // decides whether anybody can reach it is `inert`.
  it("is out of reach while it is shut", () => {
    renderDrawer({
      open: false,
      report: rated(),
      myUsername: "me",
      onClose: () => {},
    });
    const drawer = document.querySelector('aside[aria-label="Match result"]');
    expect(drawer?.hasAttribute("inert")).toBe(true);
  });

  it("stays out of reach when there is no result to show", () => {
    renderDrawer({
      open: true,
      report: null,
      myUsername: "me",
      onClose: () => {},
    });
    const drawer = document.querySelector('aside[aria-label="Match result"]');
    expect(drawer?.hasAttribute("inert")).toBe(true);
  });

  // The button this issue (#2406) adds: there was previously no way to reach
  // the channel the drawer names.
  it("sends the reader to the debriefing channel it names", () => {
    const onClose = vi.fn();
    renderDrawer({ open: true, report: rated(), myUsername: "me", onClose });
    fireEvent.click(screen.getByText("Open chat"));
    expect(
      screen.getByText("Chat page opened on channel=debriefing_1234567"),
    ).toBeTruthy();
    // Closes the drawer on the way, so it doesn't sit open over the page it
    // just sent the reader to.
    expect(onClose).toHaveBeenCalled();
  });

  it("has no chat button when the server sent no channel", () => {
    renderDrawer({
      open: true,
      report: report({ message: "Cheats were enabled during this game" }),
      myUsername: "me",
      onClose: () => {},
    });
    expect(screen.queryByText("Open chat")).toBeNull();
  });
});

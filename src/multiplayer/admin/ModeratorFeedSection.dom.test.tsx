// @vitest-environment happy-dom

/**
 * The staff activity feed on the Server admin page (issue #2779): ChanServ's
 * own announcements out of `#moderator`, read from the connection's own chat
 * state. Parsing itself (every announcement shape, the unparsed fallback,
 * and the filter that keeps only ChanServ's lines) is covered exhaustively
 * in `moderatorFeed.test.ts`. This covers what the section does with that:
 * rendering rows with working player links, the empty state, and keeping
 * one connection's `#moderator` out of another's feed.
 */

import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ChatMsg, LobbyState } from "../bindings";

const KEY_A = "mod@uber.example:8200";
const KEY_B = "mod2@other.example:8200";

const wire = vi.hoisted(() => ({
  connections: {} as Record<string, { mirror: { state: LobbyState | null } }>,
}));

vi.mock("../store", () => ({
  useConnection: (serverKey: string | null) =>
    serverKey ? (wire.connections[serverKey] ?? null) : null,
}));

import { ModeratorFeedSection } from "./ModeratorFeedSection";

function msg(from: string, text: string, at = 1_718_200_000_000): ChatMsg {
  return { channel: "moderator", from, text, kind: "said", at, id: null };
}

function stateWithModerator(messages: ChatMsg[]): LobbyState {
  return {
    channels: {
      moderator: {
        name: "moderator",
        topic: null,
        users: [],
        messages,
        founder: null,
        operators: [],
      },
    },
  } as unknown as LobbyState;
}

function draw(serverKey: string) {
  render(
    <MemoryRouter>
      <ModeratorFeedSection serverKey={serverKey} />
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
  wire.connections = {};
});

describe("no announcements yet", () => {
  it("shows an empty state honest about how far back it goes", () => {
    wire.connections[KEY_A] = { mirror: { state: stateWithModerator([]) } };
    draw(KEY_A);
    expect(screen.getByText(/No staff actions yet this session/)).toBeTruthy();
    expect(
      screen.getByText(/does not keep\s+history on this server by default/),
    ).toBeTruthy();
  });

  it("shows the empty state when #moderator has not been joined yet", () => {
    wire.connections[KEY_A] = { mirror: { state: stateWithModerator([]) } };
    wire.connections[KEY_A].mirror.state = {
      channels: {},
    } as unknown as LobbyState;
    draw(KEY_A);
    expect(screen.getByText(/No staff actions yet this session/)).toBeTruthy();
  });
});

describe("a parsed announcement", () => {
  it("renders a BAN row with the time and player links to the lookup", () => {
    wire.connections[KEY_A] = {
      mirror: {
        state: stateWithModerator([
          msg("ChanServ", "Alice banned <Bob> for 7 days (spamming #main)"),
        ]),
      },
    };
    draw(KEY_A);

    const actorLink = screen.getByRole("link", { name: "Alice" });
    expect(actorLink.getAttribute("href")).toBe(
      `/admin?server=${encodeURIComponent(KEY_A)}&player=Alice`,
    );
    const targetLink = screen.getByRole("link", { name: "Bob" });
    expect(targetLink.getAttribute("href")).toBe(
      `/admin?server=${encodeURIComponent(KEY_A)}&player=Bob`,
    );
    expect(screen.getByText(/for 7 days \(spamming #main\)/)).toBeTruthy();
  });
});

describe("an unparsed ChanServ line", () => {
  it("still shows as a plain row instead of vanishing", () => {
    wire.connections[KEY_A] = {
      mirror: {
        state: stateWithModerator([
          msg("ChanServ", "New: Newbie 203.0.113.9 GB"),
        ]),
      },
    };
    draw(KEY_A);
    expect(screen.getByText("New: Newbie 203.0.113.9 GB")).toBeTruthy();
  });
});

describe("staff chat in #moderator", () => {
  it("is excluded from the feed, only ChanServ's own lines show", () => {
    wire.connections[KEY_A] = {
      mirror: {
        state: stateWithModerator([
          msg("Alice", "watching this one closely"),
          msg("ChanServ", "Alice unbanned <Bob>"),
        ]),
      },
    };
    draw(KEY_A);
    expect(screen.queryByText("watching this one closely")).toBeNull();
    expect(screen.getByText(/unbanned/)).toBeTruthy();
  });
});

describe("two connections", () => {
  it("does not let one connection's #moderator leak into another's feed", () => {
    wire.connections[KEY_A] = {
      mirror: {
        state: stateWithModerator([
          msg("ChanServ", "Alice banned <Bob> for 7 days (spam)"),
        ]),
      },
    };
    wire.connections[KEY_B] = {
      mirror: {
        state: stateWithModerator([
          msg("ChanServ", "Carol banned <Dave> for 1 days (evasion)"),
        ]),
      },
    };

    draw(KEY_A);
    expect(screen.getByRole("link", { name: "Alice" })).toBeTruthy();
    expect(screen.queryByText(/Carol banned/)).toBeNull();
    cleanup();

    draw(KEY_B);
    expect(screen.getByRole("link", { name: "Carol" })).toBeTruthy();
    expect(screen.queryByText(/Alice banned/)).toBeNull();
  });
});

describe("the link to Chat", () => {
  it("points at #moderator on this connection", () => {
    wire.connections[KEY_A] = { mirror: { state: stateWithModerator([]) } };
    draw(KEY_A);
    const link = screen.getByRole("link", { name: "Open #moderator in Chat" });
    expect(link.getAttribute("href")).toBe(
      `/chat?channel=moderator&server=${encodeURIComponent(KEY_A)}`,
    );
  });
});

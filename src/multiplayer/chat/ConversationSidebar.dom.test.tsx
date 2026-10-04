// @vitest-environment happy-dom

/**
 * The chat sidebar grouped by connection (issue #2843). Two live connections
 * each get a heading naming the account and server they belong to, so a
 * `#main` on one server and a `#main` on another never read as the same
 * room. With one connection there is nothing to distinguish, so the sidebar
 * has to look exactly as it always has: no heading at all.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LobbyState } from "../bindings";
import { ConversationSidebar } from "./ConversationSidebar";

vi.mock("@picoframe/frame", () => ({
  Button: (props: Record<string, unknown>) => (
    <button type="button" {...props} />
  ),
  Input: (props: Record<string, unknown>) => <input {...props} />,
  cn: (...classes: unknown[]) => classes.filter(Boolean).join(" "),
  useSetting: <T,>(key: string, initial: T): [T, () => void] => [
    key === "multiplayer.favourites" ? (wire.favourites as T) : initial,
    () => {},
  ],
}));

vi.mock("../../notify/notify", () => ({ notify: async () => {} }));

vi.mock("../bindings", () => ({
  mpJoinBattle: (args: unknown) => {
    wire.joins.push(args);
    return Promise.resolve();
  },
  mpAcceptFriendRequest: async () => ({}),
  mpDeclineFriendRequest: async () => ({}),
  mpFriendRequest: async () => ({}),
  mpUnfriend: async () => ({}),
  mpListChannels: async () => ({}),
}));

const KEY_A = "AF@bar.example:8200";
const KEY_B = "Zeta@techa.example:8200";

const wire = vi.hoisted(() => ({
  joins: [] as unknown[],
  favourites: {} as Record<string, string[]>,
  connections: {} as Record<
    string,
    {
      serverKey: string;
      live: boolean;
      mirror: { phase: string; state: unknown };
    }
  >,
}));

vi.mock("../store", () => ({
  useMultiplayer: () => ({
    connections: wire.connections,
    unreadFor: () => 0,
    busy: false,
    clearJoinError: () => {},
  }),
  useConnection: (serverKey: string | null) =>
    serverKey ? (wire.connections[serverKey] ?? null) : null,
  useProtocolServers: () => [],
  usernameFromKey: (serverKey: string) => serverKey.split("@")[0],
  serverNameFor: (serverKey: string) => serverKey.split("@")[1],
}));

function emptyState(username: string): LobbyState {
  return {
    myUsername: username,
    channels: {},
    dms: {},
    users: {},
    battles: {},
    currentBattle: null,
    friends: [],
    friendRequests: [],
    party: null,
    partyInvites: [],
  } as unknown as LobbyState;
}

function connectionFor(
  serverKey: string,
  live = true,
  patch: Partial<LobbyState> = {},
) {
  return {
    serverKey,
    live,
    mirror: {
      phase: "ready",
      state: { ...emptyState(serverKey.split("@")[0]), ...patch },
    },
  };
}

function renderSidebar() {
  render(
    <MemoryRouter>
      <ConversationSidebar
        active={null}
        onSelect={() => {}}
        onBrowse={() => {}}
      />
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
  wire.connections = {};
  wire.favourites = {};
  wire.joins = [];
});

describe("ConversationSidebar: grouped by connection", () => {
  it("shows no connection heading with a single live connection, unchanged from before #2843", () => {
    wire.connections = { [KEY_A]: connectionFor(KEY_A) };
    renderSidebar();

    expect(screen.queryByText(/^AF on /)).toBeNull();
    // The rest of the sidebar renders exactly as the single-connection page
    // always has.
    expect(screen.getByText("Channels")).toBeTruthy();
    expect(screen.getByText("Direct messages")).toBeTruthy();
  });

  it("heads each live connection with its account and server name once there are two", () => {
    wire.connections = {
      [KEY_A]: connectionFor(KEY_A),
      [KEY_B]: connectionFor(KEY_B),
    };
    renderSidebar();

    expect(screen.getByText("AF on bar.example:8200")).toBeTruthy();
    expect(screen.getByText("Zeta on techa.example:8200")).toBeTruthy();
    // Two connections mean two independent Channels sections, one per group.
    expect(screen.getAllByText("Channels").length).toBe(2);
  });

  it("skips a connection that has dropped, not just one that never opened", () => {
    wire.connections = {
      [KEY_A]: connectionFor(KEY_A, true),
      [KEY_B]: connectionFor(KEY_B, false),
    };
    renderSidebar();

    expect(screen.queryByText(/on techa.example/)).toBeNull();
    expect(screen.getAllByText("Channels").length).toBe(1);
  });
});

describe("ConversationSidebar: friends across servers (#3380)", () => {
  const online = { status: { ingame: false, away: false } };

  it("has no all-servers list while friends sit on one server", () => {
    wire.favourites = { [KEY_A]: ["amy"] };
    wire.connections = { [KEY_A]: connectionFor(KEY_A) };
    renderSidebar();

    expect(screen.queryByText("All friends")).toBeNull();
  });

  it("lists friends from two connected servers with the server on each row, online first", () => {
    wire.favourites = { [KEY_A]: ["amy"], [KEY_B]: ["bob"] };
    wire.connections = {
      [KEY_A]: connectionFor(KEY_A),
      [KEY_B]: connectionFor(KEY_B, true, {
        users: { bob: online } as unknown as LobbyState["users"],
      }),
    };
    renderSidebar();

    expect(screen.getByText("All friends")).toBeTruthy();
    const rows = screen
      .getByText("All friends")
      .closest("div[data-state], div")
      ?.parentElement?.querySelectorAll("li");
    const text = [...(rows ?? [])].map((li) => li.textContent);
    expect(text).toEqual(["bobtecha.example:8200", "amybar.example:8200"]);
  });

  it("says which battle a friend is in", () => {
    wire.favourites = { [KEY_A]: ["amy"], [KEY_B]: ["bob"] };
    wire.connections = {
      [KEY_A]: connectionFor(KEY_A),
      [KEY_B]: connectionFor(KEY_B, true, {
        users: { bob: online } as unknown as LobbyState["users"],
        battles: {
          "4": { id: 4, title: "Skirmish", host: "bob", members: {} },
        } as unknown as LobbyState["battles"],
      }),
    };
    renderSidebar();

    expect(
      screen.getByText("techa.example:8200 \u00b7 In Skirmish"),
    ).toBeTruthy();
  });

  it("shows a friend on a server that is not connected as unknown and does not open it", () => {
    wire.favourites = { [KEY_A]: ["amy"], [KEY_B]: ["bob"] };
    wire.connections = {
      [KEY_A]: connectionFor(KEY_A),
      [KEY_B]: connectionFor(KEY_B, false),
    };
    renderSidebar();

    const dot = screen.getByTitle("Unknown, not connected");
    const button = dot.closest("button");
    expect(button?.disabled).toBe(true);
    // amy, on the live server, is offline rather than unknown.
    expect(screen.getAllByTitle("Offline").length).toBeGreaterThan(0);
  });

  it("keeps the same name on two servers as two rows", () => {
    wire.favourites = { [KEY_A]: ["amy"], [KEY_B]: ["amy"] };
    wire.connections = {
      [KEY_A]: connectionFor(KEY_A),
      [KEY_B]: connectionFor(KEY_B),
    };
    renderSidebar();

    expect(screen.getByText("bar.example:8200")).toBeTruthy();
    expect(screen.getByText("techa.example:8200")).toBeTruthy();
  });
});

describe("ConversationSidebar: join or watch a friend's battle (#3381)", () => {
  const online = { status: { ingame: false, away: false } };
  const ingame = { status: { ingame: true, away: false } };

  function friendInBattle(
    battle: Record<string, unknown> = {},
    host: typeof online = online,
  ) {
    wire.favourites = { [KEY_A]: ["amy"] };
    wire.connections = {
      [KEY_A]: connectionFor(KEY_A, true, {
        users: {
          amy: { name: "amy", ...host },
          hostie: { name: "hostie", ...host },
        } as unknown as LobbyState["users"],
        battles: {
          "4": {
            id: 4,
            title: "Skirmish",
            host: "hostie",
            members: { amy: {} },
            passworded: false,
            locked: false,
            maxPlayers: 8,
            playerCount: null,
            inProgress: false,
            ...battle,
          },
        } as unknown as LobbyState["battles"],
      }),
    };
  }

  beforeEach(() => {
    wire.joins = [];
  });

  it("joins the battle through the battle list's join when Join is pressed", () => {
    friendInBattle();
    renderSidebar();

    fireEvent.click(screen.getByRole("button", { name: "Join Skirmish" }));
    return vi.waitFor(() =>
      expect(wire.joins).toMatchObject([{ serverKey: KEY_A, id: 4 }]),
    );
  });

  it("offers Watch for a running game", () => {
    friendInBattle({}, ingame);
    renderSidebar();

    expect(screen.getByRole("button", { name: "Watch Skirmish" })).toBeTruthy();
  });

  it("says Locked and cannot be pressed for a locked battle", () => {
    friendInBattle({ locked: true });
    renderSidebar();

    const button = screen.getByRole("button", {
      name: "Locked Skirmish",
    }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });

  it("says Full and cannot be pressed for a full battle", () => {
    friendInBattle({ maxPlayers: 2 });
    renderSidebar();

    const button = screen.getByRole("button", {
      name: "Full Skirmish",
    }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });

  it("asks for the password instead of joining at once", async () => {
    friendInBattle({ passworded: true });
    renderSidebar();

    fireEvent.click(screen.getByRole("button", { name: "Join" }));
    expect(await screen.findByPlaceholderText("Battle password")).toBeTruthy();
    expect(wire.joins).toEqual([]);
  });

  it("offers nothing for a friend who is in no battle", () => {
    wire.favourites = { [KEY_A]: ["amy"] };
    wire.connections = {
      [KEY_A]: connectionFor(KEY_A, true, {
        users: {
          amy: { name: "amy", ...online },
        } as unknown as LobbyState["users"],
      }),
    };
    renderSidebar();

    expect(screen.queryByRole("button", { name: /^(Join|Watch)/ })).toBeNull();
  });

  it("offers nothing on a row for a server that is not connected", () => {
    wire.favourites = { [KEY_A]: ["amy"], [KEY_B]: ["bob"] };
    wire.connections = {
      [KEY_A]: connectionFor(KEY_A),
      [KEY_B]: connectionFor(KEY_B, false),
    };
    renderSidebar();

    expect(screen.queryByRole("button", { name: /^(Join|Watch)/ })).toBeNull();
  });

  it("puts the button on the all-servers row as well", () => {
    wire.favourites = { [KEY_A]: ["amy"], [KEY_B]: ["bob"] };
    wire.connections = {
      [KEY_A]: connectionFor(KEY_A, true, {
        users: {
          amy: { name: "amy", ...online },
          hostie: { name: "hostie", ...online },
        } as unknown as LobbyState["users"],
        battles: {
          "4": {
            id: 4,
            title: "Skirmish",
            host: "hostie",
            members: { amy: {} },
            passworded: false,
            locked: false,
            maxPlayers: 8,
            playerCount: null,
            inProgress: false,
          },
        } as unknown as LobbyState["battles"],
      }),
      [KEY_B]: connectionFor(KEY_B, false),
    };
    renderSidebar();

    // One in the server's own Friends section, one in All friends.
    expect(
      screen.getAllByRole("button", { name: "Join Skirmish" }).length,
    ).toBe(2);
  });
});

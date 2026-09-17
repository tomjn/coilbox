// @vitest-environment happy-dom

/**
 * The chat sidebar grouped by connection (issue #2843). Two live connections
 * each get a heading naming the account and server they belong to, so a
 * `#main` on one server and a `#main` on another never read as the same
 * room. With one connection there is nothing to distinguish, so the sidebar
 * has to look exactly as it always has: no heading at all.
 */

import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LobbyState } from "../bindings";
import { ConversationSidebar } from "./ConversationSidebar";

vi.mock("@picoframe/frame", () => ({
  Button: (props: Record<string, unknown>) => (
    <button type="button" {...props} />
  ),
  Input: (props: Record<string, unknown>) => <input {...props} />,
  cn: (...classes: unknown[]) => classes.filter(Boolean).join(" "),
  useSetting: <T,>(_key: string, initial: T): [T, () => void] => [
    initial,
    () => {},
  ],
}));

vi.mock("../bindings", () => ({
  mpAcceptFriendRequest: async () => ({}),
  mpDeclineFriendRequest: async () => ({}),
  mpFriendRequest: async () => ({}),
  mpUnfriend: async () => ({}),
  mpListChannels: async () => ({}),
}));

const KEY_A = "AF@bar.example:8200";
const KEY_B = "Zeta@techa.example:8200";

const wire = vi.hoisted(() => ({
  connections: {} as Record<
    string,
    { serverKey: string; live: boolean; mirror: { state: unknown } }
  >,
}));

vi.mock("../store", () => ({
  useMultiplayer: () => ({ connections: wire.connections, unreadFor: () => 0 }),
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

function connectionFor(serverKey: string, live = true) {
  return {
    serverKey,
    live,
    mirror: { state: emptyState(serverKey.split("@")[0]) },
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

// @vitest-environment happy-dom

/**
 * The lobby-servers settings page opening the protocol console from a
 * particular account's row (issue #2847). The console used to always show
 * the app's one focused connection. It now opens on the connection whose row
 * was clicked, so a second login's "Open protocol console" button reaches
 * its own console rather than the other account's.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));

const lsBindings = vi.hoisted(() => ({
  lsGetCredential: vi.fn(async () => ({ secret: null })),
  lsStoreCredential: vi.fn(async () => ({})),
  lsDeleteCredential: vi.fn(async () => ({})),
}));
vi.mock("../bindings", () => lsBindings);

vi.mock("../../multiplayer/bindings", () => ({
  mpTachyonSignOut: vi.fn(async () => ({})),
}));

const openedConsoleFor = vi.hoisted(() => vi.fn());
vi.mock("../../multiplayer/ConsoleDrawer", () => ({
  ConsoleDrawer: ({
    open,
    serverKey,
  }: {
    open: boolean;
    serverKey?: string | null;
  }) => {
    if (open) openedConsoleFor(serverKey);
    return null;
  },
}));
vi.mock("../RegisterForm", () => ({ RegisterForm: () => null }));
vi.mock("../PasswordRecoveryForm", () => ({
  PasswordRecoveryForm: () => null,
}));
vi.mock("./components/AutojoinChannels", () => ({
  AutojoinChannels: () => null,
}));

const SRV1 = {
  id: "srv1",
  name: "Test Server",
  host: "test.example",
  port: 8200,
  tls: false,
  allowSelfSigned: false,
};

function keyFor(username: string) {
  return `${username}@${SRV1.host}:${SRV1.port}`;
}

const settings: Record<string, unknown> = {
  "lobbyServers.accounts": {
    accounts: [
      { id: "1", serverId: SRV1.id, username: "alice", hasSecret: true },
      { id: "2", serverId: SRV1.id, username: "bob", hasSecret: true },
    ],
  },
  "lobbyServers.servers": { servers: [SRV1] },
};

vi.mock("@picoframe/frame", async () => ({
  ...(await vi.importActual<Record<string, unknown>>("@picoframe/frame")),
  useSetting: (key: string, initial: unknown) => [
    key in settings ? settings[key] : initial,
    () => {},
  ],
}));

interface ConnEntry {
  serverKey: string;
  live: boolean;
  mirror: { state: { users: Record<string, unknown> } | null };
}

let connections: Record<string, ConnEntry> = {};

vi.mock("../../multiplayer/store", () => ({
  serverKeyFor: (server: { host: string; port: number }, username: string) =>
    `${username}@${server.host}:${server.port}`,
  useConnection: (key: string | null) =>
    key ? (connections[key] ?? null) : null,
  useMultiplayer: () => ({
    signIn: vi.fn(async () => {}),
    busyKeys: new Set<string>(),
  }),
}));

import LobbyServersSettings from "./SettingsSection";

function connectionFor(key: string): ConnEntry {
  return { serverKey: key, live: true, mirror: { state: { users: {} } } };
}

beforeEach(() => {
  connections = {
    [keyFor("alice")]: connectionFor(keyFor("alice")),
    [keyFor("bob")]: connectionFor(keyFor("bob")),
  };
  openedConsoleFor.mockClear();
});

afterEach(() => {
  cleanup();
});

function openAccountRow(username: string) {
  const el = screen.getByText(username);
  const button = el.closest("button");
  if (!button) throw new Error(`no row button for ${username}`);
  fireEvent.click(button);
}

it("opens the console on the account whose row was clicked", () => {
  render(<LobbyServersSettings />);

  openAccountRow("bob");
  fireEvent.click(
    screen.getByRole("button", { name: "Open protocol console" }),
  );
  expect(openedConsoleFor).toHaveBeenCalledWith(keyFor("bob"));
});

it("opens the console on a different account's row without carrying over the last one", () => {
  render(<LobbyServersSettings />);

  openAccountRow("alice");
  fireEvent.click(
    screen.getByRole("button", { name: "Open protocol console" }),
  );
  expect(openedConsoleFor).toHaveBeenLastCalledWith(keyFor("alice"));
});

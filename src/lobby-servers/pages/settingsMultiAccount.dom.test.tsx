// @vitest-environment happy-dom

/**
 * The lobby-servers settings page with more than one connected account
 * (issue #2846). Every saved login gets its own "Connected" badge rather
 * than only the one the app happens to focus, and an account command in
 * flight (Tachyon sign-in) greys out only its own login's controls.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const { openUrl } = vi.hoisted(() => ({
  openUrl: vi.fn(async (_url: string) => {}),
}));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl }));

const lsBindings = vi.hoisted(() => ({
  lsGetCredential: vi.fn(async () => ({ secret: null })),
  lsStoreCredential: vi.fn(async () => ({})),
  lsDeleteCredential: vi.fn(async () => ({})),
}));
vi.mock("../bindings", () => lsBindings);

const mpBindings = vi.hoisted(() => ({
  mpTachyonSignOut: vi.fn(async () => ({})),
}));
vi.mock("../../multiplayer/bindings", () => mpBindings);

// Irrelevant to badge/busy scoping and heavy to stand up for real.
vi.mock("../../multiplayer/ConsoleDrawer", () => ({
  ConsoleDrawer: () => null,
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
const SRV2 = {
  id: "srv2",
  name: "Tachyon Server",
  host: "tachyon.example",
  port: 443,
  tls: true,
  allowSelfSigned: false,
  protocol: "tachyon" as const,
};

function keyFor(server: { host: string; port: number }, username: string) {
  return `${username}@${server.host}:${server.port}`;
}

const settings: Record<string, unknown> = {
  "lobbyServers.accounts": {
    accounts: [
      { id: "1", serverId: SRV1.id, username: "alice", hasSecret: true },
      { id: "2", serverId: SRV1.id, username: "bob", hasSecret: true },
      { id: "3", serverId: SRV2.id, username: "carol", hasSecret: true },
      { id: "4", serverId: SRV2.id, username: "dave", hasSecret: true },
    ],
  },
  "lobbyServers.servers": { servers: [SRV1, SRV2] },
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
let busyKeys = new Set<string>();

vi.mock("../../multiplayer/store", () => ({
  serverKeyFor: (server: { host: string; port: number }, username: string) =>
    `${username}@${server.host}:${server.port}`,
  useConnection: (key: string | null) =>
    key ? (connections[key] ?? null) : null,
  useMultiplayer: () => ({
    signIn: vi.fn(async () => {}),
    busyKeys,
  }),
}));

import LobbyServersSettings from "./SettingsSection";

function connectionFor(
  key: string,
  online: Record<string, unknown> = {},
): ConnEntry {
  return { serverKey: key, live: true, mirror: { state: { users: online } } };
}

beforeEach(() => {
  connections = {};
  busyKeys = new Set();
  lsBindings.lsGetCredential.mockClear();
  lsBindings.lsStoreCredential.mockClear();
  lsBindings.lsDeleteCredential.mockClear();
  mpBindings.mpTachyonSignOut.mockClear();
  openUrl.mockClear();
});

afterEach(() => {
  cleanup();
});

function rowFor(username: string) {
  const el = screen.getByText(username);
  const button = el.closest("button");
  if (!button) throw new Error(`no row button for ${username}`);
  return button;
}

it("marks every connected login, not only the first", () => {
  connections = {
    [keyFor(SRV1, "alice")]: connectionFor(keyFor(SRV1, "alice"), {
      a: {},
      b: {},
    }),
    [keyFor(SRV2, "carol")]: connectionFor(keyFor(SRV2, "carol")),
  };
  render(<LobbyServersSettings />);

  expect(rowFor("alice").textContent).toContain("Connected");
  expect(rowFor("carol").textContent).toContain("Connected");
  expect(rowFor("bob").textContent).not.toContain("Connected");
  expect(rowFor("dave").textContent).not.toContain("Connected");
});

it("shows the online count for each connected login separately", () => {
  connections = {
    [keyFor(SRV1, "alice")]: connectionFor(keyFor(SRV1, "alice"), {
      a: {},
      b: {},
    }),
    [keyFor(SRV2, "carol")]: connectionFor(keyFor(SRV2, "carol"), { a: {} }),
  };
  render(<LobbyServersSettings />);

  expect(rowFor("alice").textContent).toContain("2 online");
  expect(rowFor("carol").textContent).toContain("1 online");
});

it("does not grey out a Tachyon sign-in for an account whose sign-in isn't the one in flight", async () => {
  busyKeys = new Set([keyFor(SRV2, "carol")]);
  render(<LobbyServersSettings />);

  fireEvent.click(rowFor("dave"));
  const signIn = await screen.findByRole("button", {
    name: /sign in with your browser/i,
  });
  expect((signIn as HTMLButtonElement).disabled).toBe(false);
});

it("greys out a Tachyon sign-in for the account whose sign-in is in flight", async () => {
  busyKeys = new Set([keyFor(SRV2, "carol")]);
  render(<LobbyServersSettings />);

  fireEvent.click(rowFor("carol"));
  const signIn = await screen.findByRole("button", {
    name: /sign in with your browser/i,
  });
  expect((signIn as HTMLButtonElement).disabled).toBe(true);
});

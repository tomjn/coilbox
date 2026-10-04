// @vitest-environment happy-dom

/**
 * The lobby servers page opening a drawer it was asked for (issue #3382). An
 * invite link to a server with no login sends the player here with the login
 * form on that server, and one to a server coilbox has no entry for sends them
 * here with the server form on that address. Either is a draft: opening it
 * saves nothing.
 */

import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { requestDrawer, takeDrawerRequest } from "../drawerRequest";

vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));

const lsBindings = vi.hoisted(() => ({
  lsGetCredential: vi.fn(async () => ({ secret: null })),
  lsStoreCredential: vi.fn(async () => ({})),
  lsDeleteCredential: vi.fn(async () => ({})),
}));
vi.mock("../bindings", () => lsBindings);
vi.mock("../../multiplayer/bindings", () => ({ mpTachyonSignOut: vi.fn() }));
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

const setSetting = vi.fn();
vi.mock("@picoframe/frame", async () => ({
  ...(await vi.importActual<Record<string, unknown>>("@picoframe/frame")),
  useSetting: (_key: string, initial: unknown) => [initial, setSetting],
}));

vi.mock("../../multiplayer/store", () => ({
  serverKeyFor: (server: { host: string; port: number }, username: string) =>
    `${username}@${server.host}:${server.port}`,
  useConnection: () => null,
  useMultiplayer: () => ({ signIn: vi.fn(), busyKeys: new Set<string>() }),
}));

import LobbyServersSettings from "./SettingsSection";

afterEach(() => {
  cleanup();
  takeDrawerRequest();
  vi.clearAllMocks();
});

it("opens the add server form on the address it was asked for, saving nothing", () => {
  requestDrawer({ kind: "server", host: "evil.example", port: 8200 });
  render(<LobbyServersSettings />);

  expect(screen.getByRole("heading", { name: "New server" })).toBeTruthy();
  expect(screen.getByDisplayValue("evil.example")).toBeTruthy();
  expect(screen.getByDisplayValue("8200")).toBeTruthy();
  expect(screen.getByRole("button", { name: /Add server/ })).toBeTruthy();
  expect(setSetting).not.toHaveBeenCalled();
  expect(lsBindings.lsStoreCredential).not.toHaveBeenCalled();
});

it("opens the add login form when asked for one, saving nothing", () => {
  requestDrawer({ kind: "login", serverId: "bar-ssl" });
  render(<LobbyServersSettings />);

  expect(screen.getByRole("heading", { name: "New login" })).toBeTruthy();
  expect(setSetting).not.toHaveBeenCalled();
  expect(lsBindings.lsStoreCredential).not.toHaveBeenCalled();
});

it("opens the form when asked while the page is already showing", () => {
  render(<LobbyServersSettings />);
  expect(screen.queryByDisplayValue("evil.example")).toBeNull();

  act(() => {
    requestDrawer({ kind: "server", host: "evil.example", port: 8200 });
  });
  expect(screen.getByDisplayValue("evil.example")).toBeTruthy();
});

it("takes a request once, so coming back to the page does not reopen it", () => {
  requestDrawer({ kind: "server", host: "evil.example", port: 8200 });
  render(<LobbyServersSettings />);
  cleanup();

  render(<LobbyServersSettings />);
  expect(screen.queryByDisplayValue("evil.example")).toBeNull();
});

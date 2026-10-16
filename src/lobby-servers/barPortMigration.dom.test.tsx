// @vitest-environment happy-dom

/**
 * The one-time move of each BAR login's server-keyed data from the old 8201 key
 * to the 8200 one, after the built-in moved to 8200 with `STLS` because 8201
 * completes a TLS handshake and then never sends the greeting.
 */

import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

let settings: Record<string, unknown> = {};
const written = vi.hoisted(() => vi.fn());

vi.mock("@picoframe/frame", async () => ({
  ...(await vi.importActual<Record<string, unknown>>("@picoframe/frame")),
  useSetting: (key: string, initial: unknown) => [
    key in settings ? settings[key] : initial,
    (value: unknown) => written(key, value),
  ],
}));

vi.mock("./bindings", () => ({
  lsGetCredential: vi.fn(async () => ({ secret: null })),
  lsStoreCredential: vi.fn(async () => ({})),
  lsDeleteCredential: vi.fn(async () => ({})),
}));

const mp = vi.hoisted(() => ({
  mpMoveChatLogs: vi.fn(async () => ({ moved: 2 })),
}));
vi.mock("../multiplayer/bindings", () => mp);

const moveServerKeyData = vi.hoisted(() => vi.fn());
vi.mock("../multiplayer/serverKeyData", () => ({
  useMoveServerKeyData: () => moveServerKeyData,
}));

import { LobbyServersProvider } from "./LobbyServersProvider";

const OLD = "AF_@server4.beyondallreason.info:8201";
const NEW = "AF_@server4.beyondallreason.info:8200";

beforeEach(() => {
  settings = {
    "lobbyServers.migratedV2": true,
    "lobbyServers.migratedBarTls": true,
    "lobbyServers.accounts": {
      accounts: [
        { id: "a", serverId: "bar-ssl", username: "AF_" },
        { id: "b", serverId: "techa", username: "AF_" },
      ],
    },
  };
  written.mockClear();
  mp.mpMoveChatLogs.mockClear();
  moveServerKeyData.mockClear();
});

afterEach(() => {
  cleanup();
});

it("moves a BAR login's settings and chat logs to the 8200 key, then sets its flag", async () => {
  render(
    <LobbyServersProvider>
      <div />
    </LobbyServersProvider>,
  );

  await waitFor(() =>
    expect(written).toHaveBeenCalledWith("lobbyServers.migratedBarPort", true),
  );
  expect(moveServerKeyData).toHaveBeenCalledTimes(1);
  expect(moveServerKeyData).toHaveBeenCalledWith(OLD, NEW);
  expect(mp.mpMoveChatLogs).toHaveBeenCalledTimes(1);
  expect(mp.mpMoveChatLogs).toHaveBeenCalledWith({ oldKey: OLD, newKey: NEW });
});

it("still sets its flag when a chat log move fails", async () => {
  mp.mpMoveChatLogs.mockRejectedValueOnce(new Error("disk full"));
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  render(
    <LobbyServersProvider>
      <div />
    </LobbyServersProvider>,
  );

  await waitFor(() =>
    expect(written).toHaveBeenCalledWith("lobbyServers.migratedBarPort", true),
  );
  expect(moveServerKeyData).toHaveBeenCalledWith(OLD, NEW);
  warn.mockRestore();
});

it("waits for the plaintext BAR remap, which can still add logins", () => {
  settings["lobbyServers.migratedBarTls"] = false;
  // The remap itself has nothing to move here, so it only writes its own flag.
  render(
    <LobbyServersProvider>
      <div />
    </LobbyServersProvider>,
  );

  expect(moveServerKeyData).not.toHaveBeenCalled();
  expect(written).not.toHaveBeenCalledWith(
    "lobbyServers.migratedBarPort",
    true,
  );
});

it("does nothing once its flag is set", () => {
  settings["lobbyServers.migratedBarPort"] = true;
  render(
    <LobbyServersProvider>
      <div />
    </LobbyServersProvider>,
  );

  expect(moveServerKeyData).not.toHaveBeenCalled();
  expect(mp.mpMoveChatLogs).not.toHaveBeenCalled();
});

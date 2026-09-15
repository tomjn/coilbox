// @vitest-environment happy-dom

/**
 * Switching account from the login panel while logged in.
 *
 * Coilbox holds one lobby connection, so a switch is a log out followed by a
 * connect. These check the panel swaps to the account list and back, and that a
 * log out that fails never goes on to open a second connection.
 *
 * The store and settings are stood in for, so nothing leaves the test.
 */

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LoginPanel } from "./LobbyStatusButton";

const calls: string[] = [];

const mp = {
  activeKey: "alice@server4.beyondallreason.info:8201" as string | null,
  mirror: { phase: "ready", state: { myUsername: "alice" } },
  revealed: true,
  busy: false,
  status: { away: false },
  manualAway: false,
  setManualAway: vi.fn(),
  signIn: vi.fn(),
  cancelConnect: vi.fn(),
  disconnect: vi.fn(async () => {
    calls.push("disconnect");
  }),
  connect: vi.fn(async (_server: { id: string }, username: string) => {
    calls.push(`connect ${username}`);
  }),
};

vi.mock("./store", () => ({
  useMultiplayer: () => mp,
  serverKeyFor: (server: { host: string; port: number }, username: string) =>
    `${username}@${server.host}:${server.port}`,
}));

const settings: Record<string, unknown> = {
  "lobbyServers.accounts": {
    accounts: [
      { id: "a", serverId: "bar-ssl", username: "alice", hasSecret: true },
      {
        id: "b",
        serverId: "recoil-official",
        username: "bob",
        hasSecret: true,
      },
    ],
  },
  "lobbyServers.servers": { servers: [] },
  "lobbyServers.lastLogin": { serverId: "bar-ssl", username: "alice" },
  "multiplayer.autoConnect": false,
};

vi.mock("@picoframe/frame", async () => ({
  ...(await vi.importActual<Record<string, unknown>>("@picoframe/frame")),
  useSetting: (key: string, initial: unknown) => [
    key in settings ? settings[key] : initial,
    () => {},
  ],
}));

vi.mock("../lobby-servers/RegisterForm", () => ({ RegisterForm: () => null }));
vi.mock("../lobby-servers/PasswordRecoveryForm", () => ({
  PasswordRecoveryForm: () => null,
}));

const panel = () => (
  <MemoryRouter>
    <LoginPanel onNavigate={() => {}} />
  </MemoryRouter>
);

const draw = () => render(panel());

const row = (name: string) =>
  screen.getByRole("button", { name: new RegExp(`^${name}`) });

beforeEach(() => {
  calls.length = 0;
  mp.activeKey = "alice@server4.beyondallreason.info:8201";
  mp.disconnect.mockClear();
  mp.connect.mockClear();
});

afterEach(cleanup);

describe("switching account while logged in", () => {
  it("swaps the panel for the account list, and Back swaps it back", () => {
    draw();
    fireEvent.click(screen.getByRole("button", { name: /Switch account/ }));

    expect(screen.queryByRole("button", { name: "Log out" })).toBeNull();
    expect(row("alice")).toHaveProperty("disabled", true);
    expect(row("alice").textContent).toContain("Connected");
    expect(row("bob")).toHaveProperty("disabled", false);

    fireEvent.click(screen.getByRole("button", { name: /Back/ }));
    expect(screen.getByRole("button", { name: "Log out" })).toBeTruthy();
    expect(mp.disconnect).not.toHaveBeenCalled();
  });

  it("logs out before connecting as the picked login", async () => {
    draw();
    fireEvent.click(screen.getByRole("button", { name: /Switch account/ }));
    await act(async () => {
      fireEvent.click(row("bob"));
    });

    expect(calls).toEqual(["disconnect", "connect bob"]);
    expect(mp.connect.mock.calls[0][0].id).toBe("recoil-official");
  });

  it("does not connect when the log out fails", async () => {
    mp.disconnect.mockImplementationOnce(async () => {
      throw new Error("socket stuck");
    });
    draw();
    fireEvent.click(screen.getByRole("button", { name: /Switch account/ }));
    await act(async () => {
      fireEvent.click(row("bob"));
    });

    expect(mp.connect).not.toHaveBeenCalled();
    expect(screen.getByText(/socket stuck/)).toBeTruthy();
  });

  it("leaves the switch view when the connection drops", () => {
    const { rerender } = draw();
    fireEvent.click(screen.getByRole("button", { name: /Switch account/ }));
    mp.activeKey = null;
    rerender(panel());
    mp.activeKey = "alice@server4.beyondallreason.info:8201";
    rerender(panel());
    expect(screen.getByRole("button", { name: "Log out" })).toBeTruthy();
  });
});

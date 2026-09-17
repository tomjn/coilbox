// @vitest-environment happy-dom

/**
 * The login panel with more than one connection (issue #2848).
 *
 * A player can be logged in to several servers, one account on each. The panel
 * lists every connection with its own Log out, adds a login without logging out
 * of the others, and switches the account on a server that already has one by
 * logging that one out first.
 *
 * The store and settings are stood in for, so nothing leaves the test.
 */

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ConnectionState } from "./connections";
import { LoginPanel } from "./LobbyStatusButton";

const ALICE_KEY = "alice@server4.beyondallreason.info:8201";
const CAROL_KEY = "carol@lobby.techa-rts.com:8200";

const calls: string[] = [];

const mp = {
  connections: {} as Record<string, ConnectionState>,
  activeKey: null as string | null,
  revealed: true,
  busy: false,
  busyKeys: new Set<string>(),
  manualAway: false,
  setManualAway: vi.fn(),
  signIn: vi.fn(),
  cancelConnect: vi.fn(),
  disconnect: vi.fn(async (serverKey?: string) => {
    calls.push(`disconnect ${serverKey}`);
  }),
  connect: vi.fn(async (_server: { id: string }, username: string) => {
    calls.push(`connect ${username}`);
  }),
  // The fields the logged-out view reads off the focused connection.
  mirror: { phase: null, state: null, error: null, loginError: null },
  status: { ingame: false, away: false },
};

vi.mock("./store", async () => {
  const { BUILTIN_SERVERS } = await import("../lobby-servers/config");
  const { liveConnectionKeys } = await import("./connections");
  const address = (key: string) => key.slice(key.indexOf("@") + 1);
  return {
    useMultiplayer: () => mp,
    useProtocolServers: () => BUILTIN_SERVERS,
    liveConnectionKeys,
    serverKeyFor: (server: { host: string; port: number }, username: string) =>
      `${username}@${server.host}:${server.port}`,
    usernameFromKey: (key: string) => key.slice(0, key.indexOf("@")),
    serverHostFromKey: (key: string) => address(key).split(":")[0],
    serverNameFor: (key: string, servers: typeof BUILTIN_SERVERS) =>
      servers.find((s) => key.endsWith(`@${s.host}:${s.port}`))?.name ??
      address(key),
  };
});

const settings: Record<string, unknown> = {
  "lobbyServers.accounts": {
    accounts: [
      { id: "a", serverId: "bar-ssl", username: "alice", hasSecret: true },
      { id: "b", serverId: "bar-tachyon", username: "bob", hasSecret: true },
      { id: "c", serverId: "techa", username: "carol", hasSecret: true },
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

function connection(
  serverKey: string,
  opts: { live?: boolean; away?: boolean; error?: string } = {},
): ConnectionState {
  const username = serverKey.slice(0, serverKey.indexOf("@"));
  return {
    serverKey,
    live: opts.live ?? true,
    mirror: {
      phase: opts.live === false ? null : "ready",
      state: { myUsername: username },
      error: opts.error ?? null,
      loginError: null,
    },
    agreement: null,
    accountInfo: null,
    debriefingShown: null,
    channelJoinFailures: {},
    justWentIngame: new Set(),
    status: { ingame: false, away: opts.away ?? false },
    manualAway: false,
  } as unknown as ConnectionState;
}

function connectAs(...entries: ConnectionState[]) {
  mp.connections = Object.fromEntries(entries.map((e) => [e.serverKey, e]));
  mp.activeKey = entries.find((e) => e.live)?.serverKey ?? null;
}

const panel = () => (
  <MemoryRouter>
    <LoginPanel onNavigate={() => {}} />
  </MemoryRouter>
);

const draw = () => render(panel());

const account = (name: string) =>
  screen.getByRole("button", { name: new RegExp(`^${name}`) });

const rowFor = (name: string) => {
  const row = screen
    .getAllByRole("listitem")
    .find((li) => li.textContent?.startsWith(name));
  if (!row) throw new Error(`no row for ${name}`);
  return row;
};

beforeEach(() => {
  calls.length = 0;
  connectAs(connection(ALICE_KEY));
  mp.busy = false;
  mp.busyKeys = new Set();
  mp.disconnect.mockClear();
  mp.connect.mockClear();
  mp.cancelConnect.mockClear();
  mp.setManualAway.mockClear();
});

afterEach(cleanup);

describe("the login panel with one connection", () => {
  it("names the account and its server, and logs out of it", async () => {
    draw();
    expect(screen.getByText("alice")).toBeTruthy();
    expect(screen.getByText(/Beyond All Reason/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Log out of all" })).toBeNull();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Log out" }));
    });
    expect(calls).toEqual([`disconnect ${ALICE_KEY}`]);
  });

  it("sets away by hand", () => {
    draw();
    fireEvent.click(screen.getByRole("switch"));
    expect(mp.setManualAway).toHaveBeenCalledWith(true);
  });
});

describe("the login panel with two connections", () => {
  beforeEach(() => {
    connectAs(connection(ALICE_KEY), connection(CAROL_KEY, { away: true }));
  });

  it("lists every account with its server and away state", () => {
    draw();
    const alice = rowFor("alice");
    expect(alice.textContent).toContain("Beyond All Reason");
    expect(alice.textContent).toContain("Online");
    const carol = rowFor("carol");
    expect(carol.textContent).toContain("Tech Annihilation");
    expect(carol.textContent).toContain("Away");
  });

  it("logs out of one account and leaves the other", async () => {
    draw();
    await act(async () => {
      fireEvent.click(
        within(rowFor("carol")).getByRole("button", { name: "Log out" }),
      );
    });
    expect(calls).toEqual([`disconnect ${CAROL_KEY}`]);
  });

  it("logs out of every account at once", async () => {
    draw();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Log out of all" }));
    });
    expect(calls).toEqual([
      `disconnect ${ALICE_KEY}`,
      `disconnect ${CAROL_KEY}`,
    ]);
  });

  it("lists a connection that dropped, with its reason, and closes it", async () => {
    connectAs(
      connection(ALICE_KEY),
      connection(CAROL_KEY, { live: false, error: "connection reset" }),
    );
    draw();
    expect(rowFor("carol").textContent).toContain("connection reset");
    await act(async () => {
      fireEvent.click(
        within(rowFor("carol")).getByRole("button", { name: "Log out" }),
      );
    });
    expect(calls).toEqual([`disconnect ${CAROL_KEY}`]);
  });
});

describe("adding another login", () => {
  it("shows the account list without logging out, and Back returns", () => {
    draw();
    fireEvent.click(screen.getByRole("button", { name: /Add another login/ }));

    expect(screen.queryByRole("button", { name: "Log out" })).toBeNull();
    expect(account("alice")).toHaveProperty("disabled", true);
    expect(account("alice").textContent).toContain("Connected");
    expect(account("carol")).toHaveProperty("disabled", false);

    fireEvent.click(screen.getByRole("button", { name: /Back/ }));
    expect(screen.getByRole("button", { name: "Log out" })).toBeTruthy();
    expect(mp.disconnect).not.toHaveBeenCalled();
  });

  it("connects a login on another server without logging out", async () => {
    draw();
    fireEvent.click(screen.getByRole("button", { name: /Add another login/ }));
    await act(async () => {
      fireEvent.click(account("carol"));
    });

    expect(calls).toEqual(["connect carol"]);
    expect(mp.connect.mock.calls[0][0].id).toBe("techa");
  });

  it("switches the account on a server that already has one, through its other entry", async () => {
    draw();
    fireEvent.click(screen.getByRole("button", { name: /Add another login/ }));
    // Say what pressing it will do before it is pressed.
    expect(account("bob").textContent).toContain("Logs out alice");
    await act(async () => {
      fireEvent.click(account("bob"));
    });

    expect(calls).toEqual([`disconnect ${ALICE_KEY}`, "connect bob"]);
    expect(mp.connect.mock.calls[0][0].id).toBe("bar-tachyon");
  });

  it("does not connect when logging out of the server's account fails", async () => {
    mp.disconnect.mockImplementationOnce(async () => {
      throw new Error("socket stuck");
    });
    draw();
    fireEvent.click(screen.getByRole("button", { name: /Add another login/ }));
    await act(async () => {
      fireEvent.click(account("bob"));
    });

    expect(mp.connect).not.toHaveBeenCalled();
    expect(screen.getByText(/socket stuck/)).toBeTruthy();
  });

  it("returns to the list once the new login is up", async () => {
    draw();
    fireEvent.click(screen.getByRole("button", { name: /Add another login/ }));
    await act(async () => {
      fireEvent.click(account("carol"));
    });
    expect(
      screen.getByRole("button", { name: /Add another login/ }),
    ).toBeTruthy();
  });
});

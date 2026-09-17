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
import LobbyStatusButton, { LoginPanel } from "./LobbyStatusButton";

const ALICE_KEY = "alice@server4.beyondallreason.info:8201";
const CAROL_KEY = "carol@lobby.techa-rts.com:8200";

const calls: string[] = [];

const mp = {
  connections: {} as Record<string, ConnectionState>,
  activeKey: null as string | null,
  revealed: true,
  busy: false,
  busyKeys: new Set<string>(),
  loginPopoverOpen: false,
  openLoginPopover: vi.fn(),
  closeLoginPopover: vi.fn(),
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
  reconnectAll: vi.fn(async (targets: { account: { username: string } }[]) => {
    for (const { account } of targets)
      calls.push(`connect ${account.username}`);
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

const BASE_ACCOUNTS = [
  { id: "a", serverId: "bar-ssl", username: "alice", hasSecret: true },
  { id: "b", serverId: "bar-tachyon", username: "bob", hasSecret: true },
  { id: "c", serverId: "techa", username: "carol", hasSecret: true },
];

const settings: Record<string, unknown> = {
  "lobbyServers.accounts": { accounts: BASE_ACCOUNTS },
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
  opts: {
    live?: boolean;
    away?: boolean;
    error?: string;
    direct?: boolean;
  } = {},
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
    direct: opts.direct ?? false,
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
  mp.revealed = true;
  mp.disconnect.mockClear();
  mp.connect.mockClear();
  mp.reconnectAll.mockClear();
  mp.cancelConnect.mockClear();
  mp.setManualAway.mockClear();
  settings["lobbyServers.accounts"] = { accounts: BASE_ACCOUNTS };
  settings["lobbyServers.lastLogin"] = {
    serverId: "bar-ssl",
    username: "alice",
  };
  settings["multiplayer.autoConnect"] = false;
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

// A room is not a login (issue #2850). It is closed from the Battles page, and
// logging out of every login must not drop the host's own client from a room
// that is still running.
describe("the login panel beside a room", () => {
  const ROOM_KEY = "AF@127.0.0.1:8200";

  it("lists the logins and leaves the room out", async () => {
    connectAs(connection(ALICE_KEY), connection(ROOM_KEY, { direct: true }));
    draw();
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    expect(screen.queryByText("AF")).toBeNull();
    expect(screen.queryByRole("button", { name: "Log out of all" })).toBeNull();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Log out" }));
    });
    expect(calls).toEqual([`disconnect ${ALICE_KEY}`]);
  });

  it("offers the logins to connect when the room is the only connection", () => {
    connectAs(connection(ROOM_KEY, { direct: true }));
    draw();
    expect(screen.queryByRole("button", { name: "Log out" })).toBeNull();
    expect(account("alice")).toBeTruthy();
    expect(account("carol")).toBeTruthy();
  });
});

// The topbar button follows lobby accounts and logins only, not rooms (issue
// #2904). A room is controlled from the Battles page, which already has its
// own Stop room control.
describe("the topbar button's visibility beside a room (issue #2904)", () => {
  const ROOM_KEY = "AF@127.0.0.1:8200";

  const drawButton = () =>
    render(
      <MemoryRouter>
        <LobbyStatusButton />
      </MemoryRouter>,
    );

  it("hides when only a room is open and no accounts are configured", () => {
    settings["lobbyServers.accounts"] = { accounts: [] };
    connectAs(connection(ROOM_KEY, { direct: true }));
    drawButton();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("shows once an account is configured, even with only a room open", () => {
    settings["lobbyServers.accounts"] = { accounts: BASE_ACCOUNTS };
    connectAs(connection(ROOM_KEY, { direct: true }));
    drawButton();
    expect(
      screen.getByRole("button", { name: "Multiplayer: log in" }),
    ).toBeTruthy();
  });

  it("shows for a dropped login beside a room, with no accounts configured", () => {
    settings["lobbyServers.accounts"] = { accounts: [] };
    connectAs(
      connection(ALICE_KEY, { live: false, error: "connection reset" }),
      connection(ROOM_KEY, { direct: true }),
    );
    drawButton();
    expect(screen.getByRole("button")).toBeTruthy();
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

describe("remembered logins in the account list (issue #2927)", () => {
  beforeEach(() => {
    // Logged all the way out, which is the state the connect view shows in.
    connectAs();
  });

  it("lists every account once, with no separate reconnect buttons", () => {
    settings["lobbyServers.accounts"] = {
      accounts: [
        { ...BASE_ACCOUNTS[0], openAtQuit: true },
        BASE_ACCOUNTS[1],
        { ...BASE_ACCOUNTS[2], openAtQuit: true },
      ],
    };
    draw();

    expect(screen.getAllByRole("button", { name: /^alice/ })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: /^bob/ })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: /^carol/ })).toHaveLength(1);
    expect(screen.queryByRole("button", { name: /^Reconnect as/ })).toBeNull();
  });

  it("marks remembered logins and sorts them to the top", () => {
    settings["lobbyServers.accounts"] = {
      accounts: [
        BASE_ACCOUNTS[0],
        { ...BASE_ACCOUNTS[1], openAtQuit: true },
        { ...BASE_ACCOUNTS[2], openAtQuit: true },
      ],
    };
    draw();

    expect(account("bob").textContent).toContain("Open last time");
    expect(account("carol").textContent).toContain("Open last time");
    expect(account("alice").textContent).not.toContain("Open last time");

    const order = screen.getAllByRole("button").map((b) => b.textContent ?? "");
    const indexOf = (name: string) =>
      order.findIndex((t) => t.startsWith(name));
    expect(indexOf("bob")).toBeLessThan(indexOf("alice"));
    expect(indexOf("carol")).toBeLessThan(indexOf("alice"));
  });

  it("offers no Reconnect all with only one remembered login", () => {
    // BASE_ACCOUNTS carries no `openAtQuit`, so this falls back to the
    // single lastLogin account (alice).
    draw();
    expect(screen.queryByRole("button", { name: "Reconnect all" })).toBeNull();
  });

  it("offers Reconnect all with two or more remembered logins", () => {
    settings["lobbyServers.accounts"] = {
      accounts: [
        { ...BASE_ACCOUNTS[0], openAtQuit: true },
        { ...BASE_ACCOUNTS[2], openAtQuit: true },
      ],
    };
    draw();
    expect(screen.getByRole("button", { name: "Reconnect all" })).toBeTruthy();
  });

  it("skips a remembered login that would clash on the same host", async () => {
    // alice (bar-ssl) and bob (bar-tachyon) share a host: BAR runs both
    // protocols behind server4.beyondallreason.info. lastLogin names alice,
    // so she is the more recently used of the pair and bob is dropped.
    settings["lobbyServers.accounts"] = {
      accounts: [
        { ...BASE_ACCOUNTS[0], openAtQuit: true },
        { ...BASE_ACCOUNTS[1], openAtQuit: true },
        { ...BASE_ACCOUNTS[2], openAtQuit: true },
      ],
    };
    draw();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Reconnect all" }));
    });

    const targets = mp.reconnectAll.mock.calls[0][0] as {
      account: { username: string };
    }[];
    expect(targets.map((t) => t.account.username).sort()).toEqual([
      "alice",
      "carol",
    ]);
  });

  it("skips a remembered login that is already connected", async () => {
    const dave = {
      id: "d",
      serverId: "zero-k",
      username: "dave",
      hasSecret: true,
      openAtQuit: true,
    };
    settings["lobbyServers.accounts"] = {
      accounts: [
        { ...BASE_ACCOUNTS[0], openAtQuit: true },
        { ...BASE_ACCOUNTS[2], openAtQuit: true },
        dave,
      ],
    };
    // alice is already connected, so Reconnect all must not try her again.
    connectAs(connection(ALICE_KEY));
    draw();
    fireEvent.click(screen.getByRole("button", { name: /Add another login/ }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Reconnect all" }));
    });

    const targets = mp.reconnectAll.mock.calls[0][0] as {
      account: { username: string };
    }[];
    expect(targets.map((t) => t.account.username).sort()).toEqual([
      "carol",
      "dave",
    ]);
  });

  it("scrolls the account list inside a bounded container", () => {
    const { container } = draw();
    expect(container.querySelector(".overflow-y-auto")).toBeTruthy();
  });
});

// The scrolling container from #2927 stopped the rows stretching to the
// panel width, so their hover highlight covered only the text (issue #2933).
describe("account rows fill the panel width (issue #2933)", () => {
  it("gives every account row a full-width class", () => {
    connectAs();
    draw();
    expect(account("alice").className).toMatch(/\bw-full\b/);
    expect(account("bob").className).toMatch(/\bw-full\b/);
  });

  it("gives the Add a login row a full-width class", () => {
    connectAs();
    draw();
    expect(screen.getByRole("link", { name: /Add a login/ }).className).toMatch(
      /\bw-full\b/,
    );
  });
});

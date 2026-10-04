// @vitest-environment happy-dom

/**
 * An invite link, from arriving to joining (issue #3382).
 *
 * A link is written by whoever sent it, so what matters most here is what does
 * not happen: nothing connects until the player presses the button, and a
 * second link cannot change what that button does.
 *
 * The store, settings and the join are stood in for, so nothing leaves the
 * test.
 */

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { takeDrawerRequest } from "../../lobby-servers/drawerRequest";
import type { ConnectionState } from "../connections";
import { InviteLinkHost } from "./InviteLinkHost";
import { inviteLinkFrom } from "./inviteOffer";
import { offerInvite, resetInviteStore } from "./inviteStore";

const BAR = "server4.beyondallreason.info:8201";
const ALICE_KEY = `alice@${BAR}`;
const CAROL_KEY = "carol@lobby.techa-rts.com:8200";

const mp = {
  connections: {} as Record<string, ConnectionState>,
  activeKey: null as string | null,
  busyKeys: new Set<string>(),
  connect: vi.fn(async (_server: unknown, _username: string) => {}),
  openLoginPopover: vi.fn(),
  clearJoinError: vi.fn(),
};

vi.mock("../store", async () => {
  const { BUILTIN_SERVERS } = await import("../../lobby-servers/config");
  const address = (key: string) => key.slice(key.indexOf("@") + 1);
  return {
    useMultiplayer: () => mp,
    useProtocolServers: () => BUILTIN_SERVERS,
    serverNameFor: (key: string, servers: typeof BUILTIN_SERVERS) =>
      servers.find((s) => key.endsWith(`@${s.host}:${s.port}`))?.name ??
      address(key),
  };
});

const settings: Record<string, unknown> = {};

vi.mock("@picoframe/frame", async () => ({
  ...(await vi.importActual<Record<string, unknown>>("@picoframe/frame")),
  useSetting: (key: string, initial: unknown) => [
    key in settings ? settings[key] : initial,
    () => {},
  ],
}));

const notify = vi.fn();
vi.mock("../../notify/notify", () => ({
  notify: (input: unknown) => notify(input),
}));

const joinBattle = vi.fn(async (_args: unknown) => {});
vi.mock("../battles/joinBattle", () => ({
  joinBattle: (args: unknown) => joinBattle(args),
}));

const leaveBattle = vi.fn(async (_key: string) => {});
vi.mock("../battle/leaveBattle", () => ({
  leaveBattle: (key: string) => leaveBattle(key),
}));

function connection(
  serverKey: string,
  opts: {
    ready?: boolean;
    battles?: Record<string, unknown>;
    currentBattle?: number | null;
  } = {},
): ConnectionState {
  return {
    serverKey,
    live: true,
    direct: false,
    mirror: {
      phase: opts.ready === false ? "loggingIn" : "ready",
      state: {
        battles: opts.battles ?? {},
        currentBattle: opts.currentBattle ?? null,
      },
      error: null,
      loginError: null,
      lastJoinError: null,
    },
  } as unknown as ConnectionState;
}

const battle = (id: number, passworded = false) => ({ id, passworded });

let where = "";
function Where() {
  const location = useLocation();
  where = location.pathname + location.search;
  return null;
}

function draw() {
  return render(
    <MemoryRouter>
      <Where />
      <InviteLinkHost />
    </MemoryRouter>,
  );
}

/** A link arriving, as `DeepLinkHandler` hands one over. */
function open(server: string, battleId = "42", password?: string): boolean {
  const link = inviteLinkFrom({ server, battle: battleId, password });
  if (!link) throw new Error(`not a link: ${server}`);
  let shown = false;
  act(() => {
    shown = offerInvite(link);
  });
  return shown;
}

function connectAs(...entries: ConnectionState[]) {
  mp.connections = Object.fromEntries(entries.map((e) => [e.serverKey, e]));
  mp.activeKey = entries[0]?.serverKey ?? null;
}

const press = (name: string | RegExp) =>
  fireEvent.click(screen.getByRole("button", { name }));

beforeEach(() => {
  settings["lobbyServers.accounts"] = {
    accounts: [
      { id: "a", serverId: "bar-ssl", username: "alice", hasSecret: true },
    ],
  };
  settings["lobbyServers.servers"] = { servers: [] };
  settings["lobbyServers.lastLogin"] = null;
  mp.connections = {};
  mp.activeKey = null;
  mp.busyKeys = new Set();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  resetInviteStore();
  takeDrawerRequest();
});

describe("an invite link to a server with a saved login", () => {
  // Threat 4.
  it("connects nothing until the player presses the button", () => {
    draw();
    open(BAR);
    expect(screen.getByText(BAR)).toBeTruthy();
    expect(mp.connect).not.toHaveBeenCalled();
    expect(mp.openLoginPopover).not.toHaveBeenCalled();
    expect(joinBattle).not.toHaveBeenCalled();
  });

  it("connects with that server's saved entry on the press", () => {
    draw();
    open(BAR);
    press("Connect as alice and join");
    expect(mp.connect).toHaveBeenCalledTimes(1);
    const [server, username] = mp.connect.mock.calls[0];
    expect(server).toMatchObject({ id: "bar-ssl", tls: true });
    expect(username).toBe("alice");
  });

  it("joins the battle once the server is logged in", () => {
    const view = draw();
    open(BAR, "42", "sesame");
    press("Connect as alice and join");
    expect(joinBattle).not.toHaveBeenCalled();

    connectAs(connection(ALICE_KEY, { battles: { "42": battle(42, true) } }));
    view.rerender(
      <MemoryRouter>
        <Where />
        <InviteLinkHost />
      </MemoryRouter>,
    );
    expect(joinBattle).toHaveBeenCalledTimes(1);
    expect(joinBattle.mock.calls[0][0]).toMatchObject({
      serverKey: ALICE_KEY,
      battle: { id: 42 },
      key: "sesame",
    });
  });

  it("says the battle has gone when it is not on the list", () => {
    const view = draw();
    open(BAR);
    press("Connect as alice and join");
    connectAs(connection(ALICE_KEY, { battles: { "7": battle(7) } }));
    view.rerender(
      <MemoryRouter>
        <Where />
        <InviteLinkHost />
      </MemoryRouter>,
    );
    expect(joinBattle).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({ title: "The battle has gone" }),
    );
  });

  it("sends a passworded battle to its row when the link has no password", () => {
    connectAs(connection(ALICE_KEY, { battles: { "42": battle(42, true) } }));
    draw();
    open(BAR);
    press("Join battle");
    expect(joinBattle).not.toHaveBeenCalled();
    expect(where).toBe(
      `/battles?server=${encodeURIComponent(ALICE_KEY)}&battle=42`,
    );
  });

  // Threat 8, as far as the screen goes.
  it("never puts the link's password on screen", () => {
    draw();
    open(BAR, "42", "sesame");
    expect(document.body.textContent).not.toContain("sesame");
    press("Connect as alice and join");
    expect(document.body.textContent).not.toContain("sesame");
  });
});

// Threat 7.
describe("a join that is waiting for its server", () => {
  it("is dropped on Cancel", () => {
    const view = draw();
    open(BAR);
    press("Connect as alice and join");
    press("Cancel invite");
    connectAs(connection(ALICE_KEY, { battles: { "42": battle(42) } }));
    view.rerender(
      <MemoryRouter>
        <Where />
        <InviteLinkHost />
      </MemoryRouter>,
    );
    expect(joinBattle).not.toHaveBeenCalled();
  });

  it("is dropped when the player logs in somewhere else", () => {
    const view = draw();
    open(BAR);
    press("Connect as alice and join");
    connectAs(connection(CAROL_KEY, { battles: { "42": battle(42) } }));
    view.rerender(
      <MemoryRouter>
        <Where />
        <InviteLinkHost />
      </MemoryRouter>,
    );
    expect(joinBattle).not.toHaveBeenCalled();

    // And stays dropped when the first server turns up after all.
    connectAs(
      connection(CAROL_KEY),
      connection(ALICE_KEY, { battles: { "42": battle(42) } }),
    );
    view.rerender(
      <MemoryRouter>
        <Where />
        <InviteLinkHost />
      </MemoryRouter>,
    );
    expect(joinBattle).not.toHaveBeenCalled();
  });

  it("does not leave a battle the player was not told about", () => {
    const view = draw();
    open(BAR);
    press("Connect as alice and join");
    // A battle joined on another server after the press, on a login that was
    // already open, so it was never part of what the player agreed to.
    connectAs(
      connection(ALICE_KEY, { battles: { "42": battle(42) } }),
      connection(CAROL_KEY, { currentBattle: 9 }),
    );
    view.rerender(
      <MemoryRouter>
        <Where />
        <InviteLinkHost />
      </MemoryRouter>,
    );
    expect(leaveBattle).not.toHaveBeenCalled();
    expect(joinBattle).not.toHaveBeenCalled();
  });
});

// Threat 1.
describe("an invite link to a server coilbox does not know", () => {
  it("shows the address and connects nothing", () => {
    draw();
    open("EVIL.example.:8200");
    expect(screen.getByText("evil.example:8200")).toBeTruthy();
    expect(screen.getByText(/does not know this server/)).toBeTruthy();
    expect(mp.connect).not.toHaveBeenCalled();
  });

  it("opens the add server form on the press, and still connects nothing", () => {
    draw();
    open("evil.example:8200");
    press("Add this server");
    expect(takeDrawerRequest()).toEqual({
      kind: "server",
      host: "evil.example",
      port: 8200,
    });
    expect(where).toBe("/settings/lobby-servers");
    expect(mp.connect).not.toHaveBeenCalled();
  });

  // Threat 3.
  it("offers no saved login to a known host on another port", () => {
    draw();
    open("server4.beyondallreason.info:8200");
    expect(screen.queryByRole("button", { name: /alice/ })).toBeNull();
    expect(screen.getByText(/does not know this server/)).toBeTruthy();
  });
});

describe("an invite link to a known server with no saved login", () => {
  it("opens the login form for that server on the press", () => {
    settings["lobbyServers.accounts"] = { accounts: [] };
    draw();
    open(BAR);
    press("Open the login screen");
    expect(takeDrawerRequest()).toEqual({ kind: "login", serverId: "bar-ssl" });
    expect(where).toBe("/settings/lobby-servers");
    expect(mp.connect).not.toHaveBeenCalled();
  });
});

// Threat 6.
describe("a second link while the first is still being asked about", () => {
  it("is refused, and the button still does what it said", () => {
    draw();
    expect(open(BAR)).toBe(true);
    expect(open("evil.example:8200")).toBe(false);
    expect(screen.getByText(BAR)).toBeTruthy();
    expect(screen.queryByText("evil.example:8200")).toBeNull();
    press("Connect as alice and join");
    expect(mp.connect.mock.calls[0][0]).toMatchObject({ id: "bar-ssl" });
  });

  it("is taken once the first has been cancelled", () => {
    draw();
    open(BAR);
    press("Cancel");
    expect(open("evil.example:8200")).toBe(true);
    expect(screen.getByText("evil.example:8200")).toBeTruthy();
  });
});

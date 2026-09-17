// @vitest-environment happy-dom

/**
 * Boot auto-connect reconnects every remembered login, not only the last one
 * (issue #2849). "Remembered" is every saved account flagged `openAtQuit`, or,
 * for a player upgrading from a version that tracked only `lastLogin`, that
 * one login alone.
 *
 * The mock setup is copied from `reattachAll.dom.test.tsx`, extended with a
 * `notified` log (title + body, so a per-login failure is distinguishable), a
 * `failKeys` set so one login's connect can be made to reject, and a
 * `signedIn` map so a Tachyon login's stored sign-in can be made to answer no.
 */

import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LobbyEvent, LobbyState } from "./bindings";

interface FakeChannel {
  onmessage?: (ev: LobbyEvent) => void;
}

const wire = vi.hoisted(() => ({
  /** The event channel each connect handed the Rust side, by server key. */
  channels: new Map<string, FakeChannel>(),
  /** Every key a TASServer/Zero-K connect was opened for, in order. */
  opened: [] as string[],
  /**
   * Every key a Tachyon connect was opened for, in order. This never opens a
   * browser itself: that only happens through the separate `signIn` call,
   * which the boot loop must never make.
   */
  tachyonOpened: [] as string[],
  /** Keys whose connect should reject, simulating a refused/unreachable login. */
  failKeys: new Set<string>(),
  /** Titles + bodies passed to `notify`, in order. */
  notified: [] as { title: string; body?: string }[],
  /** Keys `mp_active_keys` answers with at boot. */
  activeKeys: [] as string[],
  /**
   * Per `${serverId}:${username}`, whether a stored Tachyon sign-in is still
   * good. Missing means yes.
   */
  signedIn: new Map<string, boolean>(),
}));

const settings = vi.hoisted(() => ({
  lastLogin: null as { serverId: string; username: string } | null,
  accounts: {
    accounts: [] as {
      id: string;
      serverId: string;
      username: string;
      openAtQuit?: boolean;
    }[],
  },
  autoConnect: false,
}));

vi.mock("@tauri-apps/api/core", () => ({
  Channel: class {
    onmessage?: (ev: LobbyEvent) => void;
  },
}));

vi.mock("@picoframe/frame", async () => {
  const react = await import("react");
  return {
    useSetting: <T,>(key: string, initial: T) => {
      const preset: Record<string, unknown> = {
        "lobbyServers.lastLogin": settings.lastLogin,
        "lobbyServers.accounts": settings.accounts,
        "multiplayer.autoConnect": settings.autoConnect,
      };
      const seed = key in preset ? (preset[key] as T) : initial;
      return react.useState<T>(seed);
    },
  };
});

vi.mock("../notify/notify", () => ({
  notify: async ({ title, body }: { title: string; body?: string }) => {
    wire.notified.push({ title, body });
  },
}));
vi.mock("./ringEffect", () => ({ triggerRing: () => {} }));
vi.mock("./ingameCue", () => ({ triggerIngameCue: () => {} }));
vi.mock("./chat/mentionCue", () => ({ triggerMentionCue: () => {} }));
vi.mock("./DebriefingDrawer", () => ({ DebriefingDrawer: () => null }));
vi.mock("./MatchFoundPanel", () => ({ MatchFoundPanel: () => null }));
vi.mock("./ServerMessageBoxDialog", () => ({
  ServerMessageBoxDialog: () => null,
}));
vi.mock("./VerificationCodeDialog", () => ({
  VerificationCodeDialog: () => null,
}));

const emptyState = (): LobbyState =>
  ({
    myUsername: "AF",
    compflags: [],
    users: {},
    channels: {},
    dms: {},
    battles: {},
    currentBattle: null,
    lastBattle: null,
    hostPort: null,
    channelDirectory: [],
    currentVote: null,
    serverIgnores: [],
    friends: [],
    friendRequests: [],
    party: null,
  }) as unknown as LobbyState;

vi.mock("./bindings", () => ({
  mpConnect: async (args: { serverKey: string; onEvent: FakeChannel }) => {
    wire.opened.push(args.serverKey);
    if (wire.failKeys.has(args.serverKey)) {
      throw new Error("refused");
    }
    wire.channels.set(args.serverKey, args.onEvent);
    return { connected: true };
  },
  mpConnectTachyon: async (args: {
    serverKey: string;
    onEvent: FakeChannel;
  }) => {
    wire.tachyonOpened.push(args.serverKey);
    if (wire.failKeys.has(args.serverKey)) {
      throw new Error("refused");
    }
    wire.channels.set(args.serverKey, args.onEvent);
    return { connected: true };
  },
  mpConnectZerok: async () => ({ connected: true }),
  mpSnapshot: async () => ({ state: emptyState() }),
  mpDisconnect: async () => ({ disconnected: true }),
  mpWaitUntilReady: async () => ({ ready: true }),
  mpActiveKeys: async () => ({ keys: wire.activeKeys }),
  mpReattach: async (args: { serverKey: string; onEvent: FakeChannel }) => {
    wire.channels.set(args.serverKey, args.onEvent);
    return { reattached: true };
  },
  mpCancelConnect: async () => ({ cancelled: true }),
  mpConfirmAgreement: async () => ({}),
  mpFriendList: async () => ({}),
  mpFriendRequestList: async () => ({}),
  mpIgnore: async () => ({}),
  mpIgnoreList: async () => ({}),
  mpJoinBattle: async () => ({}),
  mpJoinChannel: async () => ({}),
  mpRegister: async () => ({}),
  mpRegisterZerok: async () => ({}),
  mpSetStatus: async () => ({}),
  mpTachyonSignedIn: async ({
    serverId,
    username,
  }: {
    serverId: string;
    username: string;
  }) => ({ signedIn: wire.signedIn.get(`${serverId}:${username}`) ?? true }),
  mpTachyonSignIn: async () => {
    throw new Error("boot must never sign in through the browser");
  },
}));

vi.mock("../lobby-servers/bindings", () => ({
  lsGetCredential: async () => ({ secret: "hunter2" }),
}));

import { MultiplayerProvider, useConnection, useMultiplayer } from "./store";

// Two built-in TASServer entries, distinct hosts, so a connect to one never
// blocks the other under the one-connection-per-host rule.
const KEY_A = "AF@server4.beyondallreason.info:8201"; // bar-ssl
const KEY_B = "Zeta@lobby.recoilengine.org:8200"; // recoil-official
// The Tachyon sibling of bar-ssl's host, a separate account entirely.
const TACHYON_KEY = "Nova@server4.beyondallreason.info:443"; // bar-tachyon

let store: ReturnType<typeof useMultiplayer>;
let connA: ReturnType<typeof useConnection>;
let connB: ReturnType<typeof useConnection>;

function Probe() {
  store = useMultiplayer();
  connA = useConnection(KEY_A);
  connB = useConnection(KEY_B);
  return null;
}

async function mount() {
  render(
    <MultiplayerProvider>
      <Probe />
    </MultiplayerProvider>,
  );
  await act(async () => {});
}

beforeEach(() => {
  wire.channels.clear();
  wire.opened.length = 0;
  wire.tachyonOpened.length = 0;
  wire.failKeys.clear();
  wire.notified.length = 0;
  wire.activeKeys = [];
  wire.signedIn.clear();
  settings.lastLogin = null;
  settings.accounts = { accounts: [] };
  settings.autoConnect = true;
});

afterEach(() => {
  cleanup();
});

describe("boot auto-connect reconnects every remembered login", () => {
  it("connects every account flagged openAtQuit, not only one", async () => {
    settings.accounts = {
      accounts: [
        { id: "a1", serverId: "bar-ssl", username: "AF", openAtQuit: true },
        {
          id: "a2",
          serverId: "recoil-official",
          username: "Zeta",
          openAtQuit: true,
        },
      ],
    };
    await mount();

    expect(connA?.live).toBe(true);
    expect(connB?.live).toBe(true);
    expect(wire.opened.sort()).toEqual([KEY_A, KEY_B].sort());
  });

  it("still reconnects a lone lastLogin for a player upgrading from before the flag", async () => {
    // Neither account carries `openAtQuit` at all, matching a settings file
    // saved before this flag existed.
    settings.accounts = {
      accounts: [{ id: "a1", serverId: "bar-ssl", username: "AF" }],
    };
    settings.lastLogin = { serverId: "bar-ssl", username: "AF" };
    await mount();

    expect(connA?.live).toBe(true);
    expect(wire.opened).toEqual([KEY_A]);
  });

  it("does not connect anything when auto-connect is off", async () => {
    settings.autoConnect = false;
    settings.accounts = {
      accounts: [
        { id: "a1", serverId: "bar-ssl", username: "AF", openAtQuit: true },
      ],
    };
    await mount();

    expect(wire.opened).toEqual([]);
  });

  it("keeps connecting the rest when one login fails, notifying for each on its own", async () => {
    settings.accounts = {
      accounts: [
        { id: "a1", serverId: "bar-ssl", username: "AF", openAtQuit: true },
        {
          id: "a2",
          serverId: "recoil-official",
          username: "Zeta",
          openAtQuit: true,
        },
      ],
    };
    wire.failKeys.add(KEY_A);
    await mount();

    // The failing login was attempted and did not stop the other from
    // connecting.
    expect(wire.opened.sort()).toEqual([KEY_A, KEY_B].sort());
    expect(connA?.live).toBe(false);
    expect(connB?.live).toBe(true);
    // One notification, naming the login that failed.
    const failures = wire.notified.filter(
      (n) => n.title === "Couldn't connect to multiplayer",
    );
    expect(failures).toHaveLength(1);
    expect(failures[0].body).toContain("AF");
  });

  it("skips a Tachyon login needing a new sign-in without ever calling signIn", async () => {
    settings.accounts = {
      accounts: [
        {
          id: "a1",
          serverId: "bar-tachyon",
          username: "Nova",
          openAtQuit: true,
        },
      ],
    };
    wire.signedIn.set("bar-tachyon:Nova", false);
    await mount();

    // Never attempted the connect at all, and never touched the browser
    // sign-in (which would have thrown in the mock above).
    expect(wire.tachyonOpened).toEqual([]);
    expect(
      wire.notified.some((n) => n.title === "Signed out of multiplayer"),
    ).toBe(true);
  });

  it("connects a Tachyon login whose stored sign-in is still good", async () => {
    settings.accounts = {
      accounts: [
        {
          id: "a1",
          serverId: "bar-tachyon",
          username: "Nova",
          openAtQuit: true,
        },
      ],
    };
    await mount();

    expect(wire.tachyonOpened).toEqual([TACHYON_KEY]);
  });

  it("focuses the first login to connect, not the last", async () => {
    settings.accounts = {
      accounts: [
        { id: "a1", serverId: "bar-ssl", username: "AF", openAtQuit: true },
        {
          id: "a2",
          serverId: "recoil-official",
          username: "Zeta",
          openAtQuit: true,
        },
      ],
    };
    await mount();

    expect(store.activeKey).toBe(KEY_A);
  });
});

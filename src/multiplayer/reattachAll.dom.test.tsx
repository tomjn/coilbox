// @vitest-environment happy-dom

/**
 * After a webview reload the Rust side can hold more than one open lobby
 * connection (issue #2841 lifted the one-connection limit for a reattach, even
 * though a fresh connect is still gated to one). The boot rehydrate effect used
 * to adopt only `keys[0]` from `mpActiveKeys`, so a second connection open in
 * Rust had nothing on screen able to use it or close it (issue #2842).
 *
 * The mock setup is copied from `connectionState.dom.test.tsx`.
 */

import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LobbyEvent, LobbyState } from "./bindings";

interface FakeChannel {
  onmessage?: (ev: LobbyEvent) => void;
}

const wire = vi.hoisted(() => ({
  /** The event channel each connect/reattach handed the Rust side, by server key. */
  channels: new Map<string, FakeChannel>(),
  /** Keys `mp_disconnect` was called with. */
  closed: [] as string[],
  /** Keys `mp_active_keys` answers with at boot, set per test. */
  activeKeys: [] as string[],
}));

// The settings store, as much of it as the provider reads: a value per key
// starting at the default, except the two settings this test drives directly
// (the last login and the saved accounts), which read a preset value instead
// so `resolveLastLogin` has something to match against.
const settings = vi.hoisted(() => ({
  lastLogin: null as { serverId: string; username: string } | null,
  accounts: {
    accounts: [] as { id: string; serverId: string; username: string }[],
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

vi.mock("../notify/notify", () => ({ notify: async () => {} }));
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
    wire.channels.set(args.serverKey, args.onEvent);
    return { connected: true };
  },
  mpConnectTachyon: async () => ({ connected: true }),
  mpConnectZerok: async () => ({ connected: true }),
  mpSnapshot: async () => ({ state: emptyState() }),
  mpDisconnect: async ({ serverKey }: { serverKey: string }) => {
    wire.closed.push(serverKey);
    return { disconnected: true };
  },
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
  mpTachyonSignedIn: async () => ({ signedIn: true }),
  mpTachyonSignIn: async () => ({}),
}));

vi.mock("../lobby-servers/bindings", () => ({
  lsGetCredential: async () => ({ secret: "hunter2" }),
}));

import { MultiplayerProvider, useConnection, useMultiplayer } from "./store";

// Two built-in servers, so no custom-server setup is needed to resolve them.
const KEY_A = "AF@server4.beyondallreason.info:8201"; // bar-ssl
const KEY_B = "Zeta@lobby.recoilengine.org:8200"; // recoil-official

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
  wire.closed.length = 0;
  wire.activeKeys = [];
  settings.lastLogin = null;
  settings.accounts = { accounts: [] };
  settings.autoConnect = false;
});

afterEach(() => {
  cleanup();
});

describe("reattach every open connection on reload", () => {
  it("reattaches both keys mpActiveKeys returns, each into its own live entry", async () => {
    wire.activeKeys = [KEY_A, KEY_B];
    await mount();

    expect(Object.keys(store.connections).sort()).toEqual(
      [KEY_A, KEY_B].sort(),
    );
    expect(connA?.live).toBe(true);
    expect(connB?.live).toBe(true);
    expect(wire.channels.size).toBe(2);
  });

  it("focuses the last login when it matches one of the reattached keys, even out of order", async () => {
    wire.activeKeys = [KEY_A, KEY_B];
    settings.lastLogin = { serverId: "recoil-official", username: "Zeta" };
    settings.accounts = {
      accounts: [{ id: "a1", serverId: "recoil-official", username: "Zeta" }],
    };
    await mount();

    expect(store.activeKey).toBe(KEY_B);
  });

  it("falls back to the first key and skips boot auto-connect when the last login is not among them", async () => {
    wire.activeKeys = [KEY_A, KEY_B];
    // Resolvable to a real, different account, and auto-connect opted in, so a
    // rehydrate that didn't skip the boot fallback would open a third
    // connection here.
    settings.autoConnect = true;
    settings.lastLogin = { serverId: "techa", username: "ShouldNotConnect" };
    settings.accounts = {
      accounts: [{ id: "a2", serverId: "techa", username: "ShouldNotConnect" }],
    };
    await mount();

    expect(store.activeKey).toBe(KEY_A);
    expect(wire.channels.size).toBe(2);
    expect(
      [...wire.channels.keys()].some((k) => k.includes("ShouldNotConnect")),
    ).toBe(false);
  });

  it("logs out each reattached connection independently", async () => {
    wire.activeKeys = [KEY_A, KEY_B];
    await mount();

    await act(async () => {
      await store.disconnect(KEY_A);
    });
    expect(wire.closed).toEqual([KEY_A]);
    expect(connA).toBeNull();
    expect(connB?.live).toBe(true);

    await act(async () => {
      await store.disconnect(KEY_B);
    });
    expect(wire.closed).toEqual([KEY_A, KEY_B]);
    expect(connB).toBeNull();
    expect(Object.keys(store.connections)).toEqual([]);
  });
});

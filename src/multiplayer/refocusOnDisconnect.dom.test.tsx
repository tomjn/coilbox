// @vitest-environment happy-dom

/**
 * With #2841 lifting the one-connection limit for a reattach, two connections
 * can be live at once, but only one of them was ever `activeKey`. Logging out
 * of the focused one, or having it drop unexpectedly, used to clear `activeKey`
 * to null even though the other connection was still live and reachable only
 * from surfaces that read `connections` directly (issue #2894).
 *
 * The mock setup is copied from `reattachAll.dom.test.tsx`, which is the only
 * way today's `connect()` gate allows two live connections to exist.
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

/** Push an event up the channel a connection was opened with. */
async function fire(serverKey: string, ev: LobbyEvent) {
  const channel = wire.channels.get(serverKey);
  if (!channel?.onmessage) throw new Error(`no channel for ${serverKey}`);
  await act(async () => {
    channel.onmessage?.(ev);
  });
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

describe("refocus after the focused connection goes away", () => {
  it("moves focus to the other live connection on a manual disconnect", async () => {
    wire.activeKeys = [KEY_A, KEY_B];
    await mount();
    // Boot reattach falls back to the first key when the last login doesn't
    // resolve to either, matching reattachAll.dom.test.tsx.
    expect(store.activeKey).toBe(KEY_A);

    await act(async () => {
      await store.disconnect(KEY_A);
    });

    expect(wire.closed).toEqual([KEY_A]);
    expect(store.activeKey).toBe(KEY_B);
    expect(store.connected).toBe(true);
    expect(connA).toBeNull();
    expect(connB?.live).toBe(true);
  });

  it("moves focus to the other live connection when the focused one drops unexpectedly", async () => {
    wire.activeKeys = [KEY_A, KEY_B];
    await mount();
    expect(store.activeKey).toBe(KEY_A);

    await fire(KEY_A, { kind: "disconnected", reason: "connection reset" });

    expect(store.activeKey).toBe(KEY_B);
    expect(store.connected).toBe(true);
    // A dropped entry stays in `connections`, not live, so its error is still
    // reachable, and the reconnect loop can still find it.
    expect(connA).not.toBeNull();
    expect(connA?.live).toBe(false);
    expect(connB?.live).toBe(true);
  });
});

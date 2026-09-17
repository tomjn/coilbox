// @vitest-environment happy-dom

/**
 * `LobbyAccount.openAtQuit` is what {@link rememberedLogins} reads at boot
 * (issue #2849). This drives the provider for real to prove the two moments
 * that write it: a successful connect sets it, and a manual log out clears
 * it. An unexpected drop leaves it alone, which is what lets a connection
 * still reconnecting, or one simply left open when coilbox quit, be
 * remembered at the next boot.
 *
 * Unlike the other provider tests, the settings mock here is a real shared
 * store rather than one independent `useState` per hook call: the write
 * happens inside the provider, and this file has to read it back to check it,
 * which only works if every `useSetting("lobbyServers.accounts", ...)` call
 * shares one value.
 */

import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LobbyEvent, LobbyState } from "./bindings";

interface FakeChannel {
  onmessage?: (ev: LobbyEvent) => void;
}

type StoredAccount = {
  id: string;
  serverId: string;
  username: string;
  openAtQuit?: boolean;
};

const shared = vi.hoisted(() => ({
  store: {
    "lobbyServers.accounts": {
      accounts: [
        { id: "a1", serverId: "bar-ssl", username: "AF" },
      ] as StoredAccount[],
    },
    "lobbyServers.servers": { servers: [] },
    "lobbyServers.lastLogin": null,
    "multiplayer.autoConnect": false,
  } as Record<string, unknown>,
  listeners: new Set<() => void>(),
}));

function accounts(): StoredAccount[] {
  return (
    shared.store["lobbyServers.accounts"] as { accounts: StoredAccount[] }
  ).accounts;
}

vi.mock("@tauri-apps/api/core", () => ({
  Channel: class {
    onmessage?: (ev: LobbyEvent) => void;
  },
}));

vi.mock("@picoframe/frame", async () => {
  const react = await import("react");
  return {
    useSetting: (key: string, initial: unknown) => {
      const [, force] = react.useReducer((c: number) => c + 1, 0);
      react.useEffect(() => {
        const listener = () => force();
        shared.listeners.add(listener);
        return () => {
          shared.listeners.delete(listener);
        };
      }, []);
      if (!(key in shared.store)) shared.store[key] = initial;
      const setValue = (value: unknown) => {
        shared.store[key] =
          typeof value === "function"
            ? (value as (prev: unknown) => unknown)(shared.store[key])
            : value;
        for (const listener of shared.listeners) listener();
      };
      return [shared.store[key], setValue];
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

const wire = vi.hoisted(() => ({
  channels: new Map<string, FakeChannel>(),
}));

vi.mock("./bindings", () => ({
  mpConnect: async (args: { serverKey: string; onEvent: FakeChannel }) => {
    wire.channels.set(args.serverKey, args.onEvent);
    return { connected: true };
  },
  mpConnectTachyon: async () => ({ connected: true }),
  mpConnectZerok: async () => ({ connected: true }),
  mpSnapshot: async () => ({ state: emptyState() }),
  mpDisconnect: async () => ({ disconnected: true }),
  mpWaitUntilReady: async () => ({ ready: true }),
  mpActiveKeys: async () => ({ keys: [] }),
  mpReattach: async () => ({ reattached: true }),
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

import { BUILTIN_SERVERS } from "../lobby-servers/config";
import { MultiplayerProvider, useMultiplayer } from "./store";

const BAR = BUILTIN_SERVERS.find((s) => s.id === "bar-ssl");
if (!BAR) throw new Error("no bar-ssl in BUILTIN_SERVERS");
const KEY = "AF@server4.beyondallreason.info:8201";

let store: ReturnType<typeof useMultiplayer>;

function Probe() {
  store = useMultiplayer();
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
  shared.store["lobbyServers.accounts"] = {
    accounts: [{ id: "a1", serverId: "bar-ssl", username: "AF" }],
  };
  shared.store["lobbyServers.lastLogin"] = null;
  shared.store["multiplayer.autoConnect"] = false;
});

afterEach(() => {
  cleanup();
  shared.listeners.clear();
});

describe("openAtQuit", () => {
  it("is flagged on the saved account once a connect succeeds", async () => {
    await mount();
    await act(async () => {
      await store.connect(BAR, "AF");
    });

    expect(accounts()[0].openAtQuit).toBe(true);
  });

  it("is cleared by a manual log out", async () => {
    await mount();
    await act(async () => {
      await store.connect(BAR, "AF");
    });
    expect(accounts()[0].openAtQuit).toBe(true);

    await act(async () => {
      await store.disconnect(KEY);
    });
    expect(accounts()[0].openAtQuit).toBe(false);
  });

  it("stays set across an unexpected drop, which a later reconnect should still cover", async () => {
    await mount();
    await act(async () => {
      await store.connect(BAR, "AF");
    });
    expect(accounts()[0].openAtQuit).toBe(true);

    await fire(KEY, { kind: "disconnected", reason: "connection reset" });

    expect(accounts()[0].openAtQuit).toBe(true);
  });
});

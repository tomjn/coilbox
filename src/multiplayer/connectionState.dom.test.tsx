// @vitest-environment happy-dom

/**
 * The provider holds each connection's state under its own server key (issue
 * #2841), so an event on one connection changes that connection's entry and
 * nothing else.
 *
 * Coilbox still allows one live connection, so the second entry here is a
 * connection that dropped before logging in. Its entry stays so the reason it
 * dropped can be shown, and its channel is still wired, which is the case a
 * single shared mirror got wrong: anything it sent landed in the mirror of
 * whichever connection was in use.
 *
 * The mock setup is copied from `oneLobbyConnection.dom.test.tsx`.
 */

import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LobbyServer } from "../lobby-servers/config";
import {
  installSettingsStorage,
  memorySettingsStorage,
} from "../lib/storedSetting";
import type { LobbyEvent, LobbyState } from "./bindings";

interface FakeChannel {
  onmessage?: (ev: LobbyEvent) => void;
}

const wire = vi.hoisted(() => ({
  /** The event channel each connect handed the Rust side, by server key. */
  channels: new Map<string, FakeChannel>(),
  /** Keys `mp_disconnect` was called with. */
  closed: [] as string[],
}));

vi.mock("@tauri-apps/api/core", () => ({
  Channel: class {
    onmessage?: (ev: LobbyEvent) => void;
  },
}));

vi.mock("@picoframe/frame", async () => {
  const react = await import("react");
  return {
    useSetting: <T,>(_key: string, initial: T) => react.useState<T>(initial),
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
  mpActiveKeys: async () => ({ keys: [] as string[] }),
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

import { MultiplayerProvider, useConnection, useMultiplayer } from "./store";

const LOBBY: LobbyServer = {
  id: "bar-ssl",
  name: "Beyond All Reason",
  host: "server4.beyondallreason.info",
  port: 8201,
  tls: true,
  tlsStyle: "direct",
  allowSelfSigned: false,
};
const LOBBY_KEY = "AF_@server4.beyondallreason.info:8201";
const ROOM_KEY = "AF@127.0.0.1:8200";

let store: ReturnType<typeof useMultiplayer>;
let lobby: ReturnType<typeof useConnection>;
let room: ReturnType<typeof useConnection>;

function Probe() {
  store = useMultiplayer();
  lobby = useConnection(LOBBY_KEY);
  room = useConnection(ROOM_KEY);
  return null;
}

async function fire(serverKey: string, ev: LobbyEvent) {
  const channel = wire.channels.get(serverKey);
  if (!channel?.onmessage) throw new Error(`no channel for ${serverKey}`);
  await act(async () => {
    channel.onmessage?.(ev);
  });
}

/**
 * The provider with two entries: the lobby, which dropped before logging in,
 * and a room, which is live.
 */
async function mountWithTwoEntries() {
  render(
    <MultiplayerProvider>
      <Probe />
    </MultiplayerProvider>,
  );
  await act(async () => {});
  await act(async () => {
    await store.connect(LOBBY, "AF_");
  });
  await fire(LOBBY_KEY, { kind: "disconnected", reason: "Bad password" });
  await act(async () => {
    await store.connectDirect(8200, "AF");
  });
}

beforeEach(() => {
  // `useSetting` is mocked as plain `useState` here, so nothing ever writes
  // through to this. It only has to exist: `seedJoinedChannels` reads through
  // it before seeding a first connect's auto-join channels (issue #2920).
  installSettingsStorage(memorySettingsStorage());
  wire.channels.clear();
  wire.closed.length = 0;
});

afterEach(() => {
  cleanup();
});

describe("per-connection state", () => {
  it("holds both connections under their own keys", async () => {
    await mountWithTwoEntries();

    expect(Object.keys(store.connections).sort()).toEqual(
      [LOBBY_KEY, ROOM_KEY].sort(),
    );
    expect(store.activeKey).toBe(ROOM_KEY);
    expect(room?.live).toBe(true);
    expect(lobby?.live).toBe(false);
    expect(lobby?.mirror.error).toBe("Bad password");
    expect(room?.mirror.error).toBeNull();
    expect(entryFor("nobody@nowhere:1")).toBeNull();
  });

  it("an event on the live connection leaves the other entry untouched", async () => {
    await mountWithTwoEntries();
    const lobbyBefore = lobby;

    await fire(ROOM_KEY, { kind: "phase", phase: "ready", agreement: null });
    await fire(ROOM_KEY, {
      kind: "console",
      direction: "in",
      line: "ACCEPTED AF",
    });
    await fire(ROOM_KEY, {
      kind: "delta",
      delta: {
        kind: "accountInfo",
        registrationDate: null,
        email: "af@example.com",
        ingameHours: null,
      },
    });

    expect(room?.mirror.phase).toBe("ready");
    expect(room?.mirror.consoleLines).toContain("<< ACCEPTED AF");
    expect(room?.accountInfo?.email).toBe("af@example.com");
    expect(lobby).toBe(lobbyBefore);
    // The context's own fields follow the live connection.
    expect(store.mirror.phase).toBe("ready");
    expect(store.accountInfo?.email).toBe("af@example.com");
  });

  it("an event on the other connection does not reach the live one", async () => {
    await mountWithTwoEntries();
    const roomBefore = room;
    const mirrorBefore = store.mirror;

    await fire(LOBBY_KEY, {
      kind: "console",
      direction: "in",
      line: "SERVERMSG late",
    });
    await fire(LOBBY_KEY, {
      kind: "phase",
      phase: "awaitAgreement",
      agreement: "Terms",
    });
    await fire(LOBBY_KEY, {
      kind: "delta",
      delta: { kind: "joinChannelFailed", channel: "main", reason: "banned" },
    });

    expect(lobby?.mirror.consoleLines).toContain("<< SERVERMSG late");
    expect(lobby?.agreement).toBe("Terms");
    expect(lobby?.channelJoinFailures).toEqual({ main: "banned" });
    expect(room).toBe(roomBefore);
    expect(store.mirror).toBe(mirrorBefore);
    expect(store.channelJoinFailures).toEqual({});
  });

  it("disconnect with a key closes that connection and leaves the live one", async () => {
    await mountWithTwoEntries();

    await act(async () => {
      await store.disconnect(LOBBY_KEY);
    });

    expect(wire.closed).toEqual([LOBBY_KEY]);
    expect(lobby).toBeNull();
    expect(room?.live).toBe(true);
    expect(store.activeKey).toBe(ROOM_KEY);

    // Its channel is dead to the provider now, so a late event is dropped
    // rather than bringing the entry back.
    await fire(LOBBY_KEY, {
      kind: "console",
      direction: "in",
      line: "late",
    });
    expect(lobby).toBeNull();
  });
});

/** An entry read outside a render, from the probe's last context. */
function entryFor(serverKey: string) {
  return store.connections[serverKey] ?? null;
}

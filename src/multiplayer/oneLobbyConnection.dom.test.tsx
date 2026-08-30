// @vitest-environment happy-dom

/**
 * Coilbox holds one lobby connection, driven through the provider that owns it
 * (issue #2149).
 *
 * The rule was written on three forms and enforced nowhere. `doConnect` never
 * read the active key, so a connection landing behind an open drawer was a
 * second live socket. `disconnect` closed only the active key, so the other one
 * could not be reached from the interface at all. And a drop cleared the active
 * key whoever it belonged to, so the leftover logging itself out logged somebody
 * out of the connection they were using.
 *
 * These drive the real provider rather than a copy of its logic, because every
 * part of the bug was in the wiring: which ref is read, when it is written, and
 * which callback is frozen. A pure function standing in for that would have
 * passed on the day the bug shipped.
 */

import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LobbyServer } from "../lobby-servers/config";
import type { LobbyEvent, LobbyState } from "./bindings";

interface FakeChannel {
  onmessage?: (ev: LobbyEvent) => void;
}

const wire = vi.hoisted(() => ({
  /** The event channel each connect handed the Rust side, by server key. */
  channels: new Map<string, FakeChannel>(),
  /** Titles passed to `notify`, so a spurious reconnect can be seen. */
  notified: [] as string[],
  /** Held while a connect is meant to stay mid-handshake. */
  gate: null as Promise<void> | null,
  /** Keys `mp_disconnect` was called with. */
  closed: [] as string[],
}));

vi.mock("@tauri-apps/api/core", () => ({
  Channel: class {
    onmessage?: (ev: LobbyEvent) => void;
  },
}));

// The settings store, as much of it as the provider reads: a value per key that
// starts at the default and can be set. Every list the provider keeps (channels,
// favourites, ignores, accounts) goes through this.
vi.mock("@picoframe/frame", async () => {
  const react = await import("react");
  return {
    useSetting: <T,>(_key: string, initial: T) => react.useState<T>(initial),
  };
});

vi.mock("../notify/notify", () => ({
  notify: async ({ title }: { title: string }) => {
    wire.notified.push(title);
  },
}));

// Audio and taskbar cues all touch `window` at module scope for their unlock
// listeners, and nothing here rings or flashes.
vi.mock("./ringEffect", () => ({ triggerRing: () => {} }));
vi.mock("./ingameCue", () => ({ triggerIngameCue: () => {} }));
vi.mock("./chat/mentionCue", () => ({ triggerMentionCue: () => {} }));

// The provider renders three of its own dialogs. They read the context this is
// testing and drag in the whole component library with them.
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
    if (wire.gate) await wire.gate;
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

import { MultiplayerProvider, useMultiplayer } from "./store";

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

function Probe() {
  store = useMultiplayer();
  return <span data-testid="active">{store.activeKey ?? "none"}</span>;
}

/** The provider, mounted, with the boot reattach settled. */
async function mount() {
  render(
    <MultiplayerProvider>
      <Probe />
    </MultiplayerProvider>,
  );
  await act(async () => {});
}

const activeKey = () => screen.getByTestId("active").textContent;

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
  wire.notified.length = 0;
  wire.closed.length = 0;
  wire.gate = null;
});

afterEach(() => {
  cleanup();
});

describe("one lobby connection", () => {
  it("refuses a second connection and says which one is in the way", async () => {
    await mount();
    await act(async () => {
      await store.connect(LOBBY, "AF_");
    });
    expect(activeKey()).toBe(LOBBY_KEY);

    // The traced sequence: a host form opened while disconnected, a connection
    // arriving behind it, and Start pressed against a gate decided minutes ago.
    await expect(store.connectDirect(8200, "AF")).rejects.toThrow(
      /server4\.beyondallreason\.info:8201/,
    );
    expect(wire.channels.has(ROOM_KEY)).toBe(false);
    expect(activeKey()).toBe(LOBBY_KEY);
  });

  it("refuses a connect racing one that is still shaking hands", async () => {
    await mount();
    let release = () => {};
    wire.gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    // Started, not awaited: this one is parked inside `mp_connect`, which is
    // where an auto-reconnect sits while somebody logs in over the top of it.
    const first = store.connectDirect(8200, "AF");
    wire.gate = null;

    await expect(store.connect(LOBBY, "AF_")).rejects.toThrow(/already opening/);

    await act(async () => {
      release();
      await first;
    });
    expect(activeKey()).toBe(ROOM_KEY);
  });

  it("leaves the live connection alone when a stale one drops", async () => {
    await mount();
    await act(async () => {
      await store.connect(LOBBY, "AF_");
    });
    await act(async () => {
      await store.disconnect();
    });
    await act(async () => {
      await store.connectDirect(8200, "AF");
    });
    expect(activeKey()).toBe(ROOM_KEY);
    // A session that reached `ready` is the only kind whose drop is worth
    // reconnecting, so this is the state in which a stale drop did the most
    // damage.
    await fire(ROOM_KEY, { kind: "phase", phase: "ready", agreement: null });
    wire.notified.length = 0;

    // The lobby connection, which the interface can no longer reach, finally
    // falls over. It used to take the room with it.
    await fire(LOBBY_KEY, { kind: "disconnected", reason: "server closed" });

    expect(activeKey()).toBe(ROOM_KEY);
    expect(wire.notified).not.toContain("Connection lost — reconnecting…");
  });

  it("still returns to disconnected when the live connection drops", async () => {
    await mount();
    await act(async () => {
      await store.connectDirect(8200, "AF");
    });
    await fire(ROOM_KEY, { kind: "phase", phase: "ready", agreement: null });
    await fire(ROOM_KEY, { kind: "disconnected", reason: "room closed" });
    expect(activeKey()).toBe("none");
  });
});

// @vitest-environment happy-dom

/**
 * Coilbox holds one connection per lobby server, and one room beside them,
 * driven through the provider that owns them (issues #2149, #2848 and #2850).
 *
 * The rule used to be one connection in all. #2149 found it written on three
 * forms and enforced nowhere: a connection landing behind an open drawer was a
 * second live socket, `disconnect` could not reach it, and its drop logged
 * somebody out of the connection they were using. #2848 lifts the rule to one
 * connection per server, so every case here runs with two connections open and
 * checks the one it is not about is left alone.
 *
 * These drive the real provider rather than a copy of its logic, because every
 * part of the bug was in the wiring: which ref is read, when it is written, and
 * which callback is frozen. A pure function standing in for that would have
 * passed on the day the bug shipped.
 */

import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BUILTIN_SERVERS, type LobbyServer } from "../lobby-servers/config";
import type { LobbyEvent, LobbyState } from "./bindings";

interface FakeChannel {
  onmessage?: (ev: LobbyEvent) => void;
}

const wire = vi.hoisted(() => ({
  /** The event channel each connect handed the Rust side, by server key. */
  channels: new Map<string, FakeChannel>(),
  /** Every key a connect was opened for, in order, repeats included. */
  opened: [] as string[],
  /** Titles passed to `notify`, so a spurious reconnect can be seen. */
  notified: [] as string[],
  /** Connects meant to stay mid-handshake, by key, until released. */
  gates: new Map<string, Promise<void>>(),
  /** Keys `mp_disconnect` was called with. */
  closed: [] as string[],
  /** Keys the boot reattach finds, and a gate holding that lookup back. */
  activeKeys: [] as string[],
  activeKeysGate: null as Promise<void> | null,
  /** Held while a room is meant to be mid-greeting, then answered. */
  readyGate: null as Promise<void> | null,
  readyFails: false,
  /** Every `MYSTATUS` sent, as `key ingame away`. */
  statuses: [] as string[],
  /** Every channel join sent, as `key channel`. */
  joins: [] as string[],
  /** Saved settings, kept across a remount the way a reload keeps them. */
  settings: new Map<string, unknown>(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  Channel: class {
    onmessage?: (ev: LobbyEvent) => void;
  },
}));

// The settings store, as much of it as the provider reads: a value per key that
// starts at the default and can be set. Every list the provider keeps (channels,
// favourites, ignores, accounts) goes through this. Values outlive a remount,
// which is what a reload does to them.
vi.mock("@picoframe/frame", async () => {
  const react = await import("react");
  return {
    useSetting: <T,>(key: string, initial: T) => {
      const [value, setValue] = react.useState<T>(() =>
        wire.settings.has(key) ? (wire.settings.get(key) as T) : initial,
      );
      const save = react.useCallback(
        (next: T) => {
          wire.settings.set(key, next);
          setValue(next);
        },
        [key],
      );
      return [value, save] as const;
    },
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

// The provider renders four of its own dialogs. They read the context this is
// testing and drag in the whole component library with them.
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

vi.mock("./bindings", () => {
  const open = async (args: { serverKey: string; onEvent: FakeChannel }) => {
    wire.opened.push(args.serverKey);
    wire.channels.set(args.serverKey, args.onEvent);
    const gate = wire.gates.get(args.serverKey);
    if (gate) await gate;
    return { connected: true };
  };
  return {
    mpConnect: open,
    mpConnectTachyon: open,
    mpConnectZerok: open,
    mpSnapshot: async () => ({ state: emptyState() }),
    mpDisconnect: async ({ serverKey }: { serverKey: string }) => {
      wire.closed.push(serverKey);
      return { disconnected: true };
    },
    mpWaitUntilReady: async () => {
      if (wire.readyGate) await wire.readyGate;
      if (wire.readyFails) throw new Error("the room never greeted us");
      return { ready: true };
    },
    mpActiveKeys: async () => {
      if (wire.activeKeysGate) await wire.activeKeysGate;
      return { keys: wire.activeKeys };
    },
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
    mpJoinChannel: async (args: { serverKey: string; channel: string }) => {
      wire.joins.push(`${args.serverKey} ${args.channel}`);
      return {};
    },
    mpRegister: async () => ({}),
    mpRegisterZerok: async () => ({}),
    mpSetStatus: async (args: {
      serverKey: string;
      ingame: boolean;
      away: boolean;
    }) => {
      wire.statuses.push(`${args.serverKey} ${args.ingame} ${args.away}`);
      return {};
    },
    mpTachyonSignedIn: async () => ({ signedIn: true }),
    mpTachyonSignIn: async () => ({}),
  };
});

vi.mock("../lobby-servers/bindings", () => ({
  lsGetCredential: async () => ({ secret: "hunter2" }),
}));

import { MultiplayerProvider, useMultiplayer } from "./store";

const builtin = (id: string): LobbyServer => {
  const server = BUILTIN_SERVERS.find((s) => s.id === id);
  if (!server) throw new Error(`no built-in server ${id}`);
  return server;
};

// Beyond All Reason's two entries share a host, so they are one server.
const BAR = builtin("bar-ssl");
const BAR_TACHYON = builtin("bar-tachyon");
const TECHA = builtin("techa");
const RECOIL = builtin("recoil-official");
const BAR_KEY = "AF_@server4.beyondallreason.info:8201";
const TECHA_KEY = "AF_@lobby.techa-rts.com:8200";
const RECOIL_KEY = "AF_@lobby.recoilengine.org:8200";
const ROOM_KEY = "AF@127.0.0.1:8200";
const RECONNECTING = "Connection lost — reconnecting…";

let store: ReturnType<typeof useMultiplayer>;

function Probe() {
  store = useMultiplayer();
  return null;
}

/** The provider, mounted, with the boot reattach settled unless held back. */
async function mount() {
  render(
    <MultiplayerProvider>
      <Probe />
    </MultiplayerProvider>,
  );
  await act(async () => {});
}

const live = (key: string) => store.connections[key]?.live;

/** Push an event up the channel a connection was opened with. */
async function fire(serverKey: string, ev: LobbyEvent) {
  const channel = wire.channels.get(serverKey);
  if (!channel?.onmessage) throw new Error(`no channel for ${serverKey}`);
  await act(async () => {
    channel.onmessage?.(ev);
  });
}

const ready = (serverKey: string) =>
  fire(serverKey, { kind: "phase", phase: "ready", agreement: null });

/** Hold a key's connect mid-handshake. Returns its release. */
function hold(serverKey: string): () => void {
  let release = () => {};
  wire.gates.set(
    serverKey,
    new Promise<void>((resolve) => {
      release = resolve;
    }),
  );
  return release;
}

/** Logged in to Beyond All Reason, then Tech Annihilation, both ready. */
async function twoLogins() {
  await mount();
  await act(async () => {
    await store.connect(BAR, "AF_");
  });
  await act(async () => {
    await store.connect(TECHA, "AF_");
  });
  await ready(BAR_KEY);
  await ready(TECHA_KEY);
  wire.notified.length = 0;
}

/** Logged in to Beyond All Reason, with a room of our own beside it. */
async function roomBesideLobby() {
  await mount();
  await act(async () => {
    await store.connect(BAR, "AF_");
  });
  await act(async () => {
    await store.connectDirect(8200, "AF");
  });
  await ready(BAR_KEY);
  await ready(ROOM_KEY);
  wire.notified.length = 0;
}

beforeEach(() => {
  wire.channels.clear();
  wire.opened.length = 0;
  wire.notified.length = 0;
  wire.gates.clear();
  wire.closed.length = 0;
  wire.activeKeys = [];
  wire.activeKeysGate = null;
  wire.readyGate = null;
  wire.readyFails = false;
  wire.statuses.length = 0;
  wire.joins.length = 0;
  wire.settings.clear();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("one connection per lobby server", () => {
  it("opens a login to a second server without closing the first", async () => {
    await twoLogins();
    expect(live(BAR_KEY)).toBe(true);
    expect(live(TECHA_KEY)).toBe(true);
    // The login just pressed is the one the interface shows.
    expect(store.activeKey).toBe(TECHA_KEY);
    expect(wire.closed).toEqual([]);
  });

  it("refuses a second account on the same server, through either of its entries, and names the first", async () => {
    await twoLogins();

    await expect(store.connect(BAR_TACHYON, "Bob")).rejects.toThrow(
      /server4\.beyondallreason\.info as AF_/,
    );
    await expect(store.connect(BAR, "Zed")).rejects.toThrow(/as AF_/);

    expect(wire.opened).toEqual([BAR_KEY, TECHA_KEY]);
    expect(live(BAR_KEY)).toBe(true);
    expect(live(TECHA_KEY)).toBe(true);
    expect(store.activeKey).toBe(TECHA_KEY);
  });

  it("refuses a connect racing one to the same server, and lets another server through", async () => {
    await mount();
    await act(async () => {
      await store.connect(TECHA, "AF_");
    });
    // Started, not awaited: this one is parked inside `mp_connect`, which is
    // where an auto-reconnect sits while somebody logs in over the top of it.
    const release = hold(BAR_KEY);
    const first = store.connect(BAR, "AF_");

    await expect(store.connect(BAR_TACHYON, "Bob")).rejects.toThrow(
      /already opening/,
    );
    await act(async () => {
      await store.connect(RECOIL, "AF_");
    });
    expect(live(RECOIL_KEY)).toBe(true);

    await act(async () => {
      release();
      await first;
    });
    expect(live(BAR_KEY)).toBe(true);
    expect(live(TECHA_KEY)).toBe(true);
    expect(live(RECOIL_KEY)).toBe(true);
  });

  it("leaves both live connections alone when a closed one drops", async () => {
    await mount();
    await act(async () => {
      await store.connect(RECOIL, "AF_");
    });
    // A session that reached `ready` is the only kind whose drop is worth
    // reconnecting, so this is the state in which a stale drop did the most
    // damage.
    await ready(RECOIL_KEY);
    await act(async () => {
      await store.disconnect(RECOIL_KEY);
    });
    await act(async () => {
      await store.connect(BAR, "AF_");
    });
    await act(async () => {
      await store.connect(TECHA, "AF_");
    });
    await ready(BAR_KEY);
    await ready(TECHA_KEY);
    wire.notified.length = 0;

    // The closed connection, which the interface can no longer reach, finally
    // falls over. It used to take the live one with it.
    await fire(RECOIL_KEY, { kind: "disconnected", reason: "server closed" });

    expect(store.activeKey).toBe(TECHA_KEY);
    expect(live(BAR_KEY)).toBe(true);
    expect(live(TECHA_KEY)).toBe(true);
    expect(store.connections[RECOIL_KEY]).toBeUndefined();
    expect(wire.notified).not.toContain(RECONNECTING);
  });

  it("handles a drop on the connection that is not focused, and leaves the focused one alone", async () => {
    await twoLogins();

    await fire(BAR_KEY, { kind: "disconnected", reason: "connection reset" });

    expect(live(BAR_KEY)).toBe(false);
    // The entry stays, so its reason can still be shown.
    expect(store.connections[BAR_KEY]).toBeDefined();
    expect(wire.notified).toContain(RECONNECTING);
    expect(store.activeKey).toBe(TECHA_KEY);
    expect(live(TECHA_KEY)).toBe(true);
  });

  it("moves to the other connection when the focused one drops, and to none after both", async () => {
    await twoLogins();

    await fire(TECHA_KEY, { kind: "disconnected", reason: "connection reset" });
    expect(store.activeKey).toBe(BAR_KEY);
    expect(live(BAR_KEY)).toBe(true);

    await fire(BAR_KEY, { kind: "disconnected", reason: "connection reset" });
    expect(store.activeKey).toBeNull();
    expect(store.connected).toBe(false);
  });
});

describe("reconnect loops beside a manual login", () => {
  it("keeps reconnecting a dropped server when somebody logs in to another", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    await twoLogins();
    await fire(BAR_KEY, { kind: "disconnected", reason: "connection reset" });
    expect(wire.notified).toContain(RECONNECTING);

    await act(async () => {
      await store.connect(RECOIL, "AF_");
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });

    expect(wire.opened.filter((k) => k === BAR_KEY)).toHaveLength(2);
    expect(live(BAR_KEY)).toBe(true);
    // Coming back does not pull the interface off the login just made.
    expect(store.activeKey).toBe(RECOIL_KEY);
    expect(live(TECHA_KEY)).toBe(true);
  });

  it("stops reconnecting a server once somebody logs in to it as someone else", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    await twoLogins();
    await fire(BAR_KEY, { kind: "disconnected", reason: "connection reset" });

    await act(async () => {
      await store.connect(BAR_TACHYON, "Bob");
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });

    expect(wire.opened.filter((k) => k === BAR_KEY)).toHaveLength(1);
    expect(live("Bob@server4.beyondallreason.info:443")).toBe(true);
    expect(live(TECHA_KEY)).toBe(true);
  });
});

describe("a room beside lobby logins (issue #2850)", () => {
  it("hosts a room while logged in to two lobby servers, and keeps both", async () => {
    await twoLogins();

    let key = "";
    await act(async () => {
      key = await store.connectDirect(8200, "AF");
    });

    expect(key).toBe(ROOM_KEY);
    expect(live(ROOM_KEY)).toBe(true);
    expect(live(BAR_KEY)).toBe(true);
    expect(live(TECHA_KEY)).toBe(true);
    expect(store.connections[ROOM_KEY].direct).toBe(true);
    expect(store.connections[BAR_KEY].direct).toBe(false);
    expect(store.connections[TECHA_KEY].direct).toBe(false);
    expect(wire.closed).toEqual([]);
  });

  // Chat, and everything else that reads the focused connection, stays on the
  // lobby login somebody was using. A room is reached through its own key.
  it("keeps the lobby login focused, so chat still goes to it", async () => {
    await twoLogins();
    await act(async () => {
      await store.connectDirect(8200, "AF");
    });
    await ready(ROOM_KEY);

    expect(store.activeKey).toBe(TECHA_KEY);
    // The fields read off the focused connection describe the login too.
    expect(store.mirror).toBe(store.connections[TECHA_KEY].mirror);
    await act(async () => {
      await store.requestJoinChannel("main");
    });
    expect(wire.joins).toEqual([`${TECHA_KEY} main`]);
  });

  it("closes the room and leaves the lobby logins alone", async () => {
    await twoLogins();
    await act(async () => {
      await store.connectDirect(8200, "AF");
    });
    await ready(ROOM_KEY);

    await act(async () => {
      await store.disconnect(ROOM_KEY);
    });
    // The room's own clean close, which must not read as a drop anywhere.
    await fire(ROOM_KEY, { kind: "disconnected", reason: null });

    expect(wire.closed).toEqual([ROOM_KEY]);
    expect(store.connections[ROOM_KEY]).toBeUndefined();
    expect(live(BAR_KEY)).toBe(true);
    expect(live(TECHA_KEY)).toBe(true);
    expect(store.activeKey).toBe(TECHA_KEY);
    expect(wire.notified).not.toContain(RECONNECTING);
  });

  it("logs in to a lobby server beside a room, and keeps the room", async () => {
    await mount();
    await act(async () => {
      await store.connectDirect(8200, "AF");
    });
    // Nothing else had focus, so the room took it.
    expect(store.activeKey).toBe(ROOM_KEY);

    await act(async () => {
      await store.connect(BAR, "AF_");
    });

    expect(live(ROOM_KEY)).toBe(true);
    expect(store.connections[ROOM_KEY].direct).toBe(true);
    expect(live(BAR_KEY)).toBe(true);
    expect(store.activeKey).toBe(BAR_KEY);
  });

  it("refuses a second room and names the first, leaving the lobby alone", async () => {
    await roomBesideLobby();

    await expect(
      store.connectDirect(8200, "AF", "192.168.1.45"),
    ).rejects.toThrow(/127\.0\.0\.1:8200/);

    expect(wire.channels.has("AF@192.168.1.45:8200")).toBe(false);
    expect(live(ROOM_KEY)).toBe(true);
    expect(live(BAR_KEY)).toBe(true);
  });

  it("refuses a room racing another room still opening", async () => {
    await mount();
    await act(async () => {
      await store.connect(TECHA, "AF_");
    });
    const release = hold(ROOM_KEY);
    const first = store.connectDirect(8200, "AF");

    await expect(
      store.connectDirect(8200, "AF", "192.168.1.45"),
    ).rejects.toThrow(/already opening/);

    await act(async () => {
      release();
      await first;
    });
    expect(live(ROOM_KEY)).toBe(true);
    expect(live(TECHA_KEY)).toBe(true);
  });

  // A room is not a lobby server, so opening one is no reason to give up on
  // a lobby login that dropped a moment ago.
  it("keeps reconnecting a dropped lobby login while a room opens", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    await twoLogins();
    await fire(BAR_KEY, { kind: "disconnected", reason: "connection reset" });
    expect(wire.notified).toContain(RECONNECTING);

    await act(async () => {
      await store.connectDirect(8200, "AF");
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });

    expect(wire.opened.filter((k) => k === BAR_KEY)).toHaveLength(2);
    expect(live(BAR_KEY)).toBe(true);
    expect(live(ROOM_KEY)).toBe(true);
  });

  // The room was only told apart by a saved key, and a lobby login used to
  // wipe it. A reload then re-adopted the room as a lobby server.
  it("still knows which connection is the room after a lobby login and a reload", async () => {
    await mount();
    await act(async () => {
      await store.connectDirect(8200, "AF");
    });
    await act(async () => {
      await store.connect(TECHA, "AF_");
    });
    cleanup();

    wire.activeKeys = [ROOM_KEY, TECHA_KEY];
    await mount();

    expect(live(ROOM_KEY)).toBe(true);
    expect(live(TECHA_KEY)).toBe(true);
    expect(store.connections[ROOM_KEY].direct).toBe(true);
    expect(store.connections[TECHA_KEY].direct).toBe(false);
    // The last lobby login keeps focus across the reload, not the room.
    expect(store.activeKey).toBe(TECHA_KEY);
  });

  it("forgets the room once it is closed, so a reload adopts nothing as one", async () => {
    await mount();
    await act(async () => {
      await store.connectDirect(8200, "AF");
    });
    await act(async () => {
      await store.disconnect(ROOM_KEY);
    });
    cleanup();

    // A lobby server on this machine, under the key the room had.
    wire.activeKeys = [ROOM_KEY];
    await mount();

    expect(live(ROOM_KEY)).toBe(true);
    expect(store.connections[ROOM_KEY].direct).toBe(false);
  });

  it("leaves focus on the connection that took it when a room never greets us", async () => {
    let greet = () => {};
    wire.readyGate = new Promise<void>((resolve) => {
      greet = resolve;
    });
    wire.readyFails = true;
    let reattach = () => {};
    wire.activeKeysGate = new Promise<void>((resolve) => {
      reattach = resolve;
    });
    wire.activeKeys = [BAR_KEY];
    await mount();

    const room = store.connectDirect(8200, "AF");
    // The reload's reattach lands while the room is still waiting to be
    // greeted, and takes focus.
    await act(async () => {
      reattach();
    });
    await act(async () => {});
    expect(store.activeKey).toBe(BAR_KEY);

    await act(async () => {
      greet();
      await expect(room).rejects.toThrow(/never greeted/);
    });

    expect(store.activeKey).toBe(BAR_KEY);
    expect(live(BAR_KEY)).toBe(true);
    expect(store.connections[ROOM_KEY]).toBeUndefined();
    expect(wire.closed).toEqual([ROOM_KEY]);
  });

  // Issue #2733: a joiner whose host closed the room kept reading as
  // connected, because the drop was treated as a flaky link worth retrying at
  // the same address. A fresh room the host started next would answer that
  // retry, silently joining nobody's battle rather than saying the old room
  // ended.
  it("says why and does not reconnect once a room has named its own closing", async () => {
    await roomBesideLobby();

    await fire(ROOM_KEY, {
      kind: "disconnected",
      reason: "AF closed this room",
    });

    expect(live(ROOM_KEY)).toBe(false);
    expect(wire.notified).toContain("Disconnected from the room");
    expect(wire.notified).not.toContain(RECONNECTING);
    expect(live(BAR_KEY)).toBe(true);
    expect(store.activeKey).toBe(BAR_KEY);
  });

  // Issue #2737: a kicked joiner is dropped the same way a closed room is,
  // a `SERVERMSG` naming why then a clean close, so the fix above already
  // covers it once conn.rs carries the reason forward. This is that claim,
  // with the exact words the room's kick sends (`crates/coilbox-lobby-
  // protocol/src/server/room.rs`) rather than a stand-in string.
  it("says who kicked us and does not reconnect into whoever now holds the room", async () => {
    await roomBesideLobby();

    await fire(ROOM_KEY, {
      kind: "disconnected",
      reason: "alice removed you from this room",
    });

    expect(live(ROOM_KEY)).toBe(false);
    expect(wire.notified).toContain("Disconnected from the room");
    expect(wire.notified).not.toContain(RECONNECTING);
    expect(live(BAR_KEY)).toBe(true);
  });

  // The same drop with no reason is what a network blip looks like rather
  // than the room ending, and the same room is still there to reclaim a seat
  // in, so this is the one case that still gets the usual reconnect loop.
  it("still reconnects a room drop that named no reason", async () => {
    await roomBesideLobby();

    await fire(ROOM_KEY, { kind: "disconnected", reason: null });

    expect(live(ROOM_KEY)).toBe(false);
    expect(wire.notified).toContain(RECONNECTING);
    expect(live(BAR_KEY)).toBe(true);
  });
});

describe("status on every connection", () => {
  it("sends away and in-game on every connection, including one opened later", async () => {
    await twoLogins();

    await act(async () => {
      store.setManualAway(true);
      store.setIngame(true);
    });
    expect(store.connections[BAR_KEY].status).toEqual({
      ingame: true,
      away: true,
    });
    expect(store.connections[TECHA_KEY].status).toEqual({
      ingame: true,
      away: true,
    });
    expect(wire.statuses).toContain(`${BAR_KEY} true true`);
    expect(wire.statuses).toContain(`${TECHA_KEY} true true`);

    await act(async () => {
      await store.connect(RECOIL, "AF_");
    });
    await ready(RECOIL_KEY);
    expect(store.connections[RECOIL_KEY].status).toEqual({
      ingame: true,
      away: true,
    });
    expect(wire.statuses).toContain(`${RECOIL_KEY} true true`);

    await act(async () => {
      store.setIngame(false);
    });
    for (const key of [BAR_KEY, TECHA_KEY, RECOIL_KEY]) {
      expect(store.connections[key].status.ingame).toBe(false);
    }
  });

  it("keeps reporting in-game on a connection that reconnects mid-game", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    await twoLogins();
    await act(async () => {
      store.setIngame(true);
    });
    await fire(BAR_KEY, { kind: "disconnected", reason: "connection reset" });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });
    expect(live(BAR_KEY)).toBe(true);
    await ready(BAR_KEY);

    expect(store.connections[BAR_KEY].status.ingame).toBe(true);
    expect(store.connections[TECHA_KEY].status.ingame).toBe(true);
  });

  it("clears manual away once the last connection is logged out", async () => {
    await twoLogins();
    await act(async () => {
      store.setManualAway(true);
    });
    await act(async () => {
      await store.disconnect(BAR_KEY);
      await store.disconnect(TECHA_KEY);
    });
    await act(async () => {
      await store.connect(RECOIL, "AF_");
    });
    await ready(RECOIL_KEY);
    expect(store.manualAway).toBe(false);
    expect(store.connections[RECOIL_KEY].status.away).toBe(false);
  });
});

// Issue #2775: uberserver sends a staff `BROADCAST` to every client as a bare
// `BROADCAST <message>` line. It used to fall to `ServerMessage::Unknown` and
// never reach the player. It must surface as its own toast, titled apart from
// a routine `SERVERMSG`, so a player can tell an admin sent it.
describe("server broadcast", () => {
  it("shows a BROADCAST as a titled toast, from a connection that is not focused", async () => {
    await twoLogins();

    await fire(BAR_KEY, {
      kind: "delta",
      delta: { kind: "broadcast", text: "Server restarting in 5 minutes" },
    });

    expect(wire.notified).toContain("Staff announcement");
    expect(store.activeKey).toBe(TECHA_KEY);
  });
});

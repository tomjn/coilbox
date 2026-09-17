// @vitest-environment happy-dom

/**
 * `ConnectionState.adminLevel` (issue #2776): once a connection's account has
 * the `access` status bit, `ConnectionSession` asks uberserver
 * `GETUSERINFO <own username>` through the shared admin command path and
 * reads the level off the `access=` line the answer carries.
 *
 * Drives the real provider, the same way `connectionState.dom.test.tsx` does.
 * The mock setup is copied from there, with `mpAdminCommand` added.
 */

import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  installSettingsStorage,
  memorySettingsStorage,
} from "../lib/storedSetting";
import type { LobbyServer } from "../lobby-servers/config";
import type { AdminOutcome, LobbyEvent, LobbyState } from "./bindings";

interface FakeChannel {
  onmessage?: (ev: LobbyEvent) => void;
}

const wire = vi.hoisted(() => ({
  channels: new Map<string, FakeChannel>(),
  closed: [] as string[],
  /** Arguments `mp_admin_command` was called with, in call order. */
  adminCommandCalls: [] as {
    serverKey: string;
    command: string;
    args: string[];
    shape: string;
  }[],
}));

const adminOutcomes = vi.hoisted(
  () => new Map<string, AdminOutcome | (() => Promise<AdminOutcome>)>(),
);

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

/** A snapshot naming `username`, with the moderator `access` status bit set
 * unless told otherwise. */
function stateWithAccess(username: string, access = true): LobbyState {
  return {
    myUsername: username,
    compflags: [],
    users: {
      [username]: {
        name: username,
        country: "",
        userId: "1",
        agent: "",
        status: { ingame: false, away: false, rank: 0, access, bot: false },
        rating: {},
      },
    },
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
  } as unknown as LobbyState;
}

/** Snapshot per server key, read by the mocked `mpSnapshot`. Set by each test
 * before connecting. */
let snapshotFor: Record<string, LobbyState> = {};

vi.mock("./bindings", () => ({
  mpConnect: async (args: { serverKey: string; onEvent: FakeChannel }) => {
    wire.channels.set(args.serverKey, args.onEvent);
    return { connected: true };
  },
  mpConnectTachyon: async () => ({ connected: true }),
  mpConnectZerok: async () => ({ connected: true }),
  mpSnapshot: async ({ serverKey }: { serverKey: string }) => ({
    state: snapshotFor[serverKey],
  }),
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
  mpAdminCommand: async (args: {
    serverKey: string;
    command: string;
    args: string[];
    shape: string;
  }) => {
    wire.adminCommandCalls.push(args);
    const outcome = adminOutcomes.get(args.serverKey);
    if (!outcome) {
      throw new Error(`no admin outcome set for ${args.serverKey}`);
    }
    return typeof outcome === "function" ? outcome() : outcome;
  },
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

const SECOND: LobbyServer = {
  id: "second",
  name: "Second uberserver",
  host: "second.example",
  port: 8200,
  tls: false,
  allowSelfSigned: false,
};
const SECOND_KEY = "BB@second.example:8200";

function adminReply(access: string) {
  return {
    outcome: "answered" as const,
    reply: {
      shape: "userInfo" as const,
      info: {
        kind: "account" as const,
        username: "AF_",
        online: true,
        userId: "1",
        sessionId: "1",
        agent: null,
        registered: "Jan 01, 2020",
        lastLogin: "Sep 16, 2026",
        access,
        bot: false,
        ingameHours: "0",
        email: null,
        lastIp: null,
        lastSysId: null,
        lastMacId: null,
      },
    },
  };
}

let store: ReturnType<typeof useMultiplayer>;
let lobby: ReturnType<typeof useConnection>;
let second: ReturnType<typeof useConnection>;

function Probe() {
  store = useMultiplayer();
  lobby = useConnection(LOBBY_KEY);
  second = useConnection(SECOND_KEY);
  return null;
}

async function fire(serverKey: string, ev: LobbyEvent) {
  const channel = wire.channels.get(serverKey);
  if (!channel?.onmessage) throw new Error(`no channel for ${serverKey}`);
  await act(async () => {
    channel.onmessage?.(ev);
  });
}

async function mount() {
  render(
    <MultiplayerProvider>
      <Probe />
    </MultiplayerProvider>,
  );
  await act(async () => {});
}

async function connect(server: LobbyServer, username: string) {
  await act(async () => {
    await store.connect(server, username);
  });
}

beforeEach(() => {
  // `useSetting` is mocked as plain `useState` here (see above), so nothing
  // ever writes through to this. It only has to exist: `seedJoinedChannels`
  // reads through it before seeding a first connect's auto-join channels
  // (issue #2920).
  installSettingsStorage(memorySettingsStorage());
  wire.channels.clear();
  wire.closed.length = 0;
  wire.adminCommandCalls.length = 0;
  adminOutcomes.clear();
  snapshotFor = {};
});

afterEach(() => {
  cleanup();
});

describe("adminLevel: learning admin vs. moderator (issue #2776)", () => {
  it("settles admin from a GETUSERINFO reply naming access=admin", async () => {
    snapshotFor[LOBBY_KEY] = stateWithAccess("AF_");
    adminOutcomes.set(LOBBY_KEY, adminReply("admin"));

    await mount();
    await connect(LOBBY, "AF_");
    expect(lobby?.adminLevel).toBe("mod");

    await fire(LOBBY_KEY, { kind: "phase", phase: "ready", agreement: null });

    expect(wire.adminCommandCalls).toEqual([
      {
        serverKey: LOBBY_KEY,
        command: "GETUSERINFO",
        args: ["AF_"],
        shape: "userInfo",
      },
    ]);
    expect(lobby?.adminLevel).toBe("admin");
  });

  it("stays mod for a GETUSERINFO reply naming access=mod", async () => {
    snapshotFor[LOBBY_KEY] = stateWithAccess("AF_");
    adminOutcomes.set(LOBBY_KEY, adminReply("mod"));

    await mount();
    await connect(LOBBY, "AF_");
    await fire(LOBBY_KEY, { kind: "phase", phase: "ready", agreement: null });

    expect(wire.adminCommandCalls).toHaveLength(1);
    expect(lobby?.adminLevel).toBe("mod");
  });

  it("stays mod when GETUSERINFO never answers", async () => {
    snapshotFor[LOBBY_KEY] = stateWithAccess("AF_");
    adminOutcomes.set(LOBBY_KEY, { outcome: "unanswered" });

    await mount();
    await connect(LOBBY, "AF_");
    await fire(LOBBY_KEY, { kind: "phase", phase: "ready", agreement: null });

    expect(wire.adminCommandCalls).toHaveLength(1);
    expect(lobby?.adminLevel).toBe("mod");
  });

  it("does not ask at all while the access bit is unset", async () => {
    snapshotFor[LOBBY_KEY] = stateWithAccess("AF_", false);

    await mount();
    await connect(LOBBY, "AF_");
    await fire(LOBBY_KEY, { kind: "phase", phase: "ready", agreement: null });

    expect(wire.adminCommandCalls).toEqual([]);
    expect(lobby?.adminLevel).toBe("mod");
  });

  it("keeps two connections' levels independent", async () => {
    snapshotFor[LOBBY_KEY] = stateWithAccess("AF_");
    snapshotFor[SECOND_KEY] = stateWithAccess("BB");
    adminOutcomes.set(LOBBY_KEY, adminReply("admin"));
    adminOutcomes.set(SECOND_KEY, { outcome: "unanswered" });

    await mount();
    await connect(LOBBY, "AF_");
    await connect(SECOND, "BB");
    await fire(LOBBY_KEY, { kind: "phase", phase: "ready", agreement: null });
    await fire(SECOND_KEY, { kind: "phase", phase: "ready", agreement: null });

    expect(lobby?.adminLevel).toBe("admin");
    expect(second?.adminLevel).toBe("mod");
  });

  it("clears back to mod on disconnect and reconnect", async () => {
    snapshotFor[LOBBY_KEY] = stateWithAccess("AF_");
    adminOutcomes.set(LOBBY_KEY, adminReply("admin"));

    await mount();
    await connect(LOBBY, "AF_");
    await fire(LOBBY_KEY, { kind: "phase", phase: "ready", agreement: null });
    expect(lobby?.adminLevel).toBe("admin");

    await act(async () => {
      await store.disconnect(LOBBY_KEY);
    });
    expect(lobby).toBeNull();

    // Reconnecting starts a fresh entry, and this time the account only
    // answers as a moderator, so the earlier "admin" must not linger.
    adminOutcomes.set(LOBBY_KEY, adminReply("mod"));
    await connect(LOBBY, "AF_");
    expect(lobby?.adminLevel).toBe("mod");
    await fire(LOBBY_KEY, { kind: "phase", phase: "ready", agreement: null });
    expect(lobby?.adminLevel).toBe("mod");
  });
});

// @vitest-environment happy-dom

/**
 * The auto-rejoin after a dropped connection sends the key the join used
 * (issue #1584). Before, it sent only a script password, and a passworded
 * battle refused it.
 *
 * Driven through the real provider, as `oneLobbyConnection.dom.test.tsx` is,
 * because the key is read in the drop handler and sent from the session
 * component, and neither is reachable on its own.
 */

import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  installSettingsStorage,
  memorySettingsStorage,
} from "../lib/storedSetting";
import { BUILTIN_SERVERS } from "../lobby-servers/config";
import type { Battle, LobbyEvent, LobbyState } from "./bindings";

interface FakeChannel {
  onmessage?: (ev: LobbyEvent) => void;
}

interface JoinCall {
  serverKey: string;
  id: number;
  key?: string | null;
  scriptPassword?: string | null;
}

const wire = vi.hoisted(() => ({
  channels: new Map<string, FakeChannel>(),
  notified: [] as { title: string; body?: string }[],
  /** Every `mpJoinBattle` call, in order. */
  joinCalls: [] as unknown[],
  /** What `mpSnapshot` answers, so the player is in a battle after a connect. */
  state: null as unknown,
  /** Makes every connect attempt fail, so a reconnect loop runs out. */
  connectFails: false,
}));

vi.mock("@tauri-apps/api/core", () => ({
  Channel: class {
    onmessage?: (ev: LobbyEvent) => void;
  },
}));

vi.mock("@picoframe/frame", async () => {
  const react = await import("react");
  return {
    useSetting: <T,>(_key: string, initial: T) => {
      const [value, setValue] = react.useState<T>(initial);
      return [value, setValue] as const;
    },
  };
});

vi.mock("../notify/notify", () => ({
  notify: async (n: { title: string; body?: string }) => {
    wire.notified.push(n);
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

const BATTLE_ID = 7;

const lobbyState = (inBattle: boolean): LobbyState =>
  ({
    myUsername: "AF",
    compflags: [],
    users: {},
    channels: {},
    dms: {},
    battles: inBattle
      ? {
          [String(BATTLE_ID)]: {
            id: BATTLE_ID,
            members: { AF: { scriptPassword: "echoed" } },
          },
        }
      : {},
    currentBattle: inBattle ? BATTLE_ID : null,
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
    if (wire.connectFails) throw new Error("connection refused");
    wire.channels.set(args.serverKey, args.onEvent);
    return { connected: true };
  };
  return {
    mpConnect: open,
    mpConnectTachyon: open,
    mpConnectZerok: open,
    mpSnapshot: async () => ({ state: wire.state }),
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
    mpJoinBattle: async (args: unknown) => {
      wire.joinCalls.push(args);
      return {};
    },
    mpJoinChannel: async () => ({}),
    mpRegister: async () => ({}),
    mpRegisterZerok: async () => ({}),
    mpSetStatus: async () => ({}),
    mpTachyonSignedIn: async () => ({ signedIn: true }),
    mpTachyonSignIn: async () => ({}),
  };
});

vi.mock("../lobby-servers/bindings", () => ({
  lsGetCredential: async () => ({ secret: "hunter2" }),
}));

import { joinKeyFor } from "./battleKeys";
import { joinBattle } from "./battles/joinBattle";
import { MultiplayerProvider, useMultiplayer } from "./store";

const BAR = (() => {
  const server = BUILTIN_SERVERS.find((s) => s.id === "bar-ssl");
  if (!server) throw new Error("no built-in bar-ssl server");
  return server;
})();
const BAR_KEY = "AF_@server4.beyondallreason.info:8200";
const SECRET_KEY = "sesame-open-up";

let store: ReturnType<typeof useMultiplayer>;

function Probe() {
  store = useMultiplayer();
  return null;
}

async function fire(serverKey: string, ev: LobbyEvent) {
  const channel = wire.channels.get(serverKey);
  if (!channel?.onmessage) throw new Error(`no channel for ${serverKey}`);
  await act(async () => {
    channel.onmessage?.(ev);
  });
}

const ready = () =>
  fire(BAR_KEY, { kind: "phase", phase: "ready", agreement: null });

/** Logged in to BAR and sitting in battle 7, joined with `key` if given. */
async function inBattleJoinedWith(key: string | undefined) {
  wire.state = lobbyState(true);
  render(
    <MultiplayerProvider>
      <Probe />
    </MultiplayerProvider>,
  );
  await act(async () => {});
  await act(async () => {
    await store.connect(BAR, "AF_");
  });
  await ready();
  await act(async () => {
    await joinBattle({
      serverKey: BAR_KEY,
      battle: { id: BATTLE_ID, engine: "spring" } as unknown as Battle,
      key,
      leaveOther: async () => {},
      awaitLanding: () => {},
      giveUp: () => {},
    });
  });
  wire.joinCalls.length = 0;
}

/** Drop the connection and let the reconnect loop log back in. */
async function dropAndReconnect() {
  await fire(BAR_KEY, { kind: "disconnected", reason: "connection reset" });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1500);
  });
  await ready();
}

const lastJoin = () => wire.joinCalls.at(-1) as JoinCall | undefined;

let logged: string[];

beforeEach(() => {
  installSettingsStorage(memorySettingsStorage());
  wire.channels.clear();
  wire.notified.length = 0;
  wire.joinCalls.length = 0;
  wire.connectFails = false;
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  logged = [];
  for (const level of ["log", "info", "warn", "error", "debug"] as const) {
    vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
      logged.push(args.map(String).join(" "));
    });
  }
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("auto-rejoin after a dropped connection", () => {
  it("sends the key the join used, with the script password", async () => {
    await inBattleJoinedWith(SECRET_KEY);

    await dropAndReconnect();

    expect(wire.joinCalls).toHaveLength(1);
    expect(lastJoin()).toMatchObject({
      serverKey: BAR_KEY,
      id: BATTLE_ID,
      key: SECRET_KEY,
      scriptPassword: "echoed",
    });
  });

  it("sends the key again on a second drop", async () => {
    await inBattleJoinedWith(SECRET_KEY);
    await dropAndReconnect();
    wire.joinCalls.length = 0;

    await dropAndReconnect();

    expect(lastJoin()?.key).toBe(SECRET_KEY);
  });

  it("sends no key for a battle that had none", async () => {
    await inBattleJoinedWith(undefined);

    await dropAndReconnect();

    expect(wire.joinCalls).toHaveLength(1);
    expect(lastJoin()?.id).toBe(BATTLE_ID);
    expect(lastJoin()?.key).toBeNull();
  });

  it("does not carry an earlier battle's key into a join without one", async () => {
    await inBattleJoinedWith(SECRET_KEY);
    await act(async () => {
      await joinBattle({
        serverKey: BAR_KEY,
        battle: { id: BATTLE_ID, engine: "spring" } as unknown as Battle,
        key: undefined,
        leaveOther: async () => {},
        awaitLanding: () => {},
        giveUp: () => {},
      });
    });
    wire.joinCalls.length = 0;

    await dropAndReconnect();

    expect(lastJoin()?.key).toBeNull();
  });

  it("keeps the key out of notifications and the console", async () => {
    await inBattleJoinedWith(SECRET_KEY);

    await dropAndReconnect();

    expect(lastJoin()?.key).toBe(SECRET_KEY);
    expect(JSON.stringify(wire.notified)).not.toContain(SECRET_KEY);
    expect(logged.join("\n")).not.toContain(SECRET_KEY);
  });

  it("keeps the key of the battle it is in when a join of another battle is sent", async () => {
    await inBattleJoinedWith(SECRET_KEY);
    await act(async () => {
      await joinBattle({
        serverKey: BAR_KEY,
        battle: { id: 9, engine: "spring" } as unknown as Battle,
        key: "wrong-key",
        leaveOther: async () => {},
        awaitLanding: () => {},
        giveUp: () => {},
      });
    });
    wire.joinCalls.length = 0;

    await dropAndReconnect();

    expect(lastJoin()).toMatchObject({ id: BATTLE_ID, key: SECRET_KEY });
  });

  it("forgets the key when the reconnect gives up", async () => {
    await inBattleJoinedWith(SECRET_KEY);
    wire.connectFails = true;

    await fire(BAR_KEY, { kind: "disconnected", reason: "connection reset" });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
    });

    expect(joinKeyFor(BAR_KEY, BATTLE_ID)).toBeNull();
  });

  it("keeps the key while a reconnect is still pending", async () => {
    await inBattleJoinedWith(SECRET_KEY);

    await fire(BAR_KEY, { kind: "disconnected", reason: "connection reset" });

    expect(joinKeyFor(BAR_KEY, BATTLE_ID)).toBe(SECRET_KEY);
  });

  it("forgets the key when the connection is closed", async () => {
    await inBattleJoinedWith(SECRET_KEY);
    expect(joinKeyFor(BAR_KEY, BATTLE_ID)).toBe(SECRET_KEY);

    await act(async () => {
      await store.disconnect(BAR_KEY);
    });

    expect(joinKeyFor(BAR_KEY, BATTLE_ID)).toBeNull();
  });
});

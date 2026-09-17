// @vitest-environment happy-dom

/**
 * Battles with two lobby connections open (issue #2844): the nav item finds
 * the connection the player is in a battle on, and the battle room reads that
 * connection rather than the focused one.
 *
 * Two live connections can only come from a reload while the connect-blocking
 * rule stands (issue #2848), so the mock setup is `reattachAll.dom.test.tsx`'s.
 */

import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Battle, LobbyEvent, LobbyState } from "./bindings";

interface FakeChannel {
  onmessage?: (ev: LobbyEvent) => void;
}

const wire = vi.hoisted(() => ({
  channels: new Map<string, FakeChannel>(),
  activeKeys: [] as string[],
  states: new Map<string, unknown>(),
  left: [] as string[],
  hostConfigFor: [] as string[],
  /** Keys whose battle Rust says goes through the relay. */
  relayedOn: new Set<string>(),
  launches: [] as { relayed: boolean }[],
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

vi.mock("./bindings", () => ({
  mpConnect: async () => ({ connected: true }),
  mpSnapshot: async ({ serverKey }: { serverKey: string }) => ({
    state: wire.states.get(serverKey),
  }),
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
  mpSetStatus: async () => ({}),
  mpLeaveBattle: async ({ serverKey }: { serverKey: string }) => {
    wire.left.push(serverKey);
    return { sent: true };
  },
  mpBuildHostConfig: async ({ serverKey }: { serverKey: string }) => {
    wire.hostConfigFor.push(serverKey);
    return {
      config: { gameType: "g", mapName: "m" },
      relayed: wire.relayedOn.has(serverKey),
    };
  },
  mpTachyonSignedIn: async () => ({ signedIn: true }),
}));

// The battle room reads local content and the preferred engine. None of it is
// the subject here, so it is held still: an engine, and nothing installed.
vi.mock("@/content/config", () => ({
  invalidateMapPreview: () => {},
  useUnitsyncScan: () => ({
    data: { games: [], maps: [] },
    loading: false,
    run: async () => {},
  }),
  useUnitsyncGameInfo: () => ({ info: null }),
  useUnitsyncMapInfo: () => ({ info: null, status: "idle", loadedMap: null }),
}));
vi.mock("@/play/config", () => ({
  usePreferredTarget: () => ({
    target: {
      enginePath: "/engine",
      executable: "/engine/spring",
      dataDir: "/data",
    },
    loading: false,
  }),
  useSkirmishAis: () => ({ ais: [], loaded: true }),
}));
vi.mock("@/play/PlayProvider", () => ({
  usePlay: () => ({
    running: false,
    launch: async (_kind: string, args: { relayed: boolean }) => {
      wire.launches.push({ relayed: args.relayed });
      return { exitCode: 0, signal: null };
    },
  }),
}));
vi.mock("@/content/bindings", () => ({
  contentListReplays: async () => ({ replays: [] }),
}));
vi.mock("@/content/replayUserState", () => ({
  useReplayUserState: () => ({ setProvenance: () => {} }),
}));
vi.mock("@/play/tagReplayProvenance", () => ({ tagFreshReplay: () => {} }));

vi.mock("../lobby-servers/bindings", () => ({
  lsGetCredential: async () => ({ secret: "hunter2" }),
}));

import { MemoryRouter } from "react-router";
import { recordHostingRoute } from "../direct/hostingRoute";
import { useBattleLaunch } from "./battle/useBattleLaunch";
import { useBattleRoom } from "./battle/useBattleRoom";
import { useBattleRoomKey } from "./battle/useBattleRoomKey";
import { BattleNavBadge } from "./nav/navBadges";
import { useBattleRoomLabel, useMpInBattle } from "./navPredicates";
import { MultiplayerProvider, useMultiplayer } from "./store";

const KEY_A = "AF@server4.beyondallreason.info:8201";
const KEY_B = "Zeta@lobby.recoilengine.org:8200";

function battle(id: number, title: string, host = "Host"): Battle {
  return {
    id,
    tachyonId: null,
    host,
    ip: "",
    port: "",
    natType: "0",
    relayed: false,
    map: "Comet Catcher Remake 1.8",
    maphash: "",
    modname: "Beyond All Reason test-1234",
    engine: "",
    version: "",
    maxPlayers: 8,
    playerCount: null,
    passworded: false,
    locked: false,
    spectatorCount: 0,
    title,
    channel: null,
    members: {},
    bots: {},
    scriptTags: {},
    startRects: {},
    bosses: [],
    bossesEnabled: false,
    inProgress: false,
    mode: null,
  };
}

function lobbyState(
  me: string,
  battles: Battle[],
  currentBattle: number | null,
): LobbyState {
  return {
    myUsername: me,
    compflags: [],
    users: {
      Host: { status: { ingame: true, bot: true } },
    },
    channels: {},
    dms: {},
    battles: Object.fromEntries(battles.map((b) => [String(b.id), b])),
    currentBattle,
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

let store: ReturnType<typeof useMultiplayer>;
let inBattle: boolean;
let label: string;

function Probe() {
  store = useMultiplayer();
  inBattle = useMpInBattle();
  label = useBattleRoomLabel();
  return null;
}

async function mount() {
  const view = render(
    <MultiplayerProvider>
      <Probe />
      <BattleNavBadge />
    </MultiplayerProvider>,
  );
  await act(async () => {});
  return view;
}

beforeEach(() => {
  wire.channels.clear();
  wire.states.clear();
  wire.activeKeys = [KEY_A, KEY_B];
  wire.states.set(KEY_A, lobbyState("AF", [battle(1, "Battle on A")], null));
  wire.states.set(KEY_B, lobbyState("Zeta", [battle(7, "Battle on B")], 7));
});

afterEach(cleanup);

describe("the battle room nav item with two connections", () => {
  it("shows while the player is in a battle on the unfocused connection", async () => {
    await mount();
    expect(store.activeKey).toBe(KEY_A);
    expect(inBattle).toBe(true);
  });

  it("is labelled with that battle's title", async () => {
    await mount();
    expect(label).toBe("Battle on B");
  });

  // The host is in-game on B, so the dot says the game has started there.
  it("badges that battle's state", async () => {
    const view = await mount();
    expect(view.getByRole("img", { name: "Game in progress" })).toBeTruthy();
  });

  it("hides when neither connection is in a battle", async () => {
    wire.states.set(
      KEY_B,
      lobbyState("Zeta", [battle(7, "Battle on B")], null),
    );
    await mount();
    expect(inBattle).toBe(false);
    expect(label).toBe("Battle Room");
  });
});

let room: ReturnType<typeof useBattleRoom>;
let launch: ReturnType<typeof useBattleLaunch>;

function RoomProbe() {
  room = useBattleRoom(useBattleRoomKey());
  launch = useBattleLaunch(room.serverKey, room.target, room.selfHost);
  return null;
}

async function openRoom(url: string) {
  render(
    <MemoryRouter initialEntries={[url]}>
      <MultiplayerProvider>
        <Probe />
        <RoomProbe />
      </MultiplayerProvider>
    </MemoryRouter>,
  );
  await act(async () => {});
}

describe("the battle room with two connections", () => {
  beforeEach(() => {
    wire.left.length = 0;
    wire.hostConfigFor.length = 0;
    wire.launches.length = 0;
    wire.relayedOn.clear();
  });

  afterEach(() => {
    recordHostingRoute(KEY_A, null);
    recordHostingRoute(KEY_B, null);
  });

  it("draws the battle on the server the link names", async () => {
    await openRoom(`/battle?server=${encodeURIComponent(KEY_B)}`);
    expect(store.activeKey).toBe(KEY_A);
    expect(room.serverKey).toBe(KEY_B);
    expect(room.battle?.title).toBe("Battle on B");
    expect(room.me).toBe("Zeta");
  });

  // An old link, or the nav item, names no server.
  it("draws the battle the player is in when the link names no server", async () => {
    await openRoom("/battle");
    expect(room.serverKey).toBe(KEY_B);
    expect(room.battle?.title).toBe("Battle on B");
  });

  it("shows no battle for a server the player is not in a battle on", async () => {
    await openRoom(`/battle?server=${encodeURIComponent(KEY_A)}`);
    expect(room.serverKey).toBe(KEY_A);
    expect(room.battle).toBeUndefined();
  });

  it("leaves the battle on its own connection", async () => {
    await openRoom(`/battle?server=${encodeURIComponent(KEY_B)}`);
    await act(async () => {
      await room.leave();
    });
    expect(wire.left).toEqual([KEY_B]);
  });

  // The player is in the game whichever server the battle is on, so every
  // connection says so (issue #2848).
  it("flags the running game on every connection", async () => {
    await openRoom(`/battle?server=${encodeURIComponent(KEY_B)}`);
    await act(async () => {
      room.setIngame(true);
    });
    expect(store.connections[KEY_B].status.ingame).toBe(true);
    expect(store.connections[KEY_A].status.ingame).toBe(true);
    await act(async () => {
      room.setIngame(false);
    });
    expect(store.connections[KEY_B].status.ingame).toBe(false);
    expect(store.connections[KEY_A].status.ingame).toBe(false);
  });

  // The relay choice a launch uses belongs to the battle being launched. The
  // focused connection hosted through the relay; the battle on B did not.
  it("launches with the relay choice of the battle being launched", async () => {
    wire.states.set(
      KEY_B,
      lobbyState("Zeta", [battle(7, "Battle on B", "Zeta")], 7),
    );
    wire.relayedOn.add(KEY_A);
    recordHostingRoute(KEY_A, "relay");
    await openRoom(`/battle?server=${encodeURIComponent(KEY_B)}`);
    expect(room.selfHost).toBe(true);

    await act(async () => {
      await launch.launch();
    });

    expect(wire.hostConfigFor).toEqual([KEY_B]);
    expect(wire.launches).toEqual([{ relayed: false }]);
  });
});

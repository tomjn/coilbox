// @vitest-environment happy-dom

/**
 * Hosting and joining a room from the Battles page while logged in to a lobby
 * server (issue #2850).
 *
 * A room used to need coilbox's only connection, so the host and join forms
 * told a logged-in player to log out first. Now a room sits beside lobby
 * logins: the forms are open to a logged-in player, only another room blocks
 * them, entering a room leaves a lobby battle under the one-battle rule (issue
 * #2844), and stopping the room drops the room's own connection and nothing
 * else.
 *
 * The provider is real, with the reload-reattach setup from
 * `battlesPagePerServer.dom.test.tsx`. The room controls are stood in for by
 * components that hand their props back, so each case can read what the page
 * gave them and press their buttons directly.
 */

import { act, cleanup, render } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  installSettingsStorage,
  memorySettingsStorage,
} from "../../lib/storedSetting";
import type { Battle, LobbyEvent, LobbyState } from "../bindings";

interface FakeChannel {
  onmessage?: (ev: LobbyEvent) => void;
}

interface HostProps {
  blocked: string | null;
  leaves?: string | null;
  onStart: (args: unknown) => Promise<string | undefined>;
  onStop: () => void;
}

interface JoinProps {
  blocked: string | null;
  leaves?: string | null;
  onJoin: (args: unknown) => Promise<void>;
}

const wire = vi.hoisted(() => ({
  channels: new Map<string, FakeChannel>(),
  activeKeys: [] as string[],
  states: new Map<string, unknown>(),
  calls: [] as string[],
  host: null as HostProps | null,
  lan: null as JoinProps | null,
  hosted: null as unknown,
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
    useDrawer: () => ({ open: () => {}, close: () => {} }),
    Button: ({
      children,
      ...props
    }: { children?: ReactNode } & Record<string, unknown>) => (
      <button type="button" {...props}>
        {children}
      </button>
    ),
    Input: (props: Record<string, unknown>) => <input {...props} />,
  };
});

vi.mock("@/components/ui/popover", () => ({
  Popover: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  PopoverTrigger: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  PopoverContent: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
}));

vi.mock("../../notify/notify", () => ({ notify: async () => {} }));
vi.mock("../ringEffect", () => ({ triggerRing: () => {} }));
vi.mock("../ingameCue", () => ({ triggerIngameCue: () => {} }));
vi.mock("../chat/mentionCue", () => ({ triggerMentionCue: () => {} }));
vi.mock("../DebriefingDrawer", () => ({ DebriefingDrawer: () => null }));
vi.mock("../MatchFoundPanel", () => ({ MatchFoundPanel: () => null }));
vi.mock("../ServerMessageBoxDialog", () => ({
  ServerMessageBoxDialog: () => null,
}));
vi.mock("../VerificationCodeDialog", () => ({
  VerificationCodeDialog: () => null,
}));

vi.mock("../../content/config", () => ({
  useScanTargetSelection: () => ({ selected: null }),
}));
vi.mock("../../direct/hostedRoom", () => ({
  useHostedRoom: () => wire.hosted,
  setHostedRoom: () => {},
}));
vi.mock("../../direct/useLanRooms", () => ({
  useLanRooms: () => ({ rooms: [], error: null }),
}));
vi.mock("../../direct/HostRoomControl", () => ({
  HostRoomControl: (props: HostProps) => {
    wire.host = props;
    return null;
  },
}));
vi.mock("../../direct/LanRooms", () => ({
  LanRooms: (props: JoinProps) => {
    wire.lan = props;
    return null;
  },
}));
vi.mock("../../direct/LinkedRoomJoin", () => ({ LinkedRoomJoin: () => null }));
vi.mock("../../direct/VpnWarning", () => ({ VpnWarning: () => null }));
vi.mock("../../direct/bindings", () => ({
  directStartRoom: async ({ port }: { port: number }) => {
    wire.calls.push(`start room ${port}`);
    return { port };
  },
  directStopRoom: async () => {
    wire.calls.push("stop room");
    return {};
  },
  directRoomStatus: async () => ({
    room: { host: "AF", port: 8200, peers: 1, battle: { passworded: false } },
  }),
}));
vi.mock("../battles/BattleFilterPopover", () => ({
  BattleFilterPopover: () => null,
}));
vi.mock("../battles/BattleRowMapThumb", () => ({
  BattleRowMapThumb: () => null,
}));
vi.mock("../battles/HostBattleButton", () => ({
  HostBattleButton: () => null,
}));

vi.mock("../bindings", () => ({
  mpConnect: async ({
    serverKey,
    onEvent,
  }: {
    serverKey: string;
    onEvent: FakeChannel;
  }) => {
    wire.calls.push(`connect ${serverKey}`);
    wire.channels.set(serverKey, onEvent);
    return { connected: true };
  },
  mpSnapshot: async ({ serverKey }: { serverKey: string }) => ({
    state: wire.states.get(serverKey),
  }),
  mpDisconnect: async ({ serverKey }: { serverKey: string }) => {
    wire.calls.push(`disconnect ${serverKey}`);
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
  mpJoinChannel: async () => ({}),
  mpSetStatus: async () => ({}),
  mpTachyonSignedIn: async () => ({ signedIn: true }),
  mpLeaveBattle: async ({ serverKey }: { serverKey: string }) => {
    wire.calls.push(`leave ${serverKey}`);
    return { sent: true };
  },
  mpJoinBattle: async ({
    serverKey,
    id,
  }: {
    serverKey: string;
    id: number;
  }) => {
    wire.calls.push(`join ${serverKey} ${id}`);
    return {};
  },
  mpOpenBattle: async ({ serverKey }: { serverKey: string }) => {
    wire.calls.push(`open battle ${serverKey}`);
    return {};
  },
  mpCreateLobby: async () => ({}),
  mpZerokOpenBattle: async () => ({}),
}));

vi.mock("../../lobby-servers/bindings", () => ({
  lsGetCredential: async () => ({ secret: "hunter2" }),
}));

import { MultiplayerProvider, useMultiplayer } from "../store";
import BattlesRoute from "./BattlesPage";

const LOBBY = "AF_@server4.beyondallreason.info:8201";
const ROOM = "AF@127.0.0.1:8200";
const OTHER_ROOM = "AF@192.168.1.45:8200";

function battle(id: number, title: string): Battle {
  return {
    id,
    tachyonId: null,
    host: "Host",
    ip: "",
    port: "",
    natType: "0",
    relayed: false,
    map: "Map",
    maphash: "",
    modname: "Game",
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
    users: {},
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

/** Push a new snapshot for `serverKey` through its channel, and wait for it. */
async function refresh(serverKey: string, state: LobbyState) {
  wire.states.set(serverKey, state);
  await fire(serverKey, {
    kind: "delta",
    delta: { kind: "battleInfoChanged", id: 1 },
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 80));
  });
}

async function openPage() {
  render(
    <MemoryRouter initialEntries={["/battles"]}>
      <MultiplayerProvider>
        <Routes>
          <Route path="/battles" element={<BattlesRoute />} />
          <Route path="/battle" element={null} />
        </Routes>
        <Probe />
      </MultiplayerProvider>
    </MemoryRouter>,
  );
  await act(async () => {});
  for (const key of wire.activeKeys) {
    await fire(key, { kind: "phase", phase: "ready", agreement: null });
  }
}

function hostControl(): HostProps {
  if (!wire.host) throw new Error("the host control was not drawn");
  return wire.host;
}

function lanRooms(): JoinProps {
  if (!wire.lan) throw new Error("the room list was not drawn");
  return wire.lan;
}

const startArgs = {
  host: "AF",
  port: 8200,
  advertise: true,
  approveJoins: false,
  publicAddress: null,
  battle: { title: "Room" },
};

async function startRoom() {
  let key: string | undefined;
  await act(async () => {
    key = await hostControl().onStart(startArgs);
  });
  return key;
}

beforeEach(() => {
  // `seedJoinedChannels` reads through the storage singleton before seeding a
  // first connect's auto-join channels (issue #2920).
  installSettingsStorage(memorySettingsStorage());
  wire.channels.clear();
  wire.states.clear();
  wire.calls.length = 0;
  wire.host = null;
  wire.lan = null;
  wire.hosted = null;
  wire.activeKeys = [LOBBY];
  wire.states.set(LOBBY, lobbyState("AF_", [battle(1, "Lobby battle")], null));
  wire.states.set(ROOM, lobbyState("AF", [battle(2, "Room")], null));
  wire.states.set(
    OTHER_ROOM,
    lobbyState("AF", [battle(3, "Their room")], null),
  );
});

afterEach(cleanup);

describe("a room beside a lobby login", () => {
  it("offers hosting and joining to a player logged in to a lobby server", async () => {
    await openPage();
    expect(hostControl().blocked).toBeNull();
    expect(hostControl().leaves).toBeNull();
    expect(lanRooms().blocked).toBeNull();
    expect(lanRooms().leaves).toBeNull();
  });

  it("hosts a room and keeps the lobby login live and focused", async () => {
    await openPage();

    const key = await startRoom();

    expect(key).toBe(ROOM);
    expect(wire.calls).toEqual([
      "start room 8200",
      `connect ${ROOM}`,
      `open battle ${ROOM}`,
    ]);
    expect(store.connections[LOBBY].live).toBe(true);
    expect(store.connections[ROOM].live).toBe(true);
    expect(store.connections[ROOM].direct).toBe(true);
    expect(store.activeKey).toBe(LOBBY);
  });

  it("refuses a second room once one is open, and names it", async () => {
    await openPage();
    await startRoom();

    expect(hostControl().blocked).toContain("127.0.0.1:8200");
    expect(lanRooms().blocked).toContain("127.0.0.1:8200");
  });

  it("stops the room and drops only the room's own connection", async () => {
    await openPage();
    await startRoom();
    wire.hosted = { host: "AF", port: 8200, peers: 1, battle: null };
    // Any event re-renders the page, which reads the hosted room again.
    await fire(LOBBY, { kind: "phase", phase: "ready", agreement: null });
    wire.calls.length = 0;

    await act(async () => {
      hostControl().onStop();
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(wire.calls).toEqual([`disconnect ${ROOM}`, "stop room"]);
    expect(store.connections[ROOM]).toBeUndefined();
    expect(store.connections[LOBBY].live).toBe(true);
    expect(store.activeKey).toBe(LOBBY);
  });

  it("joins somebody else's room and keeps the lobby login", async () => {
    await openPage();

    await act(async () => {
      await lanRooms().onJoin({
        address: "192.168.1.45",
        port: 8200,
        name: "AF",
        password: "",
      });
    });

    expect(wire.calls).toEqual([
      `connect ${OTHER_ROOM}`,
      `join ${OTHER_ROOM} 3`,
    ]);
    expect(store.connections[OTHER_ROOM].direct).toBe(true);
    expect(store.connections[LOBBY].live).toBe(true);
    expect(hostControl().blocked).toContain("192.168.1.45:8200");
  });
});

describe("the one-battle rule for a room (issue #2844)", () => {
  it("says hosting a room leaves the lobby battle, and leaves it first", async () => {
    wire.states.set(LOBBY, lobbyState("AF_", [battle(1, "Lobby battle")], 1));
    await openPage();
    expect(hostControl().leaves).toMatch(
      /^You are in a battle on .*\. Hosting a battle here leaves it\.$/,
    );
    expect(lanRooms().leaves).toMatch(/Joining this one leaves it\.$/);

    await startRoom();

    expect(wire.calls).toEqual([
      `leave ${LOBBY}`,
      "start room 8200",
      `connect ${ROOM}`,
      `open battle ${ROOM}`,
    ]);
    expect(store.connections[LOBBY].live).toBe(true);
  });

  it("leaves the lobby battle before joining a room", async () => {
    wire.states.set(LOBBY, lobbyState("AF_", [battle(1, "Lobby battle")], 1));
    await openPage();

    await act(async () => {
      await lanRooms().onJoin({
        address: "192.168.1.45",
        port: 8200,
        name: "AF",
        password: "",
      });
    });

    expect(wire.calls).toEqual([
      `leave ${LOBBY}`,
      `connect ${OTHER_ROOM}`,
      `join ${OTHER_ROOM} 3`,
    ]);
  });

  // A drawer keeps the form it was opened with, so a battle joined after that
  // was never agreed to and is not left behind the player's back.
  it("refuses a form opened before the player joined a lobby battle", async () => {
    await openPage();
    const opened = hostControl();
    expect(opened.leaves).toBeNull();

    await refresh(LOBBY, lobbyState("AF_", [battle(1, "Lobby battle")], 1));

    await expect(opened.onStart(startArgs)).rejects.toThrow(
      /Close this form and open it again/,
    );
    expect(wire.calls).toEqual([]);
  });
});

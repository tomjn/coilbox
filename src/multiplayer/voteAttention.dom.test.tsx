// @vitest-environment happy-dom

/**
 * A vote that names the player gets the ring treatment, in place of the
 * ordinary notification (issue #351). Every other vote keeps the notification.
 *
 * The mock setup is `battlesPerServer.dom.test.tsx`'s.
 */

import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Battle, LobbyEvent, LobbyState, Vote } from "./bindings";

interface FakeChannel {
  onmessage?: (ev: LobbyEvent) => void;
}

const wire = vi.hoisted(() => ({
  channels: new Map<string, FakeChannel>(),
  states: new Map<string, unknown>(),
  notified: [] as { title: string; body: string }[],
  attention: [] as { event: string; announcement: string }[],
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

vi.mock("@/notify/notify", () => ({
  notify: async (n: { title: string; body: string }) => {
    wire.notified.push(n);
  },
}));
vi.mock("./ringEffect", () => ({
  triggerRing: () => {},
  triggerAttention: (event: string, announcement: string) => {
    wire.attention.push({ event, announcement });
  },
}));
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
  mpActiveKeys: async () => ({ keys: [SERVER] }),
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
  mpLeaveBattle: async () => ({ sent: true }),
  mpBuildHostConfig: async () => ({
    config: { gameType: "g", mapName: "m" },
    relayed: false,
  }),
  mpSetScriptTags: async () => ({ sent: true }),
  mpRemoveScriptTags: async () => ({ sent: true }),
  mpTachyonSignedIn: async () => ({ signedIn: true }),
}));

vi.mock("@/content/config", () => ({
  invalidateMapPreview: () => {},
  useUnitsyncScan: () => ({
    data: { games: [], maps: [] },
    loading: false,
    run: async () => {},
    runWithReason: async () => ({ data: null, error: null }),
  }),
  useUnitsyncGameInfo: () => ({ info: { options: [] } }),
  useUnitsyncMapInfo: () => ({ info: null, status: "idle", loadedMap: null }),
}));
vi.mock("@/play/config", () => ({
  usePreferredTarget: () => ({
    target: {
      enginePath: "/engine",
      executable: "/engine/spring",
      dataDir: "/data",
      engineVersion: "2026.03.01",
      syncVersion: "2026.03.01",
    },
    targets: [],
    refresh: async () => {},
    loading: false,
  }),
  useSkirmishAis: () => ({ ais: [], loaded: true }),
}));
vi.mock("@/play/PlayProvider", () => ({
  usePlay: () => ({
    running: false,
    launch: async () => ({ exitCode: 0, signal: null }),
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
import { useBattleRoom } from "./battle/useBattleRoom";
import { useBattleRoomKey } from "./battle/useBattleRoomKey";
import { MultiplayerProvider } from "./store";

const SERVER = "Alice@server4.beyondallreason.info:8201";

const battle: Battle = {
  id: 7,
  tachyonId: null,
  host: "Host",
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
  title: "Battle",
  channel: null,
  members: {},
  bots: {},
  scriptTags: {},
  startRects: {},
  bosses: [],
  bossesEnabled: false,
  inProgress: false,
  runningSince: null,
  mode: null,
};

function vote(subject: string, caller: string): Vote {
  return {
    subject,
    caller,
    yes: 1,
    no: 0,
    yesNeeded: 3,
    noNeeded: 3,
    allowAbstain: true,
    endsAt: 0,
  };
}

function lobbyState(currentVote: Vote | null): LobbyState {
  return {
    myUsername: "Alice",
    compflags: [],
    users: { Host: { status: { ingame: false, bot: true } } },
    channels: {},
    dms: {},
    battles: { "7": battle },
    currentBattle: 7,
    lastBattle: null,
    hostPort: null,
    channelDirectory: [],
    currentVote,
    serverIgnores: [],
    friends: [],
    friendRequests: [],
    party: null,
  } as unknown as LobbyState;
}

function Room() {
  useBattleRoom(useBattleRoomKey());
  return null;
}

async function openRoomWith(currentVote: Vote | null) {
  wire.states.set(SERVER, lobbyState(currentVote));
  render(
    <MemoryRouter
      initialEntries={[`/battle?server=${encodeURIComponent(SERVER)}`]}
    >
      <MultiplayerProvider>
        <Room />
      </MultiplayerProvider>
    </MemoryRouter>,
  );
  await act(async () => {});
}

/** Open a vote in a room that has none, as the lobby does when somebody calls one. */
async function callVote(subject: string, caller: string) {
  await openRoomWith(null);
  wire.states.set(SERVER, lobbyState(vote(subject, caller)));
  await act(async () => {
    wire.channels.get(SERVER)?.onmessage?.({
      kind: "delta",
      delta: { kind: "voteChanged" },
    });
  });
  // The mirror refreshes on a timer after a delta. Every vote ends in one
  // reaction or the other, so waiting for either waits for the refresh.
  await waitFor(() =>
    expect(wire.attention.length + wire.notified.length).toBeGreaterThan(0),
  );
}

beforeEach(() => {
  wire.channels.clear();
  wire.states.clear();
  wire.notified.length = 0;
  wire.attention.length = 0;
});

afterEach(cleanup);

describe("a vote opening in the battle room", () => {
  it("rings through, and does not notify, when it kicks the player", async () => {
    await callVote("bKick Alice", "Bob");
    expect(wire.attention).toEqual([
      { event: "voteNamesYou", announcement: "Bob called a vote: bKick Alice" },
    ]);
    expect(wire.notified).toEqual([]);
  });

  it("rings through when it makes the player a spectator", async () => {
    await callVote("force Alice spec", "Bob");
    expect(wire.attention.map((a) => a.event)).toEqual(["voteNamesYou"]);
    expect(wire.notified).toEqual([]);
  });

  it("rings through for a vote already open when the room is first drawn", async () => {
    await openRoomWith(vote("kickBan Alice", "Bob"));
    expect(wire.attention.map((a) => a.event)).toEqual(["voteNamesYou"]);
    expect(wire.notified).toEqual([]);
  });

  it("only notifies for a vote about somebody else", async () => {
    await callVote("bKick Bob", "Carol");
    expect(wire.attention).toEqual([]);
    expect(wire.notified).toEqual([
      { title: "Vote called", body: "bKick Bob", to: expect.anything() },
    ]);
  });

  it("only notifies for a near miss on the player's name", async () => {
    await callVote("bKick Al", "Bob");
    expect(wire.attention).toEqual([]);
    expect(wire.notified).toHaveLength(1);
  });

  it("only notifies for a map named after the player", async () => {
    await callVote("set map Alice", "Bob");
    expect(wire.attention).toEqual([]);
    expect(wire.notified).toHaveLength(1);
  });

  it("only notifies for a vote the player called", async () => {
    await callVote("bKick Alice", "Alice");
    expect(wire.attention).toEqual([]);
    expect(wire.notified).toHaveLength(1);
  });
});

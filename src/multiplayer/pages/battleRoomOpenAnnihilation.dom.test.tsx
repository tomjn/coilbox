// @vitest-environment happy-dom

/**
 * The battle room of somebody joining an Open Annihilation battle (issue
 * #4947). The room hook is stood in for with a plain object and the cards that
 * need an engine are stubbed, so what is under test is the page's own wiring:
 * what it shows, when it launches OA, and with which arguments.
 */

import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OaEvent } from "../../play/bindings";
import { observeOaAutoLaunch } from "../oaRun";

const state = vi.hoisted(() => ({
  room: null as Record<string, unknown> | null,
  program: null as { path: string; version: string } | null,
  /** What the host's launch hook was given and answers, for a room we host. */
  hostArgs: null as { autoStart: boolean } | null,
  hostRunning: false,
  hostStart: vi.fn(),
  /** What the room gave the chat card last. */
  chatProps: null as { canChangeMap: boolean } | null,
}));

vi.mock("@/components/ui/popover", () => ({
  Popover: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  PopoverTrigger: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  PopoverContent: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
}));

vi.mock("../battle/useBattleRoom", () => ({
  useBattleRoom: () => state.room,
}));
vi.mock("../battle/useBattleRoomKey", () => ({ useBattleRoomKey: () => null }));
vi.mock("../store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../store")>()),
  useMultiplayer: () => ({ disconnect: vi.fn(), connections: [] }),
  useProtocolServers: () => [],
  connectionLabelIfSeveral: () => null,
}));
vi.mock("@/direct/hostedRoom", () => ({ useHostedRoom: () => null }));
vi.mock("@/direct/PendingJoins", () => ({
  PendingJoinsPanel: () => null,
  usePendingJoins: () => ({ pending: [], answer: vi.fn() }),
}));
vi.mock("@/direct/RoomMoved", () => ({ RoomMovedPanel: () => null }));
vi.mock("@/direct/room", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/direct/room")>()),
  closeEndsTheRoom: () => false,
  hostedRoomKey: () => null,
}));
vi.mock("@/direct/stopRoom", () => ({ stopHostedRoom: vi.fn() }));
vi.mock("@/factions/logos", () => ({ useFactionLogos: () => ({}) }));
vi.mock("@/content/branding", () => ({ useBrandingEntry: () => undefined }));
vi.mock("@/play/config", () => ({
  useSkirmishAis: () => ({ ais: [], loaded: true }),
}));
vi.mock("@/play/presets", () => ({
  useSkirmishPresets: () => ({
    presets: [],
    touchPreset: vi.fn(),
    savePreset: vi.fn(),
  }),
}));
vi.mock("@/play/presetImport", () => ({
  PresetImportGate: () => null,
  usePresetImport: () => ({
    importFromFile: vi.fn(),
    pending: null,
    setPending: vi.fn(),
  }),
}));
vi.mock("@/widgets/useRoomWidgets", () => ({ useRoomWidgets: () => [] }));
vi.mock("@/startbox/StartBoxControls", () => ({
  StartBoxControls: () => null,
  useStartBoxAllies: () => ({
    activeAlly: 0,
    allyList: [],
    pickAlly: vi.fn(),
  }),
}));
vi.mock("../battle/useBattleLaunch", () => ({
  useBattleLaunch: () => ({ running: false, error: null, launch: vi.fn() }),
}));
vi.mock("../battle/useRejoinRequest", () => ({ useRejoinRequest: vi.fn() }));
vi.mock("../battle/useOaHostLaunch", () => ({
  useOaHostLaunch: (args: { autoStart: boolean }) => {
    state.hostArgs = args;
    return {
      running: state.hostRunning,
      error: null,
      start: state.hostStart,
      cancel: vi.fn(),
    };
  },
}));
vi.mock("../notes", () => ({
  useNoteActions: () => ({ get: () => "", set: vi.fn() }),
}));
vi.mock("../useNameMark", () => ({ useNameMark: () => () => null }));
vi.mock("../statsRelation", () => ({ useStatsRelations: () => () => null }));
vi.mock("../battle/RoomSplit", () => ({
  useRoomSplit: () => ({
    columnRef: { current: null },
    tableRef: { current: null },
    tableId: "table",
    tableStyle: {},
    tableClass: "",
    handle: {},
  }),
  RoomSplitHandle: () => null,
}));

// The cards that read an engine, a game or a map. Each leaves a mark so a test
// can say which of them the room drew.
const { stub } = vi.hoisted(() => ({
  stub: (id: string) => () => <div data-testid={id} />,
}));
vi.mock("../battle/ApplySkirmishPresetDrawer", () => ({
  ApplySkirmishPresetDrawer: () => null,
}));
vi.mock("../battle/AutohostControls", () => ({
  AutohostControls: stub("autohost-controls"),
}));
vi.mock("../battle/BattleChatCard", () => ({
  BattleChatCard: (props: { canChangeMap: boolean }) => {
    state.chatProps = props;
    return <div data-testid="chat" />;
  },
}));
vi.mock("../battle/BattleEngineCard", () => ({
  BattleEngineCard: stub("recoil-engine-card"),
}));
vi.mock("../battle/BattleGameCard", () => ({
  BattleGameCard: stub("game-card"),
}));
vi.mock("../battle/BattleMapCard", () => ({
  BattleMapCard: stub("map-card"),
}));
vi.mock("../battle/BattleMembersTable", () => ({
  BattleMembersTable: stub("members-table"),
}));
vi.mock("../battle/BattleMovedPanel", () => ({ BattleMovedPanel: () => null }));
vi.mock("../battle/BattleOptionsDrawer", () => ({
  BattleOptionsDrawer: stub("options-drawer"),
}));
vi.mock("../battle/CompatBattleCard", () => ({
  CompatBattleCard: () => null,
}));
vi.mock("../battle/CompatHostExport", () => ({
  CompatHostExport: () => null,
}));
vi.mock("../battle/GameTypePresetsControls", () => ({
  GameTypePresetsControls: () => null,
}));
vi.mock("../battle/MissingContentCard", () => ({
  MissingContentCard: () => null,
}));
vi.mock("../battle/RoomWidgetsWarning", () => ({
  RoomWidgetsWarning: () => null,
}));
vi.mock("../battle/StartPosOptions", () => ({
  StartPosOptions: stub("start-pos"),
}));
vi.mock("../battle/VotePanel", () => ({ VotePanel: () => null }));

vi.mock("../openAnnihilation", () => ({
  useOpenAnnihilation: () => [state.program],
}));

const bindings = vi.hoisted(() => ({
  playOaLaunch: vi.fn(),
  playOaCancel: vi.fn(),
  playOaMaps: vi.fn(),
  playOaCheck: vi.fn(),
}));
vi.mock("../../play/bindings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../play/bindings")>()),
  ...bindings,
}));

const opener = vi.hoisted(() => ({ openUrl: vi.fn() }));
vi.mock("@tauri-apps/plugin-opener", () => opener);

const { FakeChannel } = vi.hoisted(() => ({
  FakeChannel: class {
    onmessage: (event: unknown) => void = () => {};
  },
}));
vi.mock("@tauri-apps/api/core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tauri-apps/api/core")>()),
  Channel: FakeChannel,
}));

import BattleRoomRoute from "./BattleRoomPage";

vi.mock("@picoframe/frame", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@picoframe/frame")>()),
  NavGate: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock("react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-router")>()),
  useNavigate: () => vi.fn(),
  useLocation: () => ({ state: null }),
}));

const OA = {
  path: "/oa/open-annihilation",
  version: "Open Annihilation 0.8.10",
};

function battle(engine: string) {
  return {
    id: 4021,
    tachyonId: null,
    host: "host",
    ip: "203.0.113.9",
    port: "8452",
    natType: "0",
    relayed: false,
    map: "Host chooses in OA",
    maphash: "1",
    modname: "Total Annihilation",
    engine,
    version: "Open Annihilation 0.8.9",
    maxPlayers: 8,
    playerCount: null,
    passworded: false,
    locked: false,
    spectatorCount: 0,
    title: "[OA] Friday night",
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
}

const setIngame = vi.fn();

/** The room hook's answer, with every field the page reads given a plain value. */
function roomFor(engine: string, over: Record<string, unknown> = {}) {
  return {
    battle: battle(engine),
    me: "abcdefghijklmnopqrst",
    serverKey: "server",
    rows: [
      { name: "host", kind: "human", self: false, host: true },
      { name: "abcdefghijklmnopqrst", kind: "human", self: true, host: false },
    ],
    sides: [],
    maps: [],
    selfHost: false,
    isFounder: false,
    iAmBoss: false,
    hostIngame: false,
    presentAtStart: false,
    serverSendsMatch: false,
    askForMatch: undefined,
    battleStartSeq: 0,
    allReady: true,
    sync: "synced",
    engine: { verdict: "match", hostLabel: null, mineLabel: null },
    target: { executable: "/engine", dataDir: "/data", syncVersion: "x" },
    targetLoading: false,
    contentUnreadable: false,
    contentUnreadableReason: null,
    contentKnown: true,
    contentNonce: 0,
    mapMissing: false,
    gameMissing: false,
    dependencyBlock: null,
    compat: { status: "idle" },
    requiredGame: undefined,
    localGame: undefined,
    localMap: undefined,
    mapsLoading: false,
    engineUnreadable: false,
    currentVote: null,
    myStatus: undefined,
    directRoom: false,
    actionError: null,
    startPosType: 0,
    startPositionsUnavailable: false,
    canEditOptions: false,
    canEditBoxes: false,
    canEditRestrictions: false,
    hostControls: {},
    setIngame,
    setReady: vi.fn(),
    setSpectator: vi.fn(),
    setLocked: vi.fn(),
    startGame: vi.fn(),
    leave: vi.fn().mockResolvedValue(undefined),
    ...over,
  };
}

let launches: {
  args: string[];
  onEvent: { onmessage: (e: OaEvent) => void };
  finish: (o: { exitCode: number | null; signal: number | null }) => void;
}[] = [];

const IN_GAME = { connected: true, battleId: 4021, hostIngame: true };
const HOST_STOPPED = { connected: true, battleId: 4021, hostIngame: false };

function show() {
  return render(
    <I18nProvider i18n={i18n}>
      <BattleRoomRoute />
    </I18nProvider>,
  );
}

beforeEach(() => {
  i18n.loadAndActivate({ locale: "en", messages: {} });
  launches = [];
  state.program = OA;
  state.room = roomFor("Open Annihilation");
  state.hostArgs = null;
  state.hostRunning = false;
  state.hostStart.mockReset().mockResolvedValue(undefined);
  state.chatProps = null;
  setIngame.mockReset();
  opener.openUrl.mockReset().mockResolvedValue(undefined);
  bindings.playOaCancel.mockReset().mockResolvedValue({ cancelled: true });
  bindings.playOaCheck
    .mockReset()
    .mockResolvedValue({ path: OA.path, version: "Open Annihilation 0.8.10" });
  bindings.playOaLaunch.mockReset().mockImplementation(
    (a: { args: string[]; onEvent: { onmessage: (e: OaEvent) => void } }) =>
      new Promise((resolve) => {
        launches.push({ args: a.args, onEvent: a.onEvent, finish: resolve });
      }),
  );
});
afterEach(async () => {
  cleanup();
  // What the room remembers about launching is held outside the page too.
  act(() => observeOaAutoLaunch(() => HOST_STOPPED));
  // The run is held outside the page, so one a test left up would block the next.
  await act(async () => {
    for (const l of launches) l.finish({ exitCode: 0, signal: null });
  });
});

describe("the room of an Open Annihilation battle you joined", () => {
  it("says it is waiting for the host, and launches nothing, until the host is in game", () => {
    show();
    const button = screen.getByRole("button", { name: "Waiting for host" });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(bindings.playOaLaunch).not.toHaveBeenCalled();
  });

  it("draws the players and the chat, and no team table, map, options or Recoil cards", () => {
    show();
    expect(screen.getByText("host")).toBeTruthy();
    expect(screen.getByTestId("chat")).toBeTruthy();
    for (const id of [
      "members-table",
      "map-card",
      "start-pos",
      "options-drawer",
      "game-card",
      "recoil-engine-card",
    ]) {
      expect(screen.queryByTestId(id)).toBeNull();
    }
    expect(screen.queryByText("Ready")).toBeNull();
    expect(screen.queryByText("Spectate")).toBeNull();
  });

  it("launches OA by itself once the host is in game, with exactly the arguments", async () => {
    const { rerender } = show();
    state.room = roomFor("Open Annihilation", { hostIngame: true });
    rerender(
      <I18nProvider i18n={i18n}>
        <BattleRoomRoute />
      </I18nProvider>,
    );
    await waitFor(() => expect(launches).toHaveLength(1));
    expect(bindings.playOaLaunch.mock.calls[0][0].executable).toBe(OA.path);
    expect(launches[0].args).toEqual([
      "--join",
      "203.0.113.9",
      "--player-name",
      "abcdefghijklmnop",
      "--game-name",
      "CB4021",
    ]);
    expect(
      (screen.getByRole("button", { name: "In OA" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it("launches for a player who walks in after the host is already in game", async () => {
    state.room = roomFor("Open Annihilation", {
      hostIngame: true,
      presentAtStart: false,
    });
    show();
    await waitFor(() => expect(launches).toHaveLength(1));
  });

  it("sets the player's in game flag on match started and clears it on exit", async () => {
    state.room = roomFor("Open Annihilation", { hostIngame: true });
    show();
    await waitFor(() => expect(launches).toHaveLength(1));
    act(() =>
      launches[0].onEvent.onmessage({ kind: "match", change: "started" }),
    );
    expect(setIngame.mock.calls).toEqual([[true]]);
    await act(async () => launches[0].finish({ exitCode: 0, signal: null }));
    expect(setIngame.mock.calls).toEqual([[true], [false]]);
  });

  it("offers Join in OA again after OA exits, and does not launch twice by itself", async () => {
    state.room = roomFor("Open Annihilation", { hostIngame: true });
    show();
    await waitFor(() => expect(launches).toHaveLength(1));
    await act(async () => launches[0].finish({ exitCode: 0, signal: null }));
    const button = await screen.findByRole("button", { name: "Join in OA" });
    expect(launches).toHaveLength(1);
    fireEvent.click(button);
    await waitFor(() => expect(launches).toHaveLength(2));
  });

  it("shows OA's refusal line in the room", async () => {
    bindings.playOaLaunch.mockRejectedValue(
      new Error("open-annihilation: no game named CB4021 answered"),
    );
    state.room = roomFor("Open Annihilation", { hostIngame: true });
    show();
    expect(
      await screen.findByText(/no game named CB4021 answered/),
    ).toBeTruthy();
  });

  it("shows a refusal that arrives as an exit event after the stream began", async () => {
    state.room = roomFor("Open Annihilation", { hostIngame: true });
    show();
    await waitFor(() => expect(launches).toHaveLength(1));
    act(() =>
      launches[0].onEvent.onmessage({ kind: "exit", reason: "refused" }),
    );
    await act(async () => launches[0].finish({ exitCode: 2, signal: null }));
    expect(
      await screen.findByText("Open Annihilation refused to join this battle."),
    ).toBeTruthy();
  });

  it("ends OA when the player leaves", async () => {
    state.room = roomFor("Open Annihilation", { hostIngame: true });
    show();
    await waitFor(() => expect(launches).toHaveLength(1));
    fireEvent.click(screen.getByRole("button", { name: "Leave" }));
    await waitFor(() => expect(bindings.playOaCancel).toHaveBeenCalledOnce());
  });

  it("shows the host's version and the player's own, with no download", async () => {
    show();
    expect(screen.getByText("Open Annihilation 0.8.9")).toBeTruthy();
    expect(await screen.findByText("Open Annihilation 0.8.10")).toBeTruthy();
    expect(bindings.playOaCheck).toHaveBeenCalledWith({ path: OA.path });
    expect(screen.queryByText(/^Download/)).toBeNull();
    expect(
      screen.queryByRole("button", { name: /Get Open Annihilation/ }),
    ).toBe(null);
  });
});

describe("coming back to an Open Annihilation battle it already started for", () => {
  async function startAndExit() {
    state.room = roomFor("Open Annihilation", { hostIngame: true });
    const first = show();
    await waitFor(() => expect(launches).toHaveLength(1));
    await act(async () => launches[0].finish({ exitCode: 0, signal: null }));
    first.unmount();
  }

  it("shows Join in OA and waits for the click when the room is shown again", async () => {
    await startAndExit();
    show();
    const button = await screen.findByRole("button", { name: "Join in OA" });
    expect(launches).toHaveLength(1);
    fireEvent.click(button);
    await waitFor(() => expect(launches).toHaveLength(2));
  });

  it("launches by itself again once the host has stopped being in game", async () => {
    await startAndExit();
    act(() => observeOaAutoLaunch(() => HOST_STOPPED));
    show();
    await waitFor(() => expect(launches).toHaveLength(2));
  });

  it("launches by itself again after the player left the battle, with the page not shown", async () => {
    await startAndExit();
    act(() => observeOaAutoLaunch(() => IN_GAME));
    act(() => observeOaAutoLaunch(() => ({ ...IN_GAME, battleId: null })));
    show();
    await waitFor(() => expect(launches).toHaveLength(2));
  });

  it("does not forget on a drop or a reconnect that has not shown the player back in the battle", async () => {
    await startAndExit();
    act(() => observeOaAutoLaunch(() => IN_GAME));
    act(() => observeOaAutoLaunch(() => ({ ...IN_GAME, connected: false })));
    act(() => observeOaAutoLaunch(() => null));
    act(() => observeOaAutoLaunch(() => ({ ...IN_GAME, battleId: null })));
    show();
    await screen.findByRole("button", { name: "Join in OA" });
    expect(launches).toHaveLength(1);
  });

  it("keeps a battle's memory separate from another battle's", async () => {
    await startAndExit();
    state.room = roomFor("Open Annihilation", {
      hostIngame: true,
      battle: { ...battle("Open Annihilation"), id: 4022 },
    });
    show();
    await waitFor(() => expect(launches).toHaveLength(2));
  });
});

describe("a player with no Open Annihilation", () => {
  beforeEach(() => {
    state.program = null;
  });

  it("sees the host's version and a link to Core Prime, and no Recoil download", () => {
    show();
    expect(screen.getByText("Open Annihilation 0.8.9")).toBeTruthy();
    expect(screen.getByText("None")).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: /Get Open Annihilation/ }),
    );
    expect(opener.openUrl).toHaveBeenCalledWith("https://play.coreprime.net");
    expect(screen.queryByText(/^Download/)).toBeNull();
    expect(screen.queryByTestId("recoil-engine-card")).toBeNull();
  });

  it("does not launch when the host goes in game, and says why on the button", async () => {
    state.room = roomFor("Open Annihilation", { hostIngame: true });
    show();
    const button = screen.getByRole("button", { name: "Join in OA" });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(button.getAttribute("title")).toBe(
      "Set where Open Annihilation is in Settings first.",
    );
    expect(bindings.playOaLaunch).not.toHaveBeenCalled();
  });
});

describe("the room of an Open Annihilation battle you host", () => {
  beforeEach(() => {
    state.room = roomFor("Open Annihilation", {
      selfHost: true,
      isFounder: true,
      canChangeMap: true,
      canEditOptions: true,
      canEditBoxes: true,
      rows: [
        { name: "abcdefghijklmnopqrst", kind: "human", self: true, host: true },
      ],
    });
  });

  it("draws the players, chat and engine card, and no way to pick a Recoil map", () => {
    show();
    expect(screen.getByText("abcdefghijklmnopqrst")).toBeTruthy();
    expect(screen.getByTestId("chat")).toBeTruthy();
    for (const id of [
      "members-table",
      "map-card",
      "start-pos",
      "options-drawer",
      "game-card",
      "recoil-engine-card",
      "autohost-controls",
    ]) {
      expect(screen.queryByTestId(id)).toBeNull();
    }
    expect(state.chatProps?.canChangeMap).toBe(false);
    expect(screen.queryByText("Ready")).toBeNull();
    expect(screen.queryByText("Spectate")).toBeNull();
  });

  it("asks the launch hook to start OA by itself", () => {
    show();
    expect(state.hostArgs?.autoStart).toBe(true);
  });

  it("says Start OA when OA is not up, and starts it on a click", () => {
    show();
    const button = screen.getByRole("button", { name: "Start OA" });
    expect((button as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(button);
    expect(state.hostStart).toHaveBeenCalledOnce();
  });

  it("says In OA, and cannot be pressed, while OA is up", () => {
    state.hostRunning = true;
    show();
    const button = screen.getByRole("button", { name: "In OA" });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByRole("button", { name: "Start OA" })).toBeNull();
  });

  it("keeps the host's controls to closing the battle and locking it", () => {
    show();
    expect(screen.getByRole("button", { name: "Close" })).toBeTruthy();
    expect(screen.getByText("Locked")).toBeTruthy();
  });

  it("gives the host's own version once, with no separate host row", async () => {
    show();
    expect(await screen.findByText("Open Annihilation 0.8.10")).toBeTruthy();
    expect(screen.getByText("Version")).toBeTruthy();
    expect(screen.queryByText("Host", { selector: "dt" })).toBeNull();
    expect(screen.queryByText("Yours")).toBeNull();
    expect(screen.queryByText("Open Annihilation 0.8.9")).toBeNull();
  });

  it("shows the Core Prime link to a host with no OA set", () => {
    state.program = null;
    show();
    expect(screen.getByText("None")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: /Get Open Annihilation/ }),
    ).toBeTruthy();
  });
});

describe("a Recoil battle", () => {
  it("keeps the full room for a Recoil host, and never starts OA by itself", () => {
    state.room = roomFor("spring", {
      selfHost: true,
      isFounder: true,
      canChangeMap: true,
    });
    show();
    for (const id of ["members-table", "map-card", "game-card"]) {
      expect(screen.getByTestId(id)).toBeTruthy();
    }
    expect(state.hostArgs?.autoStart).toBe(false);
    expect(state.chatProps?.canChangeMap).toBe(true);
  });

  it("keeps its table, map and engine cards, and never launches OA", () => {
    state.room = roomFor("spring", { hostIngame: true, presentAtStart: false });
    show();
    for (const id of [
      "members-table",
      "map-card",
      "game-card",
      "recoil-engine-card",
    ]) {
      expect(screen.getByTestId(id)).toBeTruthy();
    }
    expect(screen.queryByText("Waiting for host")).toBeNull();
    expect(bindings.playOaLaunch).not.toHaveBeenCalled();
  });
});

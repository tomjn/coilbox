// @vitest-environment happy-dom

/**
 * An Open Annihilation battle has no room (issue #4972), and a Recoil battle's is
 * unchanged. The room hook is stood in for with a plain object and the cards that
 * need an engine are stubbed, so what is under test is the route's own wiring.
 */

import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  room: null as Record<string, unknown> | null,
  /** The battle the connection shows the player in. */
  joined: null as Record<string, unknown> | null,
  roomHookCalled: false,
  /** What the room gave the chat card last. */
  chatProps: null as { canChangeMap: boolean } | null,
  /** What `useBattleLaunch` answers. */
  launch: {
    running: false,
    error: null,
    launch: (() => {}) as (opts?: { onEngineStarted?: () => void }) => unknown,
  },
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
  useBattleRoom: () => {
    state.roomHookCalled = true;
    return state.room;
  },
}));
vi.mock("../battle/useBattleRoomKey", () => ({ useBattleRoomKey: () => null }));
vi.mock("../store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../store")>()),
  useMultiplayer: () => ({ disconnect: vi.fn(), connections: [] }),
  useProtocolServers: () => [],
  useConnection: () =>
    state.joined
      ? {
          mirror: {
            state: {
              currentBattle: state.joined.id,
              battles: { [String(state.joined.id)]: state.joined },
            },
          },
        }
      : undefined,
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
  useBattleLaunch: () => state.launch,
}));
vi.mock("../battle/useRejoinRequest", () => ({ useRejoinRequest: vi.fn() }));
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

import BattleRoomRoute from "./BattleRoomPage";

vi.mock("@picoframe/frame", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@picoframe/frame")>()),
  NavGate: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock("react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-router")>()),
  useNavigate: () => vi.fn(),
  useLocation: () => ({ state: null }),
  Navigate: ({ to }: { to: string }) => (
    <div data-testid={to === "/battles" ? "battle-list" : "elsewhere"} />
  ),
}));

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
    setIngame: vi.fn(),
    clearStaleIngame: vi.fn(),
    setReady: vi.fn(),
    setSpectator: vi.fn(),
    setLocked: vi.fn(),
    startGame: vi.fn(),
    leave: vi.fn().mockResolvedValue(undefined),
    ...over,
  };
}

function show() {
  return render(
    <I18nProvider i18n={i18n}>
      <BattleRoomRoute />
    </I18nProvider>,
  );
}

beforeEach(() => {
  i18n.loadAndActivate({ locale: "en", messages: {} });
  state.room = roomFor("spring");
  state.joined = null;
  state.roomHookCalled = false;
  state.chatProps = null;
  state.launch = { running: false, error: null, launch: vi.fn() };
});
afterEach(cleanup);

describe("a link to the room of an Open Annihilation battle", () => {
  it("goes to the battle list and starts nothing of the room", () => {
    state.joined = battle("Open Annihilation");
    show();
    expect(screen.getByTestId("battle-list")).toBeTruthy();
    expect(screen.queryByTestId("chat")).toBeNull();
    expect(state.roomHookCalled).toBe(false);
  });
});

describe("a Recoil battle", () => {
  it("keeps the full room for a Recoil host", () => {
    state.room = roomFor("spring", {
      selfHost: true,
      isFounder: true,
      canChangeMap: true,
    });
    show();
    for (const id of ["members-table", "map-card", "game-card"]) {
      expect(screen.getByTestId(id)).toBeTruthy();
    }
    expect(state.chatProps?.canChangeMap).toBe(true);
  });

  it("keeps its table, map and engine cards for a joiner", () => {
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
  });
});

describe("a Recoil host's in-game flag", () => {
  const hosting = { selfHost: true, isFounder: true };

  it("is raised when the engine exists, and dropped when it exits", async () => {
    let engineStarted: (() => void) | undefined;
    let engineExits: () => void = () => {};
    state.launch.launch = (opts) => {
      engineStarted = opts?.onEngineStarted;
      return new Promise<void>((resolve) => {
        engineExits = resolve;
      });
    };
    const setIngame = vi.fn();
    state.room = roomFor("spring", { ...hosting, setIngame });
    show();

    fireEvent.click(screen.getByRole("button", { name: /start/i }));
    expect(setIngame).not.toHaveBeenCalled();

    act(() => engineStarted?.());
    expect(setIngame).toHaveBeenLastCalledWith(true);

    await act(async () => engineExits());
    expect(setIngame).toHaveBeenLastCalledWith(false);
  });

  it("is cleared when the server holds it with no engine behind it", () => {
    const clearStaleIngame = vi.fn();
    state.room = roomFor("spring", {
      ...hosting,
      hostIngame: true,
      clearStaleIngame,
    });
    show();
    expect(clearStaleIngame).toHaveBeenCalledTimes(1);
  });

  it("is left alone while the engine is up", () => {
    const clearStaleIngame = vi.fn();
    state.launch.running = true;
    state.room = roomFor("spring", {
      ...hosting,
      hostIngame: true,
      clearStaleIngame,
    });
    show();
    expect(clearStaleIngame).not.toHaveBeenCalled();
  });
});

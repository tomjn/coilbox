// @vitest-environment happy-dom

/**
 * The Battles page with two lobby connections open (issue #2844). Each
 * server's battles are listed under a heading naming it, and joining a battle
 * on one server while in a battle on the other asks, leaves the first, joins
 * the second and opens that server's battle room.
 *
 * Two live connections can only come from a reload while the connect-blocking
 * rule stands (issue #2848), so the provider setup is
 * `reattachAll.dom.test.tsx`'s. The room hosting and LAN parts of the page are
 * stood in for, since none of them is about servers.
 */

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  installSettingsStorage,
  memorySettingsStorage,
} from "../../lib/storedSetting";
import type { Battle, LobbyEvent, LobbyState } from "../bindings";

interface FakeChannel {
  onmessage?: (ev: LobbyEvent) => void;
}

const wire = vi.hoisted(() => ({
  channels: new Map<string, FakeChannel>(),
  activeKeys: [] as string[],
  states: new Map<string, unknown>(),
  calls: [] as string[],
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

// Everything on the page that is not about lobby servers.
vi.mock("../../content/config", () => ({
  useScanTargetSelection: () => ({ selected: null }),
}));
vi.mock("../../direct/hostedRoom", () => ({
  useHostedRoom: () => null,
  setHostedRoom: () => {},
}));
vi.mock("../../direct/useLanRooms", () => ({
  useLanRooms: () => ({ rooms: [], error: null }),
}));
vi.mock("../../direct/HostRoomControl", () => ({
  HostRoomControl: () => null,
}));
vi.mock("../../direct/LanRooms", () => ({ LanRooms: () => null }));
vi.mock("../../direct/LinkedRoomJoin", () => ({ LinkedRoomJoin: () => null }));
vi.mock("../../direct/VpnWarning", () => ({ VpnWarning: () => null }));
vi.mock("../../direct/bindings", () => ({}));
vi.mock("../battles/BattleFilterPopover", () => ({
  BattleFilterPopover: () => null,
}));
vi.mock("../battles/BattleRowMapThumb", () => ({
  BattleRowMapThumb: () => null,
}));
vi.mock("../battles/HostBattleButton", () => ({
  // Renders the seeded title when a "Host as battle" jump opened this
  // section's form, so a test can see which server's section it landed on
  // without driving the real popover open.
  HostBattleButton: ({
    initialTitle,
    autoOpen,
  }: {
    initialTitle?: string;
    autoOpen?: boolean;
  }) => (
    <button type="button">
      Host a battle
      {autoOpen && initialTitle ? ` (seeded: ${initialTitle})` : ""}
    </button>
  ),
}));

vi.mock("../bindings", () => ({
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
  mpOpenBattle: async () => ({}),
  mpCreateLobby: async () => ({}),
  mpZerokOpenBattle: async () => ({}),
}));

vi.mock("../../lobby-servers/bindings", () => ({
  lsGetCredential: async () => ({ secret: "hunter2" }),
}));

import { MultiplayerProvider } from "../store";
import BattlesRoute from "./BattlesPage";

const KEY_A = "AF@server4.beyondallreason.info:8201";
const KEY_B = "Zeta@lobby.recoilengine.org:8200";

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

let location = "";

function Where() {
  const l = useLocation();
  location = `${l.pathname}${l.search}`;
  return null;
}

async function fire(serverKey: string, ev: LobbyEvent) {
  const channel = wire.channels.get(serverKey);
  if (!channel?.onmessage) throw new Error(`no channel for ${serverKey}`);
  await act(async () => {
    channel.onmessage?.(ev);
  });
}

async function openPage(state?: unknown) {
  render(
    <MemoryRouter initialEntries={[{ pathname: "/battles", state }]}>
      <MultiplayerProvider>
        <Routes>
          <Route path="/battles" element={<BattlesRoute />} />
          <Route path="/battle" element={null} />
        </Routes>
        <Where />
      </MultiplayerProvider>
    </MemoryRouter>,
  );
  await act(async () => {});
  for (const key of wire.activeKeys) {
    await fire(key, { kind: "phase", phase: "ready", agreement: null });
  }
}

beforeEach(() => {
  // `seedJoinedChannels` reads through the storage singleton before seeding a
  // first connect's auto-join channels (issue #2920).
  installSettingsStorage(memorySettingsStorage());
  wire.channels.clear();
  wire.states.clear();
  wire.calls.length = 0;
  wire.activeKeys = [KEY_A, KEY_B];
  wire.states.set(KEY_A, lobbyState("AF", [battle(1, "Battle on A")], 1));
  wire.states.set(KEY_B, lobbyState("Zeta", [battle(7, "Battle on B")], null));
});

afterEach(cleanup);

describe("the Battles page with two connections", () => {
  it("lists both servers' battles, each under its server's name", async () => {
    await openPage();
    const headings = screen
      .getAllByRole("heading", { level: 2 })
      .map((h) => h.textContent ?? "");
    expect(headings.some((h) => h.startsWith("AF on "))).toBe(true);
    expect(headings.some((h) => h.startsWith("Zeta on "))).toBe(true);
    expect(screen.getByText("Battle on A")).toBeTruthy();
    expect(screen.getByText("Battle on B")).toBeTruthy();
  });

  it("asks, leaves the first battle, joins the second and opens its room", async () => {
    await openPage();
    expect(
      screen.getByText(
        /You are in a battle on .*\. Joining this one leaves it\./,
      ),
    ).toBeTruthy();
    expect(wire.calls).toEqual([]);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Leave and join" }));
    });
    expect(wire.calls).toEqual([`leave ${KEY_A}`, `join ${KEY_B} 7`]);

    // The join lands on B.
    wire.states.set(KEY_A, lobbyState("AF", [battle(1, "Battle on A")], null));
    wire.states.set(KEY_B, lobbyState("Zeta", [battle(7, "Battle on B")], 7));
    await fire(KEY_A, {
      kind: "delta",
      delta: { kind: "battleInfoChanged", id: 1 },
    });
    await fire(KEY_B, {
      kind: "delta",
      delta: { kind: "battleInfoChanged", id: 7 },
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 80));
    });

    expect(location).toBe(`/battle?server=${encodeURIComponent(KEY_B)}`);
  });
});

describe("Host as battle: which server gets the seeded draft", () => {
  it("seeds the connection SkirmishPage resolved, not the focused one", async () => {
    // Neither connection is in a battle, so the page is the plain two-section
    // list rather than the "leave and join" prompt the other block covers.
    wire.states.set(KEY_A, lobbyState("AF", [], null));
    wire.states.set(KEY_B, lobbyState("Zeta", [], null));
    await openPage({
      hostDraft: {
        participants: [],
        gameName: "Game",
        mapName: "Map",
        startPosType: 0,
        modOptionValues: {},
      },
      hostTitle: "My hosted skirmish",
      hostServerKey: KEY_B,
    });

    // KEY_A is focused (first of the reattached keys) and renders first, but
    // SkirmishPage asked for the draft to land on KEY_B (issue #2847), so
    // only KEY_B's section shows it seeded.
    const buttons = screen.getAllByRole("button", { name: /Host a battle/ });
    expect(buttons.map((b) => b.textContent)).toEqual([
      "Host a battle",
      "Host a battle (seeded: My hosted skirmish)",
    ]);
  });
});

describe("the Battles page with one connection", () => {
  it("names no server, as before servers were told apart", async () => {
    wire.activeKeys = [KEY_B];
    await openPage();
    expect(screen.queryAllByRole("heading", { level: 2 })).toEqual([]);
    expect(screen.getByText("Battle on B")).toBeTruthy();
    expect(screen.queryByText(/leaves it/)).toBeNull();
  });
});

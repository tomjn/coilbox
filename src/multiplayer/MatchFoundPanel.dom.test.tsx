// @vitest-environment happy-dom

/**
 * The match found panel with more than one connected Tachyon server (issue
 * #2845). It used to watch only the focused connection. Now it renders one
 * panel per live Tachyon connection that has a match, and refuses to launch
 * a second engine while a game is already running or a lobby battle is
 * joined somewhere, saying why instead of silently doing nothing.
 *
 * `useBattleLaunch` is mocked rather than driven for real: this file is
 * about the block-and-say-why wiring in `MatchFoundPanel` itself, not the
 * launch pipeline, which `watchRelayedEngine.dom.test.tsx` already covers
 * end to end.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LobbyState } from "./bindings";

vi.mock("@picoframe/frame", () => ({
  Button: ({
    children,
    ...props
  }: { children?: ReactNode } & Record<string, unknown>) => (
    <button type="button" {...props}>
      {children}
    </button>
  ),
}));

vi.mock("@/play/config", () => ({
  usePreferredTarget: () => ({ target: { executable: "e", dataDir: "d" } }),
}));

const wire = vi.hoisted(() => ({
  gameRunning: false,
  inBattleKey: null as string | null,
  launchCalls: [] as { serverKey: string; blocked: string | null }[],
  errorFor: {} as Record<string, string | null>,
  launchFn: vi.fn(async () => {}),
  matchmakingReady: vi.fn(async (_args: { serverKey: string }) => ({
    sent: true,
  })),
  matchmakingCancel: vi.fn(async (_args: { serverKey: string }) => ({
    sent: true,
  })),
}));

vi.mock("@/play/PlayProvider", () => ({
  usePlay: () => ({ running: wire.gameRunning }),
}));

vi.mock("./battle/useBattleRoomKey", () => ({
  useInBattleKey: () => wire.inBattleKey,
}));

vi.mock("./battle/useBattleLaunch", () => ({
  useBattleLaunch: (
    serverKey: string,
    _target: unknown,
    _host: boolean,
    blocked: string | null,
  ) => {
    wire.launchCalls.push({ serverKey, blocked });
    return {
      running: wire.gameRunning,
      error: wire.errorFor[serverKey] ?? null,
      launch: wire.launchFn,
    };
  },
}));

vi.mock("./bindings", () => ({
  mpMatchmakingReady: (args: { serverKey: string }) =>
    wire.matchmakingReady(args),
  mpMatchmakingCancel: (args: { serverKey: string }) =>
    wire.matchmakingCancel(args),
}));

vi.mock("./ringEffect", () => ({ triggerAttention: () => {} }));
vi.mock("../notify/notify", () => ({ notify: async () => {} }));
vi.mock("./notify/notify", () => ({ notify: async () => {} }));

const KEY_A = "AF@tachyon-a.example:443";
const KEY_B = "Zeta@tachyon-b.example:443";
const BAR = "AF@tasserver.example:8200";

const servers = [
  {
    id: "a",
    name: "Server A",
    host: "tachyon-a.example",
    port: 443,
    tls: true,
    allowSelfSigned: false,
    protocol: "tachyon" as const,
  },
  {
    id: "b",
    name: "Server B",
    host: "tachyon-b.example",
    port: 443,
    tls: true,
    allowSelfSigned: false,
    protocol: "tachyon" as const,
  },
];

function emptyState(found: boolean, queueName = "Duel"): LobbyState {
  return {
    myUsername: "AF",
    matchmaking: {
      supported: true,
      queues: found ? [{ id: "1v1", name: queueName }] : [],
      searching: [],
      found: found
        ? {
            queueId: "1v1",
            readyBy: Date.now() + 60_000,
            readyCount: 0,
            readied: false,
          }
        : null,
    },
    currentBattle: null,
  } as unknown as LobbyState;
}

function connection(serverKey: string, state: LobbyState) {
  return {
    serverKey,
    live: true,
    mirror: { state, battleStartSeq: 0 },
  };
}

const wireConnections = vi.hoisted(() => ({
  connections: {} as Record<string, ReturnType<typeof connection>>,
  activeKey: null as string | null,
}));

vi.mock("./store", () => ({
  useMultiplayer: () => ({
    connections: wireConnections.connections,
    activeKey: wireConnections.activeKey,
  }),
  useConnection: (serverKey: string | null) =>
    serverKey ? (wireConnections.connections[serverKey] ?? null) : null,
  useProtocolServers: () => servers,
  serverNameFor: (key: string, list: typeof servers) =>
    list.find((s) => key.endsWith(`@${s.host}:${s.port}`))?.name ?? key,
  initialMirror: { state: null, battleStartSeq: 0 },
}));

import { MatchFoundPanel } from "./MatchFoundPanel";

function setConnections(
  entries: Record<string, ReturnType<typeof connection>>,
) {
  wireConnections.connections = entries;
}

afterEach(() => {
  cleanup();
  wire.gameRunning = false;
  wire.inBattleKey = null;
  wire.launchCalls.length = 0;
  wire.errorFor = {};
  wireConnections.activeKey = null;
  vi.clearAllMocks();
});

describe("with a single Tachyon connection", () => {
  it("renders one panel, as before servers were told apart", () => {
    setConnections({ [KEY_A]: connection(KEY_A, emptyState(true, "Duel")) });
    render(<MatchFoundPanel />);
    expect(screen.getAllByRole("alertdialog")).toHaveLength(1);
    expect(screen.getByText("Match found: Duel")).toBeTruthy();
  });

  it("renders nothing with no match", () => {
    setConnections({ [KEY_A]: connection(KEY_A, emptyState(false)) });
    render(<MatchFoundPanel />);
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });
});

describe("with two Tachyon connections", () => {
  it("renders a panel for each one that has a match", () => {
    setConnections({
      [KEY_A]: connection(KEY_A, emptyState(true, "Duel")),
      [KEY_B]: connection(KEY_B, emptyState(true, "Team")),
    });
    render(<MatchFoundPanel />);
    expect(screen.getAllByRole("alertdialog")).toHaveLength(2);
    expect(screen.getByText("Match found: Duel")).toBeTruthy();
    expect(screen.getByText("Match found: Team")).toBeTruthy();
  });

  it("renders only the one with a match", () => {
    setConnections({
      [KEY_A]: connection(KEY_A, emptyState(true, "Duel")),
      [KEY_B]: connection(KEY_B, emptyState(false)),
    });
    render(<MatchFoundPanel />);
    expect(screen.getAllByRole("alertdialog")).toHaveLength(1);
    expect(screen.getByText("Match found: Duel")).toBeTruthy();
  });

  it("ignores a matched connection that is not Tachyon", () => {
    setConnections({
      [KEY_A]: connection(KEY_A, emptyState(true, "Duel")),
      [BAR]: connection(BAR, emptyState(true, "NotTachyon")),
    });
    render(<MatchFoundPanel />);
    expect(screen.getAllByRole("alertdialog")).toHaveLength(1);
    expect(screen.queryByText("Match found: NotTachyon")).toBeNull();
  });

  it("accepts and turns down the right connection's match", async () => {
    setConnections({
      [KEY_A]: connection(KEY_A, emptyState(true, "Duel")),
      [KEY_B]: connection(KEY_B, emptyState(true, "Team")),
    });
    render(<MatchFoundPanel />);

    const dialogs = screen.getAllByRole("alertdialog");
    const teamDialog = dialogs.find((d) => d.textContent?.includes("Team"));
    if (!teamDialog) throw new Error("no Team panel");
    fireEvent.click(
      Array.from(teamDialog.querySelectorAll("button")).find(
        (b) => b.textContent === "Accept",
      ) as HTMLButtonElement,
    );
    expect(wire.matchmakingReady).toHaveBeenCalledWith({ serverKey: KEY_B });

    const duelDialog = dialogs.find((d) => d.textContent?.includes("Duel"));
    if (!duelDialog) throw new Error("no Duel panel");
    fireEvent.click(
      Array.from(duelDialog.querySelectorAll("button")).find(
        (b) => b.textContent === "Turn down",
      ) as HTMLButtonElement,
    );
    expect(wire.matchmakingCancel).toHaveBeenCalledWith({ serverKey: KEY_A });
  });
});

describe("one game at a time", () => {
  it("blocks every panel and says why while a game is already running", () => {
    wire.gameRunning = true;
    setConnections({
      [KEY_A]: connection(KEY_A, emptyState(true, "Duel")),
      [KEY_B]: connection(KEY_B, emptyState(true, "Team")),
    });
    wire.errorFor = {
      [KEY_A]:
        "A game is already running, so accepting this match would start a second one.",
      [KEY_B]:
        "A game is already running, so accepting this match would start a second one.",
    };
    render(<MatchFoundPanel />);

    expect(
      wire.launchCalls.every((c) => c.blocked?.includes("already running")),
    ).toBe(true);
    expect(screen.getAllByText(/already running/)).toHaveLength(2);
  });

  it("blocks a match while another server's battle room owns the launch, naming it", () => {
    wire.inBattleKey = KEY_B;
    setConnections({
      [KEY_A]: connection(KEY_A, emptyState(true, "Duel")),
      [KEY_B]: connection(KEY_B, emptyState(false)),
    });
    wire.errorFor = {
      [KEY_A]:
        "Server B owns the current battle room, so accepting this match would start a second game.",
    };
    render(<MatchFoundPanel />);

    const call = wire.launchCalls.find((c) => c.serverKey === KEY_A);
    expect(call?.blocked).toBe(
      "Server B owns the current battle room, so accepting this match would start a second game.",
    );
    expect(
      screen.getByText(/Server B owns the current battle room/),
    ).toBeTruthy();
  });

  it("does not block when nothing is running and no lobby is joined", () => {
    setConnections({ [KEY_A]: connection(KEY_A, emptyState(true, "Duel")) });
    render(<MatchFoundPanel />);
    expect(wire.launchCalls[0]?.blocked).toBeNull();
  });
});

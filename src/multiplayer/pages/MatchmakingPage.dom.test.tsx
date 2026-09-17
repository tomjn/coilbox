// @vitest-environment happy-dom

/**
 * The Matchmaking page with more than one connected Tachyon server (issue
 * #2845). Each connection queues independently, under a heading naming it,
 * the same pattern the Battles page uses for hosting (issue #2844). With one
 * Tachyon connection the page reads exactly as it did before servers were
 * told apart.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LobbyState, MatchQueue } from "../bindings";

vi.mock("@picoframe/frame", () => ({
  Button: ({
    children,
    ...props
  }: { children?: ReactNode } & Record<string, unknown>) => (
    <button type="button" {...props}>
      {children}
    </button>
  ),
  NavGate: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock("@/components/ui/badge", () => ({
  Badge: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
}));

vi.mock("@/components/ui/card", () => ({
  Card: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  CardHeader: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  CardTitle: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  CardDescription: ({ children }: { children?: ReactNode }) => (
    <div>{children}</div>
  ),
  CardContent: ({ children }: { children?: ReactNode }) => (
    <div>{children}</div>
  ),
}));

const wire = vi.hoisted(() => ({
  calls: [] as string[],
}));

vi.mock("../bindings", () => ({
  mpMatchmakingList: async () => ({ sent: true }),
  mpMatchmakingQueue: async (args: { serverKey: string; queueId: string }) => {
    wire.calls.push(`queue ${args.serverKey} ${args.queueId}`);
    return { sent: true };
  },
  mpMatchmakingCancel: async (args: { serverKey: string }) => {
    wire.calls.push(`cancel ${args.serverKey}`);
    return { sent: true };
  },
}));

const KEY_A = "AF@tachyon-a.example:443";
const KEY_B = "Zeta@tachyon-b.example:443";

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

function queue(id: string, name: string): MatchQueue {
  return {
    id,
    name,
    teams: 2,
    teamSize: 1,
    ranked: true,
    maps: ["Map"],
    games: ["Game"],
    engines: ["1.0"],
  };
}

function stateWith(queues: MatchQueue[], searching: string[] = []): LobbyState {
  return {
    myUsername: "AF",
    matchmaking: { supported: true, queues, searching, found: null },
    party: null,
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

vi.mock("../store", () => ({
  useMultiplayer: () => ({
    connections: wireConnections.connections,
    activeKey: wireConnections.activeKey,
    openLoginPopover: () => {},
  }),
  useConnection: (serverKey: string | null) =>
    serverKey ? (wireConnections.connections[serverKey] ?? null) : null,
  useProtocolServers: () => servers,
  serverNameFor: (key: string, list: typeof servers) =>
    list.find((s) => key.endsWith(`@${s.host}:${s.port}`))?.name ?? key,
  usernameFromKey: (key: string) => key.split("@")[0],
  initialMirror: { state: null, battleStartSeq: 0 },
}));

import MatchmakingRoute from "./MatchmakingPage";

function setConnections(
  entries: Record<string, ReturnType<typeof connection>>,
) {
  wireConnections.connections = entries;
}

afterEach(() => {
  cleanup();
  wire.calls.length = 0;
  wireConnections.activeKey = null;
});

describe("with no Tachyon connection", () => {
  it("says so and offers to connect", () => {
    setConnections({});
    render(<MatchmakingRoute />);
    expect(
      screen.getByText("You are not connected to a lobby server."),
    ).toBeTruthy();
  });
});

describe("with a single Tachyon connection", () => {
  it("shows one page with no server heading, as before servers were told apart", () => {
    setConnections({
      [KEY_A]: connection(KEY_A, stateWith([queue("1v1", "Duel")])),
    });
    render(<MatchmakingRoute />);
    expect(screen.queryAllByRole("heading", { level: 2 })).toEqual([]);
    expect(screen.getByText("Duel")).toBeTruthy();
  });

  it("queues on that connection", () => {
    setConnections({
      [KEY_A]: connection(KEY_A, stateWith([queue("1v1", "Duel")])),
    });
    render(<MatchmakingRoute />);
    fireEvent.click(screen.getByRole("button", { name: /Search/ }));
    expect(wire.calls).toEqual([`queue ${KEY_A} 1v1`]);
  });
});

describe("with two Tachyon connections", () => {
  it("lists both under a heading naming their server", () => {
    setConnections({
      [KEY_A]: connection(KEY_A, stateWith([queue("1v1", "Duel A")])),
      [KEY_B]: connection(KEY_B, stateWith([queue("2v2", "Team B")])),
    });
    render(<MatchmakingRoute />);
    const headings = screen
      .getAllByRole("heading", { level: 2 })
      .map((h) => h.textContent ?? "");
    expect(headings.some((h) => h.startsWith("AF on "))).toBe(true);
    expect(headings.some((h) => h.startsWith("Zeta on "))).toBe(true);
    expect(screen.getByText("Duel A")).toBeTruthy();
    expect(screen.getByText("Team B")).toBeTruthy();
  });

  it("queues on whichever connection's Search is pressed", () => {
    setConnections({
      [KEY_A]: connection(KEY_A, stateWith([queue("1v1", "Duel A")])),
      [KEY_B]: connection(KEY_B, stateWith([queue("2v2", "Team B")])),
    });
    render(<MatchmakingRoute />);
    const buttons = screen.getAllByRole("button", { name: /Search/ });
    fireEvent.click(buttons[1]);
    expect(wire.calls).toEqual([`queue ${KEY_B} 2v2`]);
  });

  it("only shows searching on the connection that is searching", () => {
    setConnections({
      [KEY_A]: connection(KEY_A, stateWith([queue("1v1", "Duel A")], ["1v1"])),
      [KEY_B]: connection(KEY_B, stateWith([queue("2v2", "Team B")])),
    });
    render(<MatchmakingRoute />);
    expect(screen.getByText(/Searching in Duel A/)).toBeTruthy();
    expect(screen.getByText("Team B")).toBeTruthy();
    expect(
      screen.getAllByRole("button", { name: "Stop searching" }),
    ).toHaveLength(1);
  });
});

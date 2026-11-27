// @vitest-environment happy-dom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HubAccount } from "@/hub/account";
import type { ArchiveUploadState } from "@/hub/archiveUploads";
import type { ReplaysOnHub } from "@/hub/replaysOnHub";
import type {
  DemoBuildOrders,
  DemoInfo,
  DemoTrailer,
  UnitDatasetEntry,
} from "../../bindings";

const started = vi.fn();
vi.mock("@/hub/archiveUploads", () => ({
  startReplayUpload: (...args: unknown[]) => started(...args),
  listArchiveUploads: async () => [],
  onArchiveUploadChanged: async () => () => {},
}));
const begun = vi.fn(async (_gameId: string) => "grant-1");
const ended = vi.fn(async (_grant: string) => {});
vi.mock("@/hub/manualSend/grant", () => ({
  beginReplaySend: (gameId: string) => begun(gameId),
  endManualSend: (grant: string) => ended(grant),
}));
vi.mock("@/hub/manualSend/run", () => ({ noteHubChanged: () => {} }));
vi.mock("@/hub/manualSend/status", () => ({
  gamePageUrl: () => "",
  mapPageUrl: () => "",
}));
vi.mock("@/hub/maps/lookup", () => ({ fetchMapFacts: async () => ({}) }));
let held: ReplaysOnHub = {};
vi.mock("@/hub/replaysOnHub", async (actual) => ({
  ...(await actual<typeof import("@/hub/replaysOnHub")>()),
  useReplaysOnHub: () => held,
  rememberReplayOnHub: () => {},
}));
vi.mock("@/notify/notify", () => ({ notify: () => {} }));
const opened = vi.fn(async (_url: string) => {});
vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: (url: string) => opened(url),
}));
vi.mock("@/hub/config", () => ({ useHubUrl: () => "https://hub.test" }));
let account: HubAccount;
vi.mock("@/hub/account", () => ({ useHubAccount: () => account }));
let logins: { serverId: string; username: string; lastUsedAt?: number }[];
vi.mock("../../../lobby-servers/config", () => ({
  useLobbyAccounts: () => [{ accounts: logins }],
  useLastLogin: () => [null],
}));

const trailer: DemoTrailer = {
  winningAllyTeams: [0],
  teamStatPeriodSec: 15,
  teams: [],
};
vi.mock("../../useMatchStats", () => ({
  useMatchStats: (path: string | null) =>
    path
      ? { data: { trailer, metrics: [] }, loading: false, error: null }
      : { data: null, loading: false, error: null },
}));
const ORDERS: DemoBuildOrders = {
  orders: [
    {
      frame: 10,
      player: 0,
      team: 0,
      origin: { kind: "player" } as never,
      unitDefId: 1,
      count: 1,
      slot: { kind: "append" } as never,
      builders: 1,
      options: 0,
    },
  ],
  players: [],
  removals: 0,
  lastFrame: 900,
  incomplete: false,
};
vi.mock("../../useReplayBuildOrders", () => ({
  useReplayBuildOrders: () => ({
    result: ORDERS,
    status: "done",
    loading: false,
    failed: false,
    load: () => {},
  }),
}));
const UNITS: UnitDatasetEntry[] = [
  { name: "armsolar", stats: { metalCost: 155, energyCost: 0 } },
  { name: "legcom", stats: { metalCost: 2700, energyCost: 0 } },
];
let unitSource: "installed" | "differentBuild";
vi.mock("../../useReplayUnits", () => ({
  useReplayUnits: () => ({
    source: { kind: unitSource },
    status: "ready",
    described: UNITS,
    units: UNITS,
  }),
}));
let sidesStatus: "loading" | "ready" | "error";
vi.mock("../../useReplayFactions", () => ({
  useRecordedGameSides: () => ({
    sides:
      sidesStatus === "ready" ? [{ name: "Legion", startUnit: "legcom" }] : [],
    status: sidesStatus,
    scanned: true,
    scanning: false,
  }),
}));

import { forgetArchiveUploads, rememberUpload } from "@/hub/upload/store";
import { SendReplayToHub } from "./SendReplayToHub";

const GAME_ID = "9f2c4b1ad07e5386c1f4a92b6e8d0375";
const INFO: DemoInfo = {
  engineVersion: "2025.04.10",
  gameId: GAME_ID,
  startTimeMs: 1_000_000,
  durationSec: 30,
  wallclockSec: 30,
  mapName: "Tabula",
  gameType: "Game 1",
  winningAllyTeams: [0],
  winnersKnown: true,
  numAllyTeams: 2,
  allyTeams: [],
  players: [
    { name: "Alice", team: 0, allyTeam: 0, side: "Arm", spectator: false },
    { name: "Carol", spectator: true },
  ],
  ais: [],
  modOptions: {},
  mapOptions: {},
};
const PATH = "/d/demos/match.sdfz";
const PICKED: DemoInfo = {
  ...INFO,
  players: [
    { ...INFO.players[0], pick: { frame: -1, unitDefId: 2 } },
    INFO.players[1],
  ],
};

function signedIn(yes = true): HubAccount {
  return {
    loading: false,
    busy: false,
    signedIn: yes,
    unknown: false,
    account: null,
    problem: null,
    signIn: vi.fn(async () => {}),
    signOut: vi.fn(async () => {}),
    recheck: vi.fn(async () => {}),
  };
}

function state(patch: Partial<ArchiveUploadState> = {}): ArchiveUploadState {
  return {
    opId: "op-1",
    hubUrl: "https://hub.test",
    filename: "match.sdfz",
    kind: "replay",
    sha256: "c".repeat(64),
    phase: "reserving",
    sent: 0,
    size: 100,
    uploadId: null,
    pageUrl: null,
    heldAlready: false,
    outcome: null,
    ...patch,
  };
}

const subject = { kind: "replay" as const, label: "x", gameId: GAME_ID };

beforeEach(() => {
  account = signedIn();
  logins = [{ serverId: "s", username: "Alice", lastUsedAt: 1 }];
  held = {};
  started.mockReset();
  started.mockResolvedValue(state());
  begun.mockClear();
  ended.mockClear();
  opened.mockClear();
  forgetArchiveUploads();
  unitSource = "installed";
  sidesStatus = "ready";
});

afterEach(() => cleanup());

describe("send to hub on a replay's page", () => {
  it("is offered for a replay the user played in", () => {
    render(<SendReplayToHub info={INFO} replayPath={PATH} />);
    expect(screen.getByRole("button", { name: /Send to hub/ })).toBeTruthy();
  });

  it("is offered for a replay the user watched as a spectator", () => {
    logins = [{ serverId: "s", username: "carol", lastUsedAt: 1 }];
    render(<SendReplayToHub info={INFO} replayPath={PATH} />);
    expect(screen.getByRole("button", { name: /Send to hub/ })).toBeTruthy();
  });

  it("is not offered for a battle the user was not in", () => {
    logins = [{ serverId: "s", username: "Dave", lastUsedAt: 1 }];
    const { container } = render(
      <SendReplayToHub info={INFO} replayPath={PATH} />,
    );
    expect(container.innerHTML).toBe("");
  });

  it("is not offered to somebody signed out of the hub", () => {
    account = signedIn(false);
    const { container } = render(
      <SendReplayToHub info={INFO} replayPath={PATH} />,
    );
    expect(container.innerHTML).toBe("");
  });

  it("asks first, then sends the summary under the user's name in the replay", async () => {
    render(<SendReplayToHub info={INFO} replayPath={PATH} />);
    fireEvent.click(screen.getByRole("button", { name: /Send to hub/ }));
    expect(await screen.findByText(/It will be public/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(started).toHaveBeenCalled());
    const [hub, path, gameId, name, summary, grant] = started.mock.calls[0];
    expect([hub, path, gameId, name, grant]).toEqual([
      "https://hub.test",
      PATH,
      GAME_ID,
      "Alice",
      "grant-1",
    ]);
    expect(summary).toMatchObject({
      v: 1,
      players: [{ name: "Alice", team: 0, ally_team: 0, faction: "Arm" }],
      spectators: ["Carol"],
      build_orders: [{ team: 0, orders: [{ frame: 10, unit_def_id: 1 }] }],
      units: [{ unit_def_id: 1, name: "armsolar", metal: 155 }],
    });
    expect(begun).toHaveBeenCalledWith(GAME_ID);
    await waitFor(() => expect(ended).toHaveBeenCalledWith("grant-1"));
  });

  it("sends the faction picked in the match", async () => {
    render(<SendReplayToHub info={PICKED} replayPath={PATH} />);
    fireEvent.click(screen.getByRole("button", { name: /Send to hub/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Send" }));
    await waitFor(() => expect(started).toHaveBeenCalled());
    expect(started.mock.calls[0][4]).toMatchObject({
      players: [{ name: "Alice", faction: "Legion" }],
      units: [{ unit_def_id: 1 }, { unit_def_id: 2, name: "legcom" }],
    });
  });

  it("waits for the game's factions before it offers to send a pick", async () => {
    sidesStatus = "loading";
    render(<SendReplayToHub info={PICKED} replayPath={PATH} />);
    fireEvent.click(screen.getByRole("button", { name: /Send to hub/ }));
    expect(await screen.findByText(/Reading the replay/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Send" })).toBeNull();
  });

  it("says so when the game's factions cannot be read", async () => {
    sidesStatus = "error";
    render(<SendReplayToHub info={PICKED} replayPath={PATH} />);
    fireEvent.click(screen.getByRole("button", { name: /Send to hub/ }));
    expect(
      await screen.findByText(/could not read the game's factions/),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Send" })).toBeNull();
  });

  it("asks for the recorded version to name a picked unit", async () => {
    unitSource = "differentBuild";
    render(<SendReplayToHub info={PICKED} replayPath={PATH} />);
    fireEvent.click(screen.getByRole("button", { name: /Send to hub/ }));
    expect(await screen.findByText(/Another version of the game/)).toBeTruthy();
  });

  it("walks through sending, the hub's check and the link", async () => {
    render(<SendReplayToHub info={INFO} replayPath={PATH} />);
    act(() => rememberUpload(state({ phase: "sending" }), subject));
    expect(screen.getByRole("button", { name: /Sending to hub/ })).toBeTruthy();
    act(() => rememberUpload(state({ phase: "waiting" }), subject));
    expect(
      screen.getByRole("button", { name: /The hub is checking it/ }),
    ).toBeTruthy();
    act(() =>
      rememberUpload(
        state({
          phase: "done",
          pageUrl: "https://hub.test/replays/x",
          outcome: { kind: "listed" },
        }),
        subject,
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: /On the hub/ }));
    expect(opened).toHaveBeenCalledWith("https://hub.test/replays/x");
  });

  it("links a replay already known to be on the hub without reading it", () => {
    held = {
      [GAME_ID]: { hubUrl: "https://hub.test/", url: "https://hub.test/r" },
    };
    render(<SendReplayToHub info={INFO} replayPath={PATH} />);
    fireEvent.click(screen.getByRole("button", { name: /On the hub/ }));
    expect(opened).toHaveBeenCalledWith("https://hub.test/r");
  });

  it("shows the hub's reason for a refusal", async () => {
    render(<SendReplayToHub info={INFO} replayPath={PATH} />);
    act(() =>
      rememberUpload(
        state({
          phase: "done",
          outcome: {
            kind: "stopped",
            source: "hub",
            code: "bad_request",
            status: 400,
            said: "summary.players must be a list with at least one player.",
          },
        }),
        subject,
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: /Not sent/ }));
    expect(
      await screen.findByText(/must be a list with at least one player/),
    ).toBeTruthy();
  });
});

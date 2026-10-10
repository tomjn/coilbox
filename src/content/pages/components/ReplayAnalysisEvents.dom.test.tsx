// @vitest-environment happy-dom

/**
 * The event viewer under the analysis section (#1179): closed until asked, one
 * read when opened, filters, paging, the states, and the download.
 */

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  DemoInfo,
  GameItem,
  StoredReplayAnalysis,
  UnitDatasetEntry,
} from "../../bindings";

const read = vi.fn();
const write = vi.fn();
const save = vi.fn();
const notify = vi.fn(async () => {});
let GAMES: GameItem[] = [];
let DATASET: { units: UnitDatasetEntry[] } | null = null;

vi.mock("@tauri-apps/plugin-dialog", () => ({
  save: (...args: unknown[]) => save(...args),
}));
vi.mock("@/notify/notify", () => ({
  notify: (...args: unknown[]) => notify(...(args as [])),
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: async () => () => {} }));
vi.mock("../../bindings", async (original) => ({
  ...(await original<typeof import("../../bindings")>()),
  contentReplayAnalysisEvents: (a: unknown) => read(a),
  contentWriteFile: (a: unknown) => write(a),
}));
vi.mock("../../config", () => ({
  useScanTargetSelection: () => ({
    selected: { enginePath: "/engine", rootPath: "/data" },
  }),
  useUnitsyncScan: () => ({ data: { games: GAMES }, loading: false }),
  useUnitsyncUnitDataset: (_e: string, _d: string, archive?: string) =>
    archive && DATASET
      ? { dataset: DATASET, status: "ready" }
      : { dataset: null, status: archive ? "error" : "idle" },
  useUnitsyncUnitBuildpics: () => ({ units: {}, errors: [] }),
}));

const { ReplayAnalysisEvents } = await import("./ReplayAnalysisEvents");
const { resetReplayAnalysisForTests, seedReplayAnalysisForTests } =
  await import("../../replayAnalysis");

const stored = (
  over: Partial<StoredReplayAnalysis> = {},
): StoredReplayAnalysis =>
  ({
    state: "current",
    sizeBytes: 10,
    kind: "analysis",
    gameId: "game-a",
    analysedAtMs: 1,
    map: "Greenhaven",
    counts: {
      header: 0,
      gameStart: 1,
      unitCreated: 2,
      unitFinished: 0,
      unitDestroyed: 1,
      gameOver: 0,
      unknown: 0,
    },
    disagreements: [],
    ...over,
  }) as StoredReplayAnalysis;

const info = (over: Partial<DemoInfo> = {}) =>
  ({
    gameId: "game-a",
    gameType: "Splinter 1",
    mapName: "Greenhaven",
    startTimeMs: Date.UTC(2026, 9, 10),
    remixed: false,
    players: [
      { name: "Alice", team: 0, spectator: false },
      { name: "Bob", team: 1, spectator: false },
    ],
    ais: [],
    ...over,
  }) as unknown as DemoInfo;

const EVENTS = [
  { kind: "game_start", frame: 0 },
  {
    kind: "unit_created",
    frame: 60,
    unit: 1,
    def: 2,
    team: 0,
    x: 1,
    y: 2,
    z: 3,
  },
  {
    kind: "unit_created",
    frame: 90,
    unit: 2,
    def: 3,
    team: 1,
    x: 4,
    y: 5,
    z: 6,
  },
  {
    kind: "unit_destroyed",
    frame: 120,
    unit: 2,
    def: 3,
    team: 9,
    x: 4,
    y: 5,
    z: 6,
    attackerTeam: 0,
  },
  { kind: "projectile", frame: 121, speed: 7.5 },
];

const UNITS: UnitDatasetEntry[] = [
  { name: "alpha", fullName: "Alpha Tank" },
  { name: "beta", fullName: "Beta Bot" },
];

const A = "/replays/a.sdfz";
const B = "/replays/b.sdfz";

beforeEach(() => {
  read.mockReset();
  read.mockResolvedValue({ events: EVENTS, total: EVENTS.length });
  write.mockReset();
  save.mockReset();
  notify.mockClear();
  GAMES = [];
  DATASET = null;
  seedReplayAnalysisForTests({ analyses: [stored()] });
});

afterEach(() => {
  cleanup();
  resetReplayAnalysisForTests();
});

const trigger = () => screen.getByRole("button", { name: /recorded events/i });
const open = async () => {
  fireEvent.click(trigger());
  await screen.findByRole("table");
};
const bodyRows = () => screen.getAllByRole("row").slice(1);

describe("ReplayAnalysisEvents", () => {
  it("is closed by default and reads nothing", () => {
    render(<ReplayAnalysisEvents replayPath={A} info={info()} />);
    expect(screen.queryByRole("table")).toBeNull();
    expect(read).not.toHaveBeenCalled();
    expect(trigger().textContent).toContain("4 events");
  });

  it("reads the events once when opened, and lists them", async () => {
    render(<ReplayAnalysisEvents replayPath={A} info={info()} />);
    await open();
    expect(read).toHaveBeenCalledTimes(1);
    expect(read).toHaveBeenCalledWith({ gameId: "game-a" });
    expect(bodyRows()).toHaveLength(5);
    expect(
      screen.getByText(/events from playing the match back, not orders/i),
    ).toBeTruthy();
  });

  it("shows a kind the build has no name for, with its fields", async () => {
    render(<ReplayAnalysisEvents replayPath={A} info={info()} />);
    await open();
    const row = bodyRows()[4];
    expect(within(row).getByText("Projectile")).toBeTruthy();
    expect(within(row).getByText(/speed 7\.5/)).toBeTruthy();
  });

  it("names players, with neutral for a team nobody controls", async () => {
    render(<ReplayAnalysisEvents replayPath={A} info={info()} />);
    await open();
    const rows = bodyRows();
    expect(within(rows[1]).getByText("Alice")).toBeTruthy();
    expect(within(rows[2]).getByText("Bob")).toBeTruthy();
    expect(within(rows[3]).getByText("Neutral")).toBeTruthy();
    expect(within(rows[3]).getByText(/attacker Alice/)).toBeTruthy();
  });

  it("names units from the installed game", async () => {
    GAMES = [
      {
        name: "Splinter 1",
        primaryArchive: { name: "splinter.sdz" },
        dependencyArchives: [],
        info: {},
      } as GameItem,
    ];
    DATASET = { units: UNITS };
    render(<ReplayAnalysisEvents replayPath={A} info={info()} />);
    await open();
    expect(within(bodyRows()[1]).getByText("Beta Bot")).toBeTruthy();
  });

  it("shows the id when the game is not installed", async () => {
    render(<ReplayAnalysisEvents replayPath={A} info={info()} />);
    await open();
    expect(within(bodyRows()[1]).getByText("Unit 2")).toBeTruthy();
    expect(screen.getByText(/is not installed/i)).toBeTruthy();
  });

  it("warns when names come from a different build", async () => {
    GAMES = [
      {
        name: "Splinter 2",
        primaryArchive: { name: "splinter2.sdz" },
        dependencyArchives: [],
        info: {},
      } as GameItem,
    ];
    DATASET = { units: UNITS };
    render(<ReplayAnalysisEvents replayPath={A} info={info()} />);
    await open();
    expect(screen.getByText(/different build/i)).toBeTruthy();
  });

  it("narrows the rows by kind", async () => {
    render(<ReplayAnalysisEvents replayPath={A} info={info()} />);
    await open();
    fireEvent.keyDown(screen.getByRole("combobox", { name: "Kind of event" }), {
      key: "ArrowDown",
    });
    fireEvent.click(
      await screen.findByRole("option", { name: "Unit created" }),
    );
    await waitFor(() => expect(bodyRows()).toHaveLength(2));
    expect(screen.getByText("2 of 5 events match.")).toBeTruthy();
    // Every kind the data holds is offered, including the unknown one.
    fireEvent.keyDown(screen.getByRole("combobox", { name: "Kind of event" }), {
      key: "ArrowDown",
    });
    expect(
      await screen.findByRole("option", { name: "Projectile" }),
    ).toBeTruthy();
  });

  it("narrows the rows by player, with the units they destroyed", async () => {
    render(<ReplayAnalysisEvents replayPath={A} info={info()} />);
    await open();
    fireEvent.keyDown(screen.getByRole("combobox", { name: "Player" }), {
      key: "ArrowDown",
    });
    fireEvent.click(await screen.findByRole("option", { name: "Alice" }));
    await waitFor(() => expect(bodyRows()).toHaveLength(2));
  });

  it("pages the rows", async () => {
    const many = Array.from({ length: 230 }, (_, i) => ({
      kind: "unit_created",
      frame: i,
      team: 0,
    }));
    read.mockResolvedValue({ events: many, total: many.length });
    render(<ReplayAnalysisEvents replayPath={A} info={info()} />);
    await open();
    expect(bodyRows()).toHaveLength(100);
    fireEvent.click(
      screen.getByRole("button", { name: /show 100 more of 230/i }),
    );
    expect(bodyRows()).toHaveLength(200);
    fireEvent.click(
      screen.getByRole("button", { name: /show 30 more of 230/i }),
    );
    expect(bodyRows()).toHaveLength(230);
    expect(screen.queryByRole("button", { name: /show \d+ more/i })).toBeNull();
  });

  it("says when the events could not be read", async () => {
    read.mockRejectedValue(new Error("gone"));
    render(<ReplayAnalysisEvents replayPath={A} info={info()} />);
    fireEvent.click(trigger());
    expect(await screen.findByText(/could not be read/i)).toBeTruthy();
  });

  describe("states", () => {
    it("says an outdated analysis may lack newer kinds", async () => {
      seedReplayAnalysisForTests({ analyses: [stored({ state: "outdated" })] });
      render(<ReplayAnalysisEvents replayPath={A} info={info()} />);
      await open();
      expect(screen.getByText(/older logger/i)).toBeTruthy();
    });

    it("says nothing about the logger for a current one", async () => {
      render(<ReplayAnalysisEvents replayPath={A} info={info()} />);
      await open();
      expect(screen.queryByText(/older logger/i)).toBeNull();
    });

    it("is absent with no analysis", () => {
      seedReplayAnalysisForTests({ analyses: [] });
      const { container } = render(
        <ReplayAnalysisEvents replayPath={A} info={info()} />,
      );
      expect(container.textContent).toBe("");
    });

    it("is absent for a diverged run", () => {
      seedReplayAnalysisForTests({
        analyses: [stored({ state: "diverged", outcome: "diverged" })],
      });
      const { container } = render(
        <ReplayAnalysisEvents replayPath={A} info={info()} />,
      );
      expect(container.textContent).toBe("");
    });

    it("is absent for a remix, which has no analysis of its own", () => {
      const { container } = render(
        <ReplayAnalysisEvents replayPath={A} info={info({ remixed: true })} />,
      );
      expect(container.textContent).toBe("");
    });
  });

  describe("download", () => {
    const press = () =>
      fireEvent.click(screen.getByRole("button", { name: /download log/i }));

    it("does nothing when the dialog is closed", async () => {
      save.mockResolvedValue(null);
      render(<ReplayAnalysisEvents replayPath={A} info={info()} />);
      await open();
      press();
      await waitFor(() => expect(save).toHaveBeenCalled());
      expect(write).not.toHaveBeenCalled();
      expect(notify).not.toHaveBeenCalled();
    });

    it("writes the whole log, not the filtered view, and says so", async () => {
      save.mockResolvedValue("/tmp/out.jsonl");
      write.mockResolvedValue({});
      render(<ReplayAnalysisEvents replayPath={A} info={info()} />);
      await open();
      press();
      await waitFor(() => expect(write).toHaveBeenCalled());
      const call = write.mock.calls[0][0] as { dest: string; text: string };
      expect(call.dest).toBe("/tmp/out.jsonl");
      expect(call.text.split("\n")).toHaveLength(EVENTS.length + 2);
      expect(JSON.parse(call.text.split("\n")[0]).kind).toBe("analysis");
      expect(save.mock.calls[0][0].defaultPath).toBe(
        "greenhaven-2026-10-10-game-a-events.jsonl",
      );
      await waitFor(() =>
        expect(notify).toHaveBeenCalledWith(
          expect.objectContaining({ level: "success" }),
        ),
      );
    });

    it("reports a failed write", async () => {
      save.mockResolvedValue("/tmp/out.jsonl");
      write.mockRejectedValue(new Error("disk full"));
      render(<ReplayAnalysisEvents replayPath={A} info={info()} />);
      await open();
      press();
      await waitFor(() =>
        expect(notify).toHaveBeenCalledWith(
          expect.objectContaining({
            level: "error",
            title: "Download failed: disk full",
          }),
        ),
      );
    });
  });

  it("does not show one replay's events under another", async () => {
    let finishB!: (v: unknown) => void;
    seedReplayAnalysisForTests({
      analyses: [stored(), stored({ gameId: "game-b", analysedAtMs: 2 })],
    });
    const { rerender } = render(
      <ReplayAnalysisEvents replayPath={A} info={info()} />,
    );
    await open();
    expect(bodyRows()).toHaveLength(5);

    read.mockReturnValueOnce(
      new Promise((res) => {
        finishB = res;
      }),
    );
    rerender(
      <ReplayAnalysisEvents replayPath={B} info={info({ gameId: "game-b" })} />,
    );
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.getByText("Reading events…")).toBeTruthy();

    await act(async () =>
      finishB({ events: [{ kind: "game_start", frame: 0 }], total: 1 }),
    );
    expect(bodyRows()).toHaveLength(1);
  });

  it("does not let a slow answer for the first replay land on the second", async () => {
    let finishA!: (v: unknown) => void;
    seedReplayAnalysisForTests({
      analyses: [stored(), stored({ gameId: "game-b", analysedAtMs: 2 })],
    });
    read.mockReturnValueOnce(
      new Promise((res) => {
        finishA = res;
      }),
    );
    read.mockResolvedValueOnce({
      events: [{ kind: "game_start", frame: 0 }],
      total: 1,
    });
    const { rerender } = render(
      <ReplayAnalysisEvents replayPath={A} info={info()} />,
    );
    fireEvent.click(trigger());
    rerender(
      <ReplayAnalysisEvents replayPath={B} info={info({ gameId: "game-b" })} />,
    );
    await screen.findByRole("table");
    await act(async () => finishA({ events: EVENTS, total: EVENTS.length }));
    expect(bodyRows()).toHaveLength(1);
  });
});

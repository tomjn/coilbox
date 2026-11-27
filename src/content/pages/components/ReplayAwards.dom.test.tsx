// @vitest-environment happy-dom
/**
 * The awards on the replay page (#5492): nothing for a replay with no analysis,
 * and the awards of a recorded log for one that has been analysed.
 */
import { readFileSync } from "node:fs";
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  DemoInfo,
  GameItem,
  StoredReplayAnalysis,
  UnitDatasetEntry,
} from "../../bindings";

/** The log the logger's own tests record. */
const RECORDED: Record<string, unknown>[] = readFileSync(
  "lua/replay-logger/tests/fixtures/match.jsonl",
  "utf8",
)
  .trim()
  .split("\n")
  .map((line) => JSON.parse(line));

let EVENTS = RECORDED;
let GAMES: GameItem[] = [];
const eventsRead = vi.fn();

vi.mock("../../bindings", async (original) => ({
  ...(await original<typeof import("../../bindings")>()),
  contentReplayAnalysisEvents: async (args: { kinds?: string[] }) => {
    eventsRead(args);
    return {
      total: EVENTS.length,
      events: EVENTS.filter(
        (e) => !args.kinds || args.kinds.includes(e.kind as string),
      ),
    };
  },
}));
const UNITS = Array.from({ length: 60 }, (_, i) => ({
  name: `unit${i + 1}`,
  mobile: i + 1 === 31,
  buildOptions: [],
  stats:
    i + 1 === 50
      ? { metalCost: 200, extractsMetal: 1 }
      : i + 1 === 31
        ? { metalCost: 1000, weapons: [{}] }
        : { metalCost: 10 },
})) as unknown as UnitDatasetEntry[];
vi.mock("../../config", () => ({
  useScanTargetSelection: () => ({
    selected: { enginePath: "/engine", rootPath: "/data" },
  }),
  useUnitsyncScan: () => ({ data: { games: GAMES }, loading: false }),
  useUnitsyncUnitDataset: (_e: string, _d: string, archive?: string) =>
    archive
      ? { dataset: { units: UNITS }, status: "ready" }
      : { dataset: null, status: "idle" },
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: async () => () => {} }));

const { ReplayAwards } = await import("./ReplayAwards");
const { resetReplayEventReadsForTests } = await import("../../replayEventRead");
const { resetReplayAnalysisForTests, seedReplayAnalysisForTests } =
  await import("../../replayAnalysis");

const INFO = {
  gameId: "game-a",
  gameType: "Test Game 1.0",
  remixed: false,
  durationSec: 50,
  players: [
    { name: "Alice", team: 0, allyTeam: 0, spectator: false },
    { name: "Carol", spectator: true },
  ],
  ais: [{ name: "AI 1", shortName: "Bot", team: 1, allyTeam: 1 }],
  allyTeams: [],
} as unknown as DemoInfo;

const game: GameItem = {
  name: "Test Game 1.0",
  primaryArchive: { name: "test.sdz" },
  dependencyArchives: [],
  info: {},
};

const analysed = (over: Partial<StoredReplayAnalysis> = {}) =>
  seedReplayAnalysisForTests({
    analyses: [
      {
        state: "current",
        sizeBytes: 10,
        kind: "analysis",
        gameId: "game-a",
        analysedAtMs: 5,
        loggerVersion: 5,
        map: "Test Map",
        counts: {},
        disagreements: [],
        ...over,
      } as StoredReplayAnalysis,
    ],
  });

const rows = () =>
  [...document.querySelectorAll("[data-award]")].map((row) => [
    row.querySelector("dt")?.textContent,
    ...[...row.querySelectorAll("dd")].map((dd) =>
      [...dd.children].map((c) => c.textContent).join(" | "),
    ),
  ]);

afterEach(() => {
  cleanup();
  resetReplayEventReadsForTests();
  resetReplayAnalysisForTests();
  eventsRead.mockClear();
  EVENTS = RECORDED;
  GAMES = [];
});

describe("the awards section", () => {
  it("is not there for a replay with no analysis", () => {
    const { container } = render(<ReplayAwards info={INFO} />);
    expect(container.innerHTML).toBe("");
    expect(eventsRead).not.toHaveBeenCalled();
  });

  it("is not there when the playback diverged, or for a remix", () => {
    analysed({ state: "diverged" });
    expect(render(<ReplayAwards info={INFO} />).container.innerHTML).toBe("");
    cleanup();
    analysed();
    expect(
      render(<ReplayAwards info={{ ...INFO, remixed: true }} />).container
        .innerHTML,
    ).toBe("");
  });

  it("names who won each award of a recorded log, and by how much", async () => {
    analysed();
    GAMES = [game];
    render(<ReplayAwards info={INFO} />);
    await waitFor(() => expect(rows()).toHaveLength(6));
    expect(rows()).toEqual([
      ["Most enemy economy destroyed", "1 | Alice | 200 metal"],
      ["Most enemy fighting units destroyed", "1 | Alice | 1,000 metal"],
      [
        "Most efficient",
        "1 | Alice | 0.97 metal destroyed for each metal spent",
      ],
      ["Most metal produced", "1 | Alice | 1,500 metal"],
      ["Most damage taken", "1 | Bot | 4,100 damage"],
      ["Longest time without a kill", "1 | Bot | 0:50"],
    ]);
    within(screen.getByRole("region", { name: "Awards" })).getByRole("button", {
      name: "About awards",
    });
  });

  it("says why the cost awards are missing when the game is not installed", async () => {
    analysed();
    render(<ReplayAwards info={INFO} />);
    await screen.findByText(
      "Test Game 1.0 is not installed, so nothing says what a unit costs. The awards that need a cost are left out.",
    );
    expect(rows().map((r) => r[0])).toEqual([
      "Most metal produced",
      "Most damage taken",
      "Longest time without a kill",
    ]);
  });

  it("is not there when the log earns nobody anything", async () => {
    analysed();
    EVENTS = [];
    const { container } = render(<ReplayAwards info={INFO} />);
    await waitFor(() => expect(container.innerHTML).toBe(""));
  });

  it("says when the events cannot be read", async () => {
    analysed();
    eventsRead.mockImplementationOnce(() => {
      throw new Error("gone");
    });
    render(<ReplayAwards info={INFO} />);
    await screen.findByText(
      "The events could not be read from this replay's analysis.",
    );
  });
});

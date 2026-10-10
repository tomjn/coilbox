// @vitest-environment happy-dom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  ReplayUnitOrders,
  StatRecord,
  UnitDatasetEntry,
} from "../../bindings";
import type { PlayerGame } from "../../stats";
import { foldUnitUsage, type ReplayLists } from "../../unitUsage";

vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));
vi.mock("@picoframe/frame", async () => ({
  ...(await vi.importActual<Record<string, unknown>>("@picoframe/frame")),
  useTheme: () => ({ resolved: "dark" }),
}));

/** What the hook answers. The section is given the real fold of it. */
let REPLAYS: ReplayUnitOrders[] = [];
let LISTS: (r: ReplayUnitOrders) => ReplayLists = () => ({
  stream: { kind: "none" },
  events: null,
});
let READING = false;
let ERROR: string | null = null;

vi.mock("../../useUnitUsage", () => ({
  useUnitUsage: (games: PlayerGame[], name: string) => ({
    usage: foldUnitUsage(
      games,
      name,
      new Map(REPLAYS.map((r) => [r.path, r])),
      new Set(),
      LISTS,
    ),
    reading: READING,
    error: ERROR,
  }),
}));

const { PlayerUnitUsage } = await import("./PlayerUnitUsage");

afterEach(() => {
  cleanup();
  REPLAYS = [];
  READING = false;
  ERROR = null;
});

const unit = (
  name: string,
  mobile: boolean,
  stats: Record<string, unknown>,
): UnitDatasetEntry =>
  ({
    name,
    fullName: name[0].toUpperCase() + name.slice(1),
    mobile,
    buildOptions: [],
    stats,
  }) as UnitDatasetEntry;

/** Ids: 1 mex, 2 tank. */
const UNITS = [
  unit("mex", false, { metalCost: 50, extractsMetal: 1 }),
  unit("tank", true, { metalCost: 100, weapons: [{}] }),
];

function record(path: string, startTimeMs: number, won?: boolean): StatRecord {
  return {
    filename: path,
    path,
    startTimeMs,
    remixed: false,
    winnersKnown: won !== undefined,
    players: [{ name: "Ann", team: 0, spectator: false, won }],
  } as unknown as StatRecord;
}

function replay(
  path: string,
  mexes: number,
  tanks: number,
  over: Partial<ReplayUnitOrders> = {},
): ReplayUnitOrders {
  return {
    path,
    gameId: path,
    remixed: false,
    gameType: "Game 1.0",
    lastFrame: 9000,
    incomplete: false,
    removals: 0,
    seats: [
      {
        player: 0,
        name: "Ann",
        defs: [
          { def: 1, placed: mexes, queued: 0, units: mexes },
          { def: 2, placed: 0, queued: 1, units: tanks },
        ],
      },
    ],
    fromCache: true,
    ...over,
  };
}

const NAMED: ReplayLists = {
  stream: { kind: "named", units: UNITS, engine: false },
  events: null,
};

function show(records: StatRecord[]) {
  render(
    <PlayerUnitUsage
      records={records}
      playerName="Ann"
      refightFilenames={new Set()}
    />,
  );
}

/** The table's body rows as the text of each cell. */
const body = () =>
  screen
    .getAllByRole("row")
    .slice(1)
    .map((r) => [...r.querySelectorAll("th,td")].map((c) => c.textContent));

describe("PlayerUnitUsage", () => {
  it("lists the units by metal, with games and wins as counts", () => {
    REPLAYS = [replay("a", 2, 5), replay("b", 1, 1), replay("c", 1, 0)];
    LISTS = () => NAMED;
    show([record("a", 1, true), record("b", 2, false), record("c", 3)]);

    expect(screen.getByText("From 3 of 3 games.")).toBeTruthy();
    expect(body()).toEqual([
      ["Tank", "Offence", "3", "6", "600", "1 of 2", "", ""],
      ["Mex", "Economy", "3", "4", "200", "1 of 2", "", ""],
    ]);
    // Counts with their sample, and no rate.
    expect(document.body.textContent).not.toContain("%");
  });

  it("sorts by a column when its header is pressed", () => {
    REPLAYS = [replay("a", 2, 5)];
    LISTS = () => NAMED;
    show([record("a", 1, true)]);
    const names = () => body().map((cells) => cells[0]);
    expect(names()).toEqual(["Tank", "Mex"]);
    fireEvent.click(screen.getByRole("button", { name: "Unit" }));
    expect(names()).toEqual(["Mex", "Tank"]);
    expect(
      screen
        .getByRole("columnheader", { name: "Unit" })
        .getAttribute("aria-sort"),
    ).toBe("ascending");
  });

  it("shows the metal by kind of unit", () => {
    REPLAYS = [replay("a", 2, 5)];
    LISTS = () => NAMED;
    show([record("a", 1, true)]);
    const split = within(screen.getByTestId("unit-usage-split"));
    expect(split.getByText("Economy")).toBeTruthy();
    expect(split.getByText("100 metal")).toBeTruthy();
    expect(split.getByText("Offence")).toBeTruthy();
    expect(split.getByText("500 metal")).toBeTruthy();
    expect(split.queryByText("Defence")).toBeNull();
  });

  it("says how many games are left out, and why in the help", () => {
    REPLAYS = [replay("a", 2, 5), replay("b", 1, 1)];
    LISTS = (r) =>
      r.path === "a" ? NAMED : { stream: { kind: "none" }, events: null };
    show([record("a", 1, true), record("b", 2, true)]);

    expect(screen.getByText("From 1 of 2 games. 1 left out.")).toBeTruthy();
    expect(screen.queryByText(/that build is not installed/)).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: "About units ordered" }),
    );
    const help = within(screen.getByRole("dialog"));
    expect(
      help.getByText(
        "1 game left out with 2 orders: no unit list is kept and that build is not installed.",
      ),
    ).toBeTruthy();
    expect(help.getByText(/not a sign that the unit caused it/)).toBeTruthy();
  });

  it("fills finished and died only for a unit an analysed game covers", () => {
    REPLAYS = [
      replay("a", 2, 5, {
        events: [{ team: 0, defs: [{ def: 2, finished: 4, died: 3 }] }],
      }),
      replay("b", 1, 0),
    ];
    LISTS = (r) => ({ ...NAMED, events: r.path === "a" ? UNITS : null });
    show([record("a", 1, true), record("b", 2, true)]);

    expect(
      screen.getByText(
        "From 2 of 2 games. Finished and died from 1 game analysed.",
      ),
    ).toBeTruthy();
    const [tank, mex] = body();
    expect(tank.slice(6)).toEqual(["45 ordered in 1 game", "3"]);
    // Ordered in the analysed game and never finished: nought, not blank.
    expect(mex.slice(6)).toEqual(["02 ordered in 1 game", "0"]);
  });

  it("says it is reading, and says when the read failed", () => {
    READING = true;
    show([record("a", 1, true)]);
    expect(screen.getByText("Reading 1 game.")).toBeTruthy();
    cleanup();
    READING = false;
    ERROR = "no such command";
    show([record("a", 1, true)]);
    expect(
      screen.getByText("The replays could not be read: no such command"),
    ).toBeTruthy();
  });

  it("says so when there are no build orders", () => {
    REPLAYS = [replay("a", 0, 0, { seats: [] })];
    LISTS = () => NAMED;
    show([record("a", 1, true)]);
    expect(screen.getByText("No build orders to show.")).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
  });
});

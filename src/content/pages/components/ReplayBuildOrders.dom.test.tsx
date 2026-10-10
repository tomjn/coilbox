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
  BuildOrder,
  DemoBuildOrders,
  DemoInfo,
  GameItem,
  UnitDatasetEntry,
} from "../../bindings";

let RESULT: DemoBuildOrders | Error;
let GAMES: GameItem[] = [];
let DATASET: { units: UnitDatasetEntry[] } | null = null;
/** The archives the section asked unitsync to read units from. */
let ASKED: (string | undefined)[] = [];

vi.mock("../../bindings", async (original) => ({
  ...(await original<typeof import("../../bindings")>()),
  contentDemoBuildOrders: async () => {
    if (RESULT instanceof Error) throw RESULT;
    return RESULT;
  },
}));
vi.mock("../../config", () => ({
  useScanTargetSelection: () => ({
    selected: { enginePath: "/engine", rootPath: "/data" },
  }),
  useUnitsyncScan: () => ({ data: { games: GAMES }, loading: false }),
  useUnitsyncUnitDataset: (_e: string, _d: string, archive?: string) => {
    ASKED.push(archive);
    return archive && DATASET
      ? { dataset: DATASET, status: "ready" }
      : { dataset: null, status: archive ? "error" : "idle" };
  },
  useUnitsyncUnitBuildpics: () => ({ units: {}, errors: [] }),
}));

const { ReplayBuildOrders } = await import("./ReplayBuildOrders");
const { resetReplayBuildOrders } = await import("../../useReplayBuildOrders");
const { SeriesEmphasisProvider } = await import("../../useSeriesEmphasis");
const { REPLAY_SOURCE_NOTES } = await import("../../replaySources");

const game = (name: string, archive: string): GameItem => ({
  name,
  primaryArchive: { name: archive },
  dependencyArchives: [],
  info: {},
});

const order = (over: Partial<BuildOrder>): BuildOrder => ({
  frame: 0,
  player: 0,
  team: 0,
  origin: { kind: "selection" },
  unitDefId: 1,
  count: 1,
  slot: { kind: "append" },
  builders: 1,
  options: 0,
  ...over,
});

const orders = (list: BuildOrder[], over: Partial<DemoBuildOrders> = {}) => ({
  orders: list,
  players: [{ player: 0, name: "Alice" }],
  removals: 0,
  lastFrame: 9000,
  incomplete: false,
  ...over,
});

const UNITS: UnitDatasetEntry[] = [
  { name: "condenser", fullName: "Geothermal Condenser" },
  { name: "f1landfac", fullName: "Land Factory" },
  { name: "fedengineer" },
];

const info = (gameType: string) =>
  ({ gameType, remixed: false, ais: [] }) as unknown as DemoInfo;

afterEach(() => {
  cleanup();
  // The read is shared across the page, so it outlives a render.
  resetReplayBuildOrders();
  GAMES = [];
  DATASET = null;
  ASKED = [];
});

/** The section's help entry, opened. What the orders are is said there. */
const help = () => {
  fireEvent.click(screen.getByRole("button", { name: "About build orders" }));
  return within(screen.getByRole("dialog"));
};

async function open(
  result: typeof RESULT,
  gameType = "SplinterFaction 0.1.88",
) {
  RESULT = result;
  render(
    <SeriesEmphasisProvider>
      <ReplayBuildOrders replayPath="/replays/a.sdfz" info={info(gameType)} />
    </SeriesEmphasisProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: /show build orders/i }));
  await screen.findAllByText(
    /Opening length in minutes|no build orders|could not be read/i,
  );
}

const opening = orders([
  order({
    frame: 30 * 34,
    unitDefId: 2,
    position: { x: 724.4, y: 10, z: 800 },
  }),
  order({ frame: 30 * 75, unitDefId: 3, count: 5, slot: { kind: "front" } }),
  order({ frame: 30 * 90, unitDefId: 9 }),
]);

describe("ReplayBuildOrders", () => {
  it("reads nothing until it is asked to", () => {
    RESULT = opening;
    render(
      <SeriesEmphasisProvider>
        <ReplayBuildOrders replayPath="/replays/a.sdfz" info={info("X 1")} />
      </SeriesEmphasisProvider>,
    );
    expect(screen.queryByText(/orders each player gave/i)).toBeNull();
    expect(ASKED.every((a) => a === undefined)).toBe(true);
  });

  it("says the section is built from recorded orders before anything is read", () => {
    RESULT = opening;
    render(
      <SeriesEmphasisProvider>
        <ReplayBuildOrders replayPath="/replays/a.sdfz" info={info("X 1")} />
      </SeriesEmphasisProvider>,
    );
    expect(screen.queryByText(REPLAY_SOURCE_NOTES.stream)).toBeNull();
    expect(help().getByText(REPLAY_SOURCE_NOTES.stream)).toBeTruthy();
  });

  it("says an empty opening length folds the whole match in the box's placeholder", async () => {
    await open(opening);
    expect(screen.queryByText(/fold the whole match/i)).toBeNull();
    expect(
      screen
        .getByRole("textbox", { name: /Opening length in minutes/i })
        .getAttribute("placeholder"),
    ).toBe("Whole match");
  });

  it("names units from the installed game the replay records", async () => {
    GAMES = [game("SplinterFaction 0.1.88", "SplinterFaction_0.1.88.sdz")];
    DATASET = { units: UNITS };
    await open(opening);

    // Says these are orders and not buildings, in the help and not the page.
    expect(screen.queryByText(/not what was built/i)).toBeNull();
    expect(help().getByText(/not what was built/i)).toBeTruthy();
    expect(
      screen.getByText(
        /unit names come from SplinterFaction 0\.1\.88, matched by name/i,
      ),
    ).toBeTruthy();
    expect(ASKED).toContain("SplinterFaction_0.1.88.sdz");

    // One player, so the list is open.
    expect(screen.getAllByText("Alice").length).toBeGreaterThan(0);
    expect(screen.getByText("3 orders")).toBeTruthy();
    const rows = screen.getAllByRole("listitem").map((li) => li.textContent);
    expect(rows[0]).toContain("0:34");
    expect(rows[0]).toContain("Land Factory");
    expect(rows[0]).toContain("724, 800");
    // No full name, so the internal one. A factory order has no position.
    expect(rows[1]).toContain("1:15");
    expect(rows[1]).toContain("fedengineer");
    expect(rows[1]).toContain("×5");
    expect(rows[1]).toContain("front of queue");
    // An id past the end of the dataset is not given a name.
    expect(rows[2]).toContain("Unit 9");
  });

  it("shows the ids and says why when the game is not installed", async () => {
    GAMES = [game("Metal Factions v2.58", "metal_factions-v2.58.sdz")];
    DATASET = { units: UNITS };
    await open(opening, "Beyond All Reason test-30018-d71d659");

    expect(
      screen.getByText(
        /Beyond All Reason test-30018-d71d659 is not installed, so the units cannot be named/i,
      ),
    ).toBeTruthy();
    const rows = screen.getAllByRole("listitem").map((li) => li.textContent);
    expect(rows[0]).toContain("Unit 2");
    expect(rows[1]).toContain("Unit 3");
    expect(screen.queryByText("Land Factory")).toBeNull();
    // Nothing was read from a game that is not the replay's.
    expect(ASKED.every((a) => a === undefined)).toBe(true);
  });

  it("names units from another version and says they may be wrong", async () => {
    GAMES = [game("SplinterFaction 0.1.88", "SplinterFaction_0.1.88.sdz")];
    DATASET = { units: UNITS };
    await open(opening, "SplinterFaction 0.1.84");

    expect(
      screen.getByText(
        /played on SplinterFaction 0\.1\.84, which is not installed\. Unit names come from SplinterFaction 0\.1\.88, a different build, and may be wrong/i,
      ),
    ).toBeTruthy();
    expect(screen.getAllByText("Land Factory").length).toBeGreaterThan(0);
  });

  it("shows the ids when the installed game's units cannot be read", async () => {
    GAMES = [game("SplinterFaction 0.1.88", "SplinterFaction_0.1.88.sdz")];
    DATASET = null;
    await open(opening);
    expect(
      screen.getByText(/units of SplinterFaction 0\.1\.88 could not be read/i),
    ).toBeTruthy();
    expect(screen.getAllByRole("listitem")[0].textContent).toContain("Unit 2");
  });

  it("says the total entries in the opening's show more button", async () => {
    // Alternating units stop the opening collapsing repeats into one entry.
    const many = Array.from({ length: 250 }, (_, i) =>
      order({ frame: i * 30, unitDefId: 1 + (i % 2) }),
    );
    await open(orders(many));
    expect(
      screen.getByRole("button", { name: "Show 100 more of 250 entries" }),
    ).toBeTruthy();
  });

  it("draws a long list a page at a time", async () => {
    const many = Array.from({ length: 250 }, (_, i) =>
      order({ frame: i * 30 }),
    );
    await open(orders(many));
    expect(screen.getAllByRole("listitem")).toHaveLength(100);
    fireEvent.click(
      screen.getByRole("button", { name: "Show 100 more of 250" }),
    );
    expect(screen.getAllByRole("listitem")).toHaveLength(200);
    fireEvent.click(
      screen.getByRole("button", { name: "Show 50 more of 250" }),
    );
    expect(screen.getAllByRole("listitem")).toHaveLength(250);
    expect(screen.queryByRole("button", { name: /more of/ })).toBeNull();
  });

  it("keeps several players' lists closed until one is opened", async () => {
    await open(
      orders([order({ player: 0 }), order({ player: 1, team: 1 })], {
        players: [
          { player: 0, name: "Alice" },
          { player: 1, name: "Bob" },
        ],
      }),
    );
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: /Bob/ }));
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
  });

  it("says how many queue removals were left out, and when the read stopped early", async () => {
    await open(orders([order({})], { removals: 3, incomplete: true }));
    expect(screen.queryByText(/off a factory queue/i)).toBeNull();
    expect(
      help().getByText(
        /3 orders that took units off a factory queue are not listed/i,
      ),
    ).toBeTruthy();
    expect(screen.getByText(/later build orders may be missing/i)).toBeTruthy();
  });

  describe("opening", () => {
    const PRICED: UnitDatasetEntry[] = [
      { name: "condenser", fullName: "Geothermal Condenser" },
      {
        name: "f1landfac",
        fullName: "Land Factory",
        stats: { metalCost: 100, energyCost: 1000 },
      },
      { name: "fedengineer", stats: { metalCost: 10, energyCost: 50 } },
    ];
    const run = orders([
      order({ frame: 30 * 10, unitDefId: 2 }),
      order({ frame: 30 * 20, unitDefId: 2 }),
      order({ frame: 30 * 30, unitDefId: 3, count: 5 }),
      order({ frame: 30 * 40, unitDefId: 3, count: 20 }),
      order({ frame: 30 * 150, unitDefId: 2 }),
    ]);
    const entries = () =>
      screen
        .getAllByText(/^(Land Factory|fedengineer)$/)
        .map((e) => e.parentElement?.textContent);

    it("folds repeats into one entry with a count and prices the orders", async () => {
      GAMES = [game("SplinterFaction 0.1.88", "SplinterFaction_0.1.88.sdz")];
      DATASET = { units: PRICED };
      await open({ ...run, removals: 7 });

      // 2 + 1 land factories, 25 engineers. The raw list repeats the names
      // but is not the first block, so read the opening's rows by their time.
      const rows = entries();
      expect(rows[0]).toContain("0:10");
      expect(rows[0]).toContain("×2");
      expect(rows[1]).toContain("0:30");
      expect(rows[1]).toContain("×25");
      expect(rows[2]).toContain("2:30");

      // 3 factories at 100 metal, 1000 energy. 25 engineers at 10 and 50.
      // Queue removals are not subtracted.
      expect(
        screen.getByText(/Ordered cost: 550 metal and 4,250 energy\./i),
      ).toBeTruthy();
    });

    it("cuts the opening at the minute the reader types", async () => {
      GAMES = [game("SplinterFaction 0.1.88", "SplinterFaction_0.1.88.sdz")];
      DATASET = { units: PRICED };
      await open(run);
      fireEvent.change(screen.getByRole("textbox"), { target: { value: "1" } });
      expect(screen.getByText(/first 1 min/i)).toBeTruthy();
      expect(
        screen.getByText(/Ordered cost: 450 metal and 3,250 energy\./i),
      ).toBeTruthy();
      fireEvent.change(screen.getByRole("textbox"), {
        target: { value: "0" },
      });
      expect(
        screen.getByText(/no orders were given in this stretch/i),
      ).toBeTruthy();
    });

    it("counts units with no cost as left out", async () => {
      GAMES = [game("SplinterFaction 0.1.88", "SplinterFaction_0.1.88.sdz")];
      DATASET = { units: PRICED };
      await open(orders([order({ unitDefId: 1, count: 2 })]));
      expect(
        screen.getByText(/2 units could not be priced and are left out/i),
      ).toBeTruthy();
    });

    it("warns that costs may be wrong on a different build", async () => {
      GAMES = [game("SplinterFaction 0.1.88", "SplinterFaction_0.1.88.sdz")];
      DATASET = { units: PRICED };
      await open(run, "SplinterFaction 0.1.84");
      // Once on the player's cost line and once above the split table.
      expect(
        screen.getAllByText(
          /costs come from a different build and may be wrong/i,
        ),
      ).toHaveLength(2);
    });

    it("splits the cost by kind of unit in a table of players", async () => {
      GAMES = [game("SplinterFaction 0.1.88", "SplinterFaction_0.1.88.sdz")];
      DATASET = {
        units: [
          { name: "condenser", stats: { metalCost: 5, energyCost: 6 } },
          {
            name: "f1landfac",
            buildOptions: ["fedengineer"],
            stats: { metalCost: 100, energyCost: 1000, builder: true },
          },
          {
            name: "fedengineer",
            stats: { metalCost: 10, energyCost: 50, energyMake: 3 },
          },
        ],
      };
      await open(
        orders(
          [
            order({ unitDefId: 2, count: 2 }),
            order({ unitDefId: 3, count: 5 }),
            order({ unitDefId: 1, player: 1, team: 1 }),
            order({ unitDefId: 99, player: 1, team: 1, count: 4 }),
          ],
          {
            players: [
              { player: 0, name: "Alice" },
              { player: 1, name: "Bob" },
            ],
          },
        ),
      );
      const table = screen.getByRole("table");
      const rows = within(table).getAllByRole("row");
      const cells = (i: number) =>
        within(rows[i])
          .getAllByRole("cell")
          .map((c) => c.textContent);
      // Economy, defence, offence, other, unclassified, not priced.
      expect(cells(1)).toEqual([
        "50 metal250 energy",
        "0 metal0 energy",
        "0 metal0 energy",
        "200 metal2,000 energy",
        "0 metal0 energy",
        "0 units",
      ]);
      expect(cells(2)).toEqual([
        "0 metal0 energy",
        "0 metal0 energy",
        "0 metal0 energy",
        "0 metal0 energy",
        "5 metal6 energy",
        "4 units",
      ]);
      expect(within(table).getByText("Unclassified")).toBeTruthy();
      expect(screen.queryByText(/not of what was built/i)).toBeNull();
      expect(
        help().getByText(
          /cost of what was ordered, not of what was built\. Other is builders/i,
        ),
      ).toBeTruthy();
    });

    it("shows the collapsed ids and no totals when the game is not installed", async () => {
      GAMES = [game("Metal Factions v2.58", "metal_factions-v2.58.sdz")];
      DATASET = { units: PRICED };
      await open(run, "Beyond All Reason test-30018-d71d659");
      expect(screen.getAllByText("Unit 2").length).toBeGreaterThan(0);
      expect(screen.getByText("×25")).toBeTruthy();
      expect(screen.queryByText(/ordered cost/i)).toBeNull();
    });
  });

  it("says so when the replay holds no build orders", async () => {
    await open(orders([]));
    expect(screen.getByText(/no build orders were recorded/i)).toBeTruthy();
  });

  it("says so when the replay cannot be read", async () => {
    await open(new Error("bad magic"));
    expect(
      screen.getByText(/build orders could not be read from this replay/i),
    ).toBeTruthy();
  });
});

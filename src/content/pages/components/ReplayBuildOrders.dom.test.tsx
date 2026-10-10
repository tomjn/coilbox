// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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
const { SeriesEmphasisProvider } = await import("../../useSeriesEmphasis");

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
  GAMES = [];
  DATASET = null;
  ASKED = [];
});

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
    /orders each player gave|no build orders|could not be read/i,
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

  it("names units from the installed game the replay records", async () => {
    GAMES = [game("SplinterFaction 0.1.88", "SplinterFaction_0.1.88.sdz")];
    DATASET = { units: UNITS };
    await open(opening);

    // Says these are orders and not buildings.
    expect(screen.getByText(/not what was built/i)).toBeTruthy();
    expect(
      screen.getByText(
        /unit names come from SplinterFaction 0\.1\.88, matched by name/i,
      ),
    ).toBeTruthy();
    expect(ASKED).toContain("SplinterFaction_0.1.88.sdz");

    // One player, so the list is open.
    expect(screen.getByText("Alice")).toBeTruthy();
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
    expect(screen.getByText("Land Factory")).toBeTruthy();
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

  it("draws a long list a page at a time", async () => {
    const many = Array.from({ length: 250 }, (_, i) =>
      order({ frame: i * 30 }),
    );
    await open(orders(many));
    expect(screen.getAllByRole("listitem")).toHaveLength(100);
    fireEvent.click(
      screen.getByRole("button", { name: "Show 100 more of 150" }),
    );
    expect(screen.getAllByRole("listitem")).toHaveLength(200);
    fireEvent.click(screen.getByRole("button", { name: "Show 50 more of 50" }));
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
    expect(
      screen.getByText(
        /3 orders that took units off a factory queue are not listed/i,
      ),
    ).toBeTruthy();
    expect(screen.getByText(/later build orders may be missing/i)).toBeTruthy();
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

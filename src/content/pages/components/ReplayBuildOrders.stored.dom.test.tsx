// @vitest-environment happy-dom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  BuildOrder,
  DemoBuildOrders,
  DemoInfo,
  GameItem,
  ReplayUnitDefSets,
  StoredUnitDef,
  UnitDatasetEntry,
  UnitDefLink,
} from "../../bindings";

/**
 * The build order section read against a unit list kept for the replay
 * (#1176), and the keeping of one. The installed games list is whatever a test
 * sets, which is how "the game has been uninstalled" is shown without
 * uninstalling anything.
 */

let ORDERS: DemoBuildOrders;
let GAMES: GameItem[] = [];
let DATASET: { units: UnitDatasetEntry[] } | null = null;
/** What the store holds, by game id. */
let KEPT: Record<string, ReplayUnitDefSets> = {};
/** Every list the section handed to the store. */
let HANDED: {
  gameId: string;
  game: string;
  archive: string;
  units: StoredUnitDef[];
}[] = [];
/** The archives the section asked unitsync to read units and pictures from. */
let ASKED: (string | undefined)[] = [];
let PICTURES: (string | undefined)[] = [];

vi.mock("../../bindings", async (original) => ({
  ...(await original<typeof import("../../bindings")>()),
  contentDemoBuildOrders: async () => ORDERS,
  contentUnitDefSet: async ({ gameId }: { gameId: string }) =>
    KEPT[gameId] ?? { links: [], stream: null, events: null, sets: {} },
  contentUnitDefSetStore: async (args: (typeof HANDED)[number]) => {
    HANDED.push(args);
    const origin = args.archive.endsWith(".sdd") ? "folder" : "archive";
    const link: UnitDefLink = {
      digest: `sha256:${"c".repeat(64)}`,
      origin,
      game: args.game,
      takenAtMs: Date.UTC(2026, 9, 10, 12),
    };
    KEPT[args.gameId] = {
      links: [link],
      stream: link,
      events: link,
      sets: { [link.digest]: args.units },
    };
    return { digest: link.digest, origin, links: [link] };
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
  useUnitsyncUnitBuildpics: (_e: string, _d: string, archive?: string) => {
    PICTURES.push(archive);
    return archive ? { units: {}, errors: [] } : null;
  },
}));

const { ReplayBuildOrders } = await import("./ReplayBuildOrders");
const { resetReplayBuildOrders } = await import("../../useReplayBuildOrders");
const { SeriesEmphasisProvider } = await import("../../useSeriesEmphasis");
const { listDate } = await import("../../replayUnitDefs");

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

/** A factory placed, and an engineer queued in it. */
const FITTING: DemoBuildOrders = {
  orders: [
    order({ frame: 900, unitDefId: 2, position: { x: 700, y: 10, z: 800 } }),
    order({ frame: 1800, unitDefId: 3, count: 5 }),
  ],
  players: [{ player: 0, name: "Alice" }],
  removals: 0,
  lastFrame: 9000,
  incomplete: false,
};

const UNITS: UnitDatasetEntry[] = [
  { name: "condenser", fullName: "Geothermal Condenser", mobile: false },
  {
    name: "f1landfac",
    fullName: "Land Factory",
    mobile: false,
    stats: { metalCost: 600, energyCost: 3000 },
  },
  {
    name: "fedengineer",
    fullName: "Engineer",
    mobile: true,
    stats: { metalCost: 100, energyCost: 500 },
  },
];

const STORED: StoredUnitDef[] = [
  { name: "condenser", humanName: "Geothermal Condenser" },
  {
    name: "f1landfac",
    humanName: "Land Factory",
    metalCost: 600,
    energyCost: 3000,
  },
  {
    name: "fedengineer",
    humanName: "Engineer",
    metalCost: 100,
    energyCost: 500,
    mobile: true,
  },
];

const TAKEN = Date.UTC(2026, 9, 10, 12);

function keep(gameId: string, link: Partial<UnitDefLink>) {
  const whole: UnitDefLink = {
    digest: `sha256:${"a".repeat(64)}`,
    origin: "archive",
    game: "SplinterFaction 0.1.84",
    takenAtMs: TAKEN,
    ...link,
  };
  KEPT[gameId] = {
    links: [whole],
    stream: whole,
    events: whole,
    sets: { [whole.digest]: STORED },
  };
}

let nextId = 0;
/** A game id no other test has used, since what the store holds for a replay
 *  is remembered for the session. */
function freshId(): string {
  nextId += 1;
  return nextId.toString(16).padStart(32, "0");
}

afterEach(() => {
  cleanup();
  resetReplayBuildOrders();
  GAMES = [];
  DATASET = null;
  KEPT = {};
  HANDED = [];
  ASKED = [];
  PICTURES = [];
});

async function open(gameType: string, gameId: string | undefined) {
  ORDERS = FITTING;
  const info = { gameType, gameId, remixed: false, ais: [] };
  render(
    <SeriesEmphasisProvider>
      <ReplayBuildOrders
        replayPath={`/replays/${gameId}.sdfz`}
        info={info as unknown as DemoInfo}
      />
    </SeriesEmphasisProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: /show build orders/i }));
  await screen.findByText(/orders each player gave/i);
}

describe("build orders read against a kept unit list", () => {
  it("names the units of a replay whose game is not installed at all", async () => {
    const id = freshId();
    keep(id, {});

    await open("SplinterFaction 0.1.84", id);

    expect((await screen.findAllByText("Land Factory")).length).toBeGreaterThan(
      0,
    );
    expect(screen.getAllByText("Engineer").length).toBeGreaterThan(0);
    expect(
      screen.getByText(
        `Unit names come from the unit list recorded when this replay was read on ${listDate({ takenAtMs: TAKEN })}, from SplinterFaction 0.1.84.`,
      ),
    ).toBeTruthy();
    expect(screen.queryByText(/is not installed/i)).toBeNull();
    expect(screen.queryByText(/may be wrong/i)).toBeNull();
    // Costs work from the list. 600 and 5 times 100, 3000 and 5 times 500.
    expect(screen.getByText(/1,100 metal and 5,500\s+energy/)).toBeTruthy();
    // Nothing was asked of unitsync, and no picture is on its way.
    expect(ASKED.every((archive) => archive === undefined)).toBe(true);
    expect(PICTURES.every((archive) => archive === undefined)).toBe(true);
    expect(HANDED).toEqual([]);
  });

  it("comes ahead of a different installed build, with no warning, and borrows its pictures", async () => {
    const id = freshId();
    keep(id, {});
    GAMES = [game("SplinterFaction 0.1.89", "SplinterFaction_0.1.89.sdz")];
    // A different build's list, which would name the wrong units.
    DATASET = { units: [{ name: "wrong", fullName: "Wrong Unit" }] };

    await open("SplinterFaction 0.1.84", id);

    expect((await screen.findAllByText("Land Factory")).length).toBeGreaterThan(
      0,
    );
    expect(screen.queryByText("Wrong Unit")).toBeNull();
    expect(screen.queryByText(/a different build/i)).toBeNull();
    expect(ASKED.every((archive) => archive === undefined)).toBe(true);
    expect(PICTURES).toContain("SplinterFaction_0.1.89.sdz");
  });

  it("says a list from a loose folder is what the folder held that day", async () => {
    const id = freshId();
    keep(id, { origin: "folder", game: "SplinterFaction $VERSION" });
    GAMES = [game("SplinterFaction $VERSION", "SplinterFaction.sdd")];
    DATASET = { units: [{ name: "today", fullName: "Whatever It Holds Now" }] };

    await open("SplinterFaction $VERSION", id);

    expect((await screen.findAllByText("Land Factory")).length).toBeGreaterThan(
      0,
    );
    expect(screen.getByText(/loose folder, which can change/i)).toBeTruthy();
    expect(screen.queryByText("Whatever It Holds Now")).toBeNull();
    expect(HANDED).toEqual([]);
  });

  it("says the engine wrote the list for an analysed replay", async () => {
    const id = freshId();
    keep(id, { origin: "engine", game: "SplinterFaction 0.1.88" });
    GAMES = [game("SplinterFaction 0.1.88", "SplinterFaction_0.1.88.sdz")];
    DATASET = { units: UNITS };

    await open("SplinterFaction 0.1.88", id);

    expect(
      await screen.findByText(
        /the unit list the engine wrote when this replay/,
      ),
    ).toBeTruthy();
    expect(ASKED.every((archive) => archive === undefined)).toBe(true);
  });
});

describe("keeping the list a replay was read against", () => {
  it("keeps the list of a game installed under the replay's exact name, once", async () => {
    const id = freshId();
    GAMES = [game("SplinterFaction 0.1.88", "SplinterFaction_0.1.88.sdz")];
    DATASET = { units: UNITS };

    await open("SplinterFaction 0.1.88", id);

    await waitFor(() => expect(HANDED).toHaveLength(1));
    expect(HANDED[0]).toEqual({
      gameId: id,
      game: "SplinterFaction 0.1.88",
      archive: "SplinterFaction_0.1.88.sdz",
      units: STORED,
    });
    // A packaged archive under the exact name is still what is read.
    expect(
      screen.getByText(
        "Unit names come from SplinterFaction 0.1.88, matched by name and version.",
      ),
    ).toBeTruthy();
    cleanup();
    resetReplayBuildOrders();

    await open("SplinterFaction 0.1.88", id);
    await screen.findAllByText("Land Factory");
    expect(HANDED).toHaveLength(1);
  });

  it("reads a loose folder's list from the store as soon as it is kept", async () => {
    const id = freshId();
    GAMES = [game("SplinterFaction $VERSION", "SplinterFaction.sdd")];
    DATASET = { units: UNITS };

    await open("SplinterFaction $VERSION", id);

    await waitFor(() => expect(HANDED).toHaveLength(1));
    expect(HANDED[0].archive).toBe("SplinterFaction.sdd");
    expect(
      await screen.findByText(/loose folder, which can change/i),
    ).toBeTruthy();
    expect(screen.getAllByText("Land Factory").length).toBeGreaterThan(0);
  });

  it("keeps nothing from a different build", async () => {
    const id = freshId();
    GAMES = [game("SplinterFaction 0.1.89", "SplinterFaction_0.1.89.sdz")];
    DATASET = { units: UNITS };

    await open("SplinterFaction 0.1.84", id);

    await screen.findByText(/a different build, and may be wrong/i);
    expect(HANDED).toEqual([]);
  });

  it("keeps nothing when the replay's own orders contradict the list, and says so", async () => {
    const id = freshId();
    GAMES = [game("SplinterFaction 0.1.88", "SplinterFaction_0.1.88.sdz")];
    // One definition fewer at the front, as when the engine refused one or a
    // mod option added one: every id now names its neighbour.
    DATASET = { units: UNITS.slice(1) };

    await open("SplinterFaction 0.1.88", id);

    expect(
      await screen.findByText(/2 of 2 build orders do not fit this unit list/),
    ).toBeTruthy();
    expect(
      screen.getByText(/1 placed order names a unit that moves/),
    ).toBeTruthy();
    expect(
      screen.getByText(/1 order names an id past the end of the list/),
    ).toBeTruthy();
    expect(HANDED).toEqual([]);
  });

  it("keeps nothing for a replay with no game id", async () => {
    GAMES = [game("SplinterFaction 0.1.88", "SplinterFaction_0.1.88.sdz")];
    DATASET = { units: UNITS };

    await open("SplinterFaction 0.1.88", undefined);

    await screen.findAllByText("Land Factory");
    expect(HANDED).toEqual([]);
    expect(screen.queryByText(/do not fit this unit list/)).toBeNull();
  });
});

// @vitest-environment happy-dom
/**
 * The replay map's layers (#1152): what each toggle draws, what it says when
 * it has nothing to draw, and that the page reads build orders once.
 *
 * Nothing is painted here. The test environment has no canvas context and no
 * WebGL, so what is asserted is the DOM: the dots and where they sit, the
 * toggles, the legend and the notes. The 3D preview is a stub that hands over
 * no scene. Where a point lands is `replayMapLayers.test.ts` and
 * `heatmapLayer.test.ts`.
 */
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
  DemoOrderPoints,
  GameItem,
  UnitDatasetEntry,
} from "../../bindings";

let HIDE: string[] = [];
let ORDERS: DemoBuildOrders | Error;
let GAMES: GameItem[] = [];
let DATASET: { units: UnitDatasetEntry[] } | null = null;
let PRIMARY = "";
let POINTS: DemoOrderPoints | Error;
const ordersRead = vi.fn();
const pointsRead = vi.fn();

vi.mock("../../../profile/profile", async (orig) => ({
  ...(await orig<typeof import("../../../profile/profile")>()),
  getProfile: () => ({ version: 1, hide: HIDE }),
}));
vi.mock("../../bindings", async (original) => ({
  ...(await original<typeof import("../../bindings")>()),
  contentDemoBuildOrders: async (args: unknown) => {
    ordersRead(args);
    if (ORDERS instanceof Error) throw ORDERS;
    return ORDERS;
  },
  contentDemoOrderPoints: async (args: unknown) => {
    pointsRead(args);
    if (POINTS instanceof Error) throw POINTS;
    return POINTS;
  },
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
vi.mock("@picoframe/frame", async (orig) => ({
  ...(await orig<typeof import("@picoframe/frame")>()),
  useTheme: () => ({ resolved: "dark" }),
}));
vi.mock("../../usePrimaryPlayer", () => ({
  usePrimaryPlayer: () => PRIMARY,
}));
vi.mock("../../useMatchStats", () => ({
  useMatchStats: () => ({ data: null, loading: false, error: null }),
}));
vi.mock("../../../mapconv/pages/components/MapPreview3D", () => ({
  MapPreview3D: () => <div data-testid="preview-3d" />,
}));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: async () => {} }));

const { ReplayMap } = await import("./ReplayMap");
const { ReplayBuildOrders } = await import("./ReplayBuildOrders");
const { resetReplayBuildOrders } = await import("../../useReplayBuildOrders");
const { resetReplayOrderPoints } = await import("../../replayOrderPoints");
const { packOrders } = await import("../../orderPointsFixture");
const { SeriesEmphasisProvider } = await import("../../useSeriesEmphasis");

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

const orders = (list: BuildOrder[]): DemoBuildOrders => ({
  orders: list,
  players: [{ player: 0, name: "Alice" }],
  removals: 0,
  lastFrame: 9000,
  incomplete: false,
});

const PLACED = orders([
  order({ unitDefId: 1, position: { x: 1024, y: 0, z: 2048 } }),
  order({ unitDefId: 1, position: { x: 1040, y: 0, z: 2060 } }),
  order({ unitDefId: 2, position: { x: 3000, y: 0, z: 1000 }, team: 1 }),
  order({ unitDefId: 2, count: 5 }),
]);

const UNITS = [
  { name: "mex", fullName: "Metal Extractor", stats: { extractsMetal: 1 } },
  {
    name: "factory",
    fullName: "Land Factory",
    buildOptions: ["tank"],
    stats: { builder: true },
  },
] as unknown as UnitDatasetEntry[];

const game = (name: string): GameItem => ({
  name,
  primaryArchive: { name: `${name}.sdz` },
  dependencyArchives: [],
  info: {},
});

const INFO = {
  gameType: "Some Game 1.0",
  remixed: false,
  winningAllyTeams: [],
  winnersKnown: false,
  players: [
    {
      name: "Alice",
      team: 0,
      allyTeam: 0,
      spectator: false,
      rgbColor: [1, 0, 0],
    },
    {
      name: "Bob",
      team: 1,
      allyTeam: 1,
      spectator: false,
      rgbColor: [0, 0, 1],
    },
  ],
  ais: [],
  allyTeams: [
    { id: 0, startBox: { left: 0, top: 0, right: 0.4, bottom: 1 } },
    { id: 1, startBox: { left: 0.6, top: 0, right: 1, bottom: 1 } },
  ],
  startPositions: [
    { team: 0, x: 1024, y: 0, z: 512 },
    { team: 1, x: 3072, y: 0, z: 3584 },
  ],
} as unknown as DemoInfo;

/** A heightmap of 513 samples a side is a map of 4096 elmos a side. */
const HEIGHTMAP = { width: 513, height: 513 };

function show(info: DemoInfo = INFO, extra?: React.ReactNode) {
  return render(
    <SeriesEmphasisProvider>
      {extra}
      <ReplayMap
        info={info}
        replayPath="/replays/a.sdfz"
        mapName="Some Map"
        minimapUrl="data:image/png;base64,"
        heightmap={HEIGHTMAP}
        preview={null}
      />
    </SeriesEmphasisProvider>,
  );
}

const toggle = (name: string) => screen.getByRole("button", { name });
const dots = () =>
  [...document.querySelectorAll<HTMLElement>("button[data-team]")].map(
    (dot) => ({
      team: dot.dataset.team,
      left: dot.style.left,
      top: dot.style.top,
      label: dot.getAttribute("aria-label"),
    }),
  );
const boxes = () => document.querySelectorAll('[data-layer="startBox"]');

afterEach(() => {
  cleanup();
  resetReplayBuildOrders();
  resetReplayOrderPoints();
  localStorage.clear();
  ordersRead.mockClear();
  pointsRead.mockClear();
  HIDE = [];
  GAMES = [];
  DATASET = null;
  PRIMARY = "";
});

describe("what is on when the page opens", () => {
  it("draws the start boxes and the start positions, and reads no build orders", () => {
    show();
    expect(boxes()).toHaveLength(2);
    expect(dots()).toEqual([
      {
        team: "0",
        left: "25%",
        top: "12.5%",
        label: "Start position of Alice",
      },
      { team: "1", left: "75%", top: "87.5%", label: "Start position of Bob" },
    ]);
    expect(toggle("Start boxes").dataset.state).toBe("on");
    expect(toggle("Start positions").dataset.state).toBe("on");
    expect(toggle("Buildings ordered").dataset.state).toBe("off");
    expect(toggle("Building density").dataset.state).toBe("off");
    expect(ordersRead).not.toHaveBeenCalled();
    expect(toggle("Order density").dataset.state).toBe("off");
    expect(pointsRead).not.toHaveBeenCalled();
  });

  it("puts each start dot inside its own side's start box", () => {
    show();
    const [alice, bob] = dots();
    // Side 1's box is the west 40% and side 2's the east 40%.
    expect(Number.parseFloat(alice.left)).toBeLessThanOrEqual(40);
    expect(Number.parseFloat(bob.left)).toBeGreaterThanOrEqual(60);
  });

  it("paints a dot in its player's roster colour when there are no statistics", () => {
    show();
    const dot = document.querySelector<HTMLElement>(
      'button[data-team="1"] > span',
    );
    expect(dot?.style.backgroundColor).toMatch(/rgb\(0, 0, 255\)|blue|#00f/i);
  });

  it("says which source the layers come from, and what a start position is", () => {
    show();
    expect(
      screen.getByText(/orders and messages recorded during the match/i),
    ).toBeTruthy();
    expect(screen.getByText(/set before the game/i)).toBeTruthy();
    expect(screen.getByText(/allowed to start/i)).toBeTruthy();
  });
});

describe("the toggles", () => {
  it("switch each layer on its own", () => {
    show();
    fireEvent.click(toggle("Start boxes"));
    expect(boxes()).toHaveLength(0);
    expect(dots()).toHaveLength(2);
    fireEvent.click(toggle("Start positions"));
    expect(dots()).toHaveLength(0);
    fireEvent.click(toggle("Start boxes"));
    expect(boxes()).toHaveLength(2);
  });

  it("are remembered for the next replay", () => {
    show();
    fireEvent.click(toggle("Start boxes"));
    cleanup();
    show();
    expect(toggle("Start boxes").dataset.state).toBe("off");
    expect(boxes()).toHaveLength(0);
  });
});

describe("a replay with nothing to draw", () => {
  it("says a replay with no stream recorded no start positions", () => {
    show({ ...INFO, startPositions: undefined });
    expect(dots()).toHaveLength(0);
    expect(screen.getByText(/recorded no start positions/i)).toBeTruthy();
  });

  it("says a match with no start boxes set none", () => {
    show({ ...INFO, allyTeams: [] });
    expect(screen.getByText(/set no start boxes/i)).toBeTruthy();
  });

  it("says so when no building was ordered", async () => {
    ORDERS = orders([order({ count: 5 })]);
    show();
    fireEvent.click(toggle("Buildings ordered"));
    expect(await screen.findByText(/no buildings were ordered/i)).toBeTruthy();
    expect(document.querySelector('[data-layer="buildings"]')).toBeNull();
  });

  it("says so when the build orders cannot be read", async () => {
    ORDERS = new Error("damaged");
    show();
    fireEvent.click(toggle("Building density"));
    expect(
      await screen.findByText(/build orders could not be read/i),
    ).toBeTruthy();
  });
});

describe("buildings ordered", () => {
  it("reads the orders when switched on, and says they are orders and not buildings", async () => {
    ORDERS = PLACED;
    GAMES = [game("Some Game 1.0")];
    DATASET = { units: UNITS };
    show();
    fireEvent.click(toggle("Buildings ordered"));
    expect(
      await screen.findByText(/3 orders to place a building/i),
    ).toBeTruthy();
    expect(screen.getByText(/not what was built/i)).toBeTruthy();
    expect(
      screen.getByText(/1 factory queue order has no position/i),
    ).toBeTruthy();
    expect(document.querySelector('[data-layer="buildings"]')).toBeTruthy();
    // The shapes drawn are the ones the key lists.
    expect(screen.getByText("Economy")).toBeTruthy();
    expect(screen.getByText("Factory")).toBeTruthy();
    expect(screen.queryByText("Defence")).toBeNull();
    expect(ordersRead).toHaveBeenCalledTimes(1);
  });

  it("draws one neutral shape and says why when the game is not installed", async () => {
    ORDERS = PLACED;
    show();
    fireEvent.click(toggle("Buildings ordered"));
    expect(
      await screen.findByText(
        /Some Game 1\.0 is not installed, so nothing says what each building is for/i,
      ),
    ).toBeTruthy();
    expect(screen.queryByText("Economy")).toBeNull();
  });

  it("warns when the shapes come from another build of the game", async () => {
    ORDERS = PLACED;
    GAMES = [game("Some Game 2.0")];
    DATASET = { units: UNITS };
    show();
    fireEvent.click(toggle("Buildings ordered"));
    expect(
      await screen.findByText(/Shapes come from Some Game 2\.0/i),
    ).toBeTruthy();
  });

  it("labels a start dot with what its player opened with once the orders are read", async () => {
    ORDERS = PLACED;
    GAMES = [game("Some Game 1.0")];
    DATASET = { units: UNITS };
    show();
    fireEvent.click(toggle("Buildings ordered"));
    await waitFor(() =>
      expect(dots()[0].label).toBe(
        "Start position of Alice, opened with Metal Extractor ×2",
      ),
    );
  });
});

describe("building density", () => {
  it("draws a legend that states the peak in words", async () => {
    ORDERS = PLACED;
    show();
    fireEvent.click(toggle("Building density"));
    expect(
      await screen.findByText(/Most is 2 orders within 128 elmos of one spot/i),
    ).toBeTruthy();
    expect(screen.getByText("Where buildings were ordered")).toBeTruthy();
    expect(screen.getByText("Least")).toBeTruthy();
    expect(document.querySelector('[data-layer="density"]')).toBeTruthy();
  });

  it("draws no legend and no layer when there is nothing to add up", async () => {
    ORDERS = orders([]);
    show();
    fireEvent.click(toggle("Building density"));
    await screen.findByText(/no buildings were ordered/i);
    expect(screen.queryByText("Least")).toBeNull();
    expect(document.querySelector('[data-layer="density"]')).toBeNull();
  });
});

describe("order density", () => {
  const ORDER_POINTS = packOrders(
    [
      { x: 1024, z: 2048, source: 0 },
      { x: 1040, z: 2060, source: 1 },
      { x: 1050, z: 2070, source: 1 },
      { x: 9999, z: 9999, source: 0 },
    ],
    { unitAimed: 5, custom: 2 },
  );

  it("reads the orders once, and only when switched on", async () => {
    POINTS = ORDER_POINTS;
    show();
    expect(pointsRead).not.toHaveBeenCalled();
    fireEvent.click(toggle("Order density"));
    await screen.findByText("Where orders were aimed");
    expect(pointsRead).toHaveBeenCalledTimes(1);
    expect(pointsRead).toHaveBeenCalledWith({ replayPath: "/replays/a.sdfz" });
    fireEvent.click(toggle("Order density"));
    fireEvent.click(toggle("Order density"));
    expect(pointsRead).toHaveBeenCalledTimes(1);
    expect(document.querySelector('[data-layer="orderDensity"]')).toBeTruthy();
  });

  it("says what it is and what is not on it, with the counts", async () => {
    POINTS = ORDER_POINTS;
    show();
    fireEvent.click(toggle("Order density"));
    const note = await screen.findByText(/roughly where attention went/i);
    const text = note.textContent ?? "";
    // One of four is off the map, so three are on it.
    expect(text).toMatch(/3 orders are on it/);
    expect(text).toMatch(/2 of them were sent by widgets/);
    expect(text).toMatch(/5 orders were aimed at a unit/);
    expect(text).toMatch(/2 orders were a command the engine does not define/);
    expect(text).toMatch(/1 order was aimed off the map/);
  });

  it("is a layer of its own and does not read the build orders", async () => {
    POINTS = ORDER_POINTS;
    show();
    fireEvent.click(toggle("Order density"));
    await screen.findByText("Where orders were aimed");
    expect(ordersRead).not.toHaveBeenCalled();
    expect(document.querySelector('[data-layer="density"]')).toBeNull();
  });

  it("says so when the orders cannot be read", async () => {
    POINTS = new Error("no stream");
    show();
    fireEvent.click(toggle("Order density"));
    await screen.findByText(/orders could not be read from this replay/i);
    expect(document.querySelector('[data-layer="orderDensity"]')).toBeNull();
  });

  it("says so when no order had a place", async () => {
    POINTS = packOrders([]);
    show();
    fireEvent.click(toggle("Order density"));
    await screen.findByText(/no orders with a place on the map/i);
    expect(screen.queryByText("Least")).toBeNull();
  });
});

describe("one read for the page", () => {
  it("shares the build order section's read instead of walking the stream again", async () => {
    ORDERS = PLACED;
    show(INFO, <ReplayBuildOrders replayPath="/replays/a.sdfz" info={INFO} />);
    fireEvent.click(screen.getByRole("button", { name: /show build orders/i }));
    await screen.findByText(
      /orders each player gave, not what was built\. An order that was cancelled or never carried out is listed/i,
    );
    fireEvent.click(toggle("Buildings ordered"));
    fireEvent.click(toggle("Building density"));
    await screen.findByText(/3 orders to place a building/i);
    expect(ordersRead).toHaveBeenCalledTimes(1);
  });
});

describe("pointing at a player", () => {
  it("lights the dot that is pressed and fades the others, without changing a colour", () => {
    show();
    const [alice, bob] = [
      ...document.querySelectorAll<HTMLElement>("button[data-team]"),
    ];
    const before = (bob.firstElementChild as HTMLElement).style.backgroundColor;
    fireEvent.click(alice);
    expect(alice.getAttribute("aria-pressed")).toBe("true");
    expect(bob.getAttribute("aria-pressed")).toBe("false");
    expect(bob.firstElementChild?.className).toContain("opacity-40");
    expect(alice.firstElementChild?.className).not.toContain("opacity-40");
    expect((bob.firstElementChild as HTMLElement).style.backgroundColor).toBe(
      before,
    );
    // The lit dot says whose it is.
    expect(alice.textContent).toContain("Alice");
  });

  it("marks the library's own player", () => {
    PRIMARY = "Bob";
    show();
    expect(dots()[1].label).toBe("Start position of Bob, you");
    expect(dots()[0].label).toBe("Start position of Alice");
  });
});

describe("the profile gate", () => {
  it("leaves only the start boxes when a profile hides the spatial layers", () => {
    HIDE = ["analytics.spatialLayers"];
    show();
    expect(boxes()).toHaveLength(2);
    expect(dots()).toHaveLength(0);
    expect(
      screen.queryByRole("button", { name: "Start positions" }),
    ).toBeNull();
    expect(screen.queryByRole("button", { name: "Start boxes" })).toBeNull();
    expect(screen.getByText("Start boxes per team.")).toBeTruthy();
    expect(ordersRead).not.toHaveBeenCalled();
  });

  it("keeps the start boxes on under the gate even if they were switched off before", () => {
    show();
    fireEvent.click(toggle("Start boxes"));
    cleanup();
    HIDE = ["analytics.spatialLayers"];
    show();
    expect(boxes()).toHaveLength(2);
  });
});

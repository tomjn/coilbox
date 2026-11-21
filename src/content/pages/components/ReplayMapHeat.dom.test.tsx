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
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { HEAT_EDGE_CLASS } from "@/lib/heatCanvas";
import type {
  BuildOrder,
  DemoBuildOrders,
  DemoInfo,
  DemoOrderPoints,
  GameItem,
  StartBoxConfig,
  UnitDatasetEntry,
} from "../../bindings";

let HIDE: string[] = [];
let ORDERS: DemoBuildOrders | Error;
let GAMES: GameItem[] = [];
let DATASET: { units: UnitDatasetEntry[] } | null = null;
let PRIMARY = "";
let POINTS: DemoOrderPoints | Error;
let STARTBOXES: StartBoxConfig | null = null;
const ordersRead = vi.fn();
const pointsRead = vi.fn();
const startBoxesAsked = vi.fn();

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
  contentStartBoxes: async (args: unknown) => {
    startBoxesAsked(args);
    return { config: STARTBOXES };
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

const { ReplayMapHeat } = await import("./ReplayMapHeat");
const { ReplayBuildOrders } = await import("./ReplayBuildOrders");
const { resetReplayBuildOrders } = await import("../../useReplayBuildOrders");
const { resetReplayOrderPoints } = await import("../../replayOrderPoints");
const { packOrders } = await import("../../orderPointsFixture");
const { SeriesEmphasisProvider } = await import("../../useSeriesEmphasis");
// The dock's Heat window lane is where the window is set (#5309).
const { WindowLane: Lane, pressWindowPreset: press } = await import(
  "../../heatWindowFixture"
);

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
  modOptions: {},
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
      <Lane info={info} />
      <ReplayMapHeat
        info={info}
        replayPath="/replays/a.sdfz"
        mapName="Some Map"
        minimapUrl="data:image/png;base64,"
        heightmap={HEIGHTMAP}
      />
    </SeriesEmphasisProvider>,
  );
}

beforeAll(() => {
  // Radix sizes a slider thumb with a ResizeObserver, which happy-dom lacks.
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

const toggle = (name: string) => screen.getByRole("button", { name });
/** The map's help entry, opened. The explanation of the layers is said there. */
const help = () => {
  fireEvent.click(screen.getByRole("button", { name: "About the map" }));
  return within(screen.getByRole("dialog"));
};
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
  startBoxesAsked.mockClear();
  STARTBOXES = null;
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

  it("carries no explanation in the page, and says it in the help", () => {
    show();
    for (const said of [
      /orders and messages recorded during the match/i,
      /set before the game/i,
      /allowed to start/i,
    ]) {
      expect(screen.queryByText(said)).toBeNull();
    }
    const said = help();
    expect(
      said.getAllByText(/orders and messages recorded during the match/i),
    ).toHaveLength(1);
    expect(
      said.getByText(/Start boxes come from the match setup/),
    ).toBeTruthy();
    expect(said.getByText(/set before the game/i)).toBeTruthy();
    expect(said.getByText(/allowed to start/i)).toBeTruthy();
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

  it("show that a layer is on with a ticked box and a border, and not with a fill alone (#5357)", () => {
    show();
    const on = toggle("Start boxes");
    const off = toggle("Building density");
    expect(on.dataset.state).toBe("on");
    expect(off.dataset.state).toBe("off");
    // Every switch has the box, on or off, so its name does not move.
    for (const button of [on, off])
      expect(button.querySelector("span[aria-hidden]")).not.toBeNull();
    expect(on.className).toContain("data-[state=on]:border-primary");
    expect(on.className).toContain("data-[state=on]:bg-primary/20");
    expect(on.querySelector("span[aria-hidden]")?.className).toContain(
      "group-data-[state=on]/switch:bg-primary",
    );
  });
});

describe("the rail's room (#5357)", () => {
  it("holds every switch and note in one box that is no taller than the map may be, wraps nothing past its width and scrolls the rest", () => {
    show();
    const rail = document.querySelector("[data-map-rail]") as HTMLElement;
    // The cap is the one the map has, so the card is never taller than a map.
    expect(rail.style.getPropertyValue("--rail-max-height")).toBe(
      "max(16rem, 100cqh - var(--replay-dock-reserve, 0px) - 4.5rem)",
    );
    for (const cls of [
      "@xl:max-h-(--rail-max-height)",
      "@xl:overflow-y-auto",
      "@xl:overflow-x-hidden",
    ])
      expect(rail.className).toContain(cls);
    expect(
      rail.contains(screen.getByRole("toolbar", { name: "Map layers" })),
    ).toBe(true);
    expect(
      rail.contains(screen.getByRole("button", { name: "Start boxes" })),
    ).toBe(true);
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
    expect(await screen.findByText(/3 of 3 orders/)).toBeTruthy();
    expect(screen.queryByText(/not what was built/i)).toBeNull();
    expect(screen.queryByText(/factory queue order/i)).toBeNull();
    expect(screen.queryByText(/A mark is one order/)).toBeNull();
    const said = help();
    expect(said.getByText(/not what was built/i)).toBeTruthy();
    expect(said.getByText(/cancelled or never carried out/i)).toBeTruthy();
    expect(
      said.getByText(/1 factory queue order has no position/i),
    ).toBeTruthy();
    expect(said.getByText(/A mark is one order/)).toBeTruthy();
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

  it("edges the heat in dark, so a pale end of the ramp shows on pale ground (#5357)", async () => {
    ORDERS = PLACED;
    show();
    fireEvent.click(toggle("Building density"));
    await screen.findByText("Where buildings were ordered");
    const layer = document.querySelector(
      '[data-layer="density"]',
    ) as HTMLElement;
    expect(layer.className).toContain(HEAT_EDGE_CLASS);
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
    await screen.findByText("Where orders were aimed");
    expect(screen.queryByText(/roughly where attention went/i)).toBeNull();
    const text = help().getByText(/roughly where attention went/i).parentElement
      ?.textContent as string;
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
    await screen.findAllByText(/no orders with a place on the map/i);
    expect(screen.queryByText("Least")).toBeNull();
  });
});

describe("the time window", () => {
  const MIN = 60 * 30;
  /** A half hour match. Two orders early on, one of them before the game. */
  const EARLY = {
    ...orders([
      order({ frame: -1, position: { x: 1024, y: 0, z: 2048 } }),
      order({ frame: 900, position: { x: 1040, y: 0, z: 2060 } }),
      order({ frame: 20 * MIN, position: { x: 3000, y: 0, z: 1000 } }),
      order({ frame: 20 * MIN, count: 5 }),
    ]),
    lastFrame: 30 * MIN,
  };
  const LONG = { ...INFO, durationSec: 1800 } as DemoInfo;
  const window = () => screen.queryByTestId("time-window");

  it("is not there while only the layers set before the game are on", () => {
    ORDERS = EARLY;
    show(LONG);
    expect(window()).toBeNull();
  });

  it("opens on the whole match, with the count the layer has", async () => {
    ORDERS = EARLY;
    show(LONG);
    fireEvent.click(toggle("Buildings ordered"));
    expect(await screen.findByText(/3 of 3 orders/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Heat window" }));
    expect(
      screen
        .getByRole("button", { name: "Whole match" })
        .getAttribute("aria-pressed"),
    ).toBe("true");
    expect(screen.getByText(/The whole match, 0:00 to 30:00/)).toBeTruthy();
  });

  it("does not have the old control under the map", async () => {
    ORDERS = EARLY;
    show(LONG);
    fireEvent.click(toggle("Buildings ordered"));
    await screen.findByText(/3 of 3 orders/);
    expect(screen.queryByText("Time window")).toBeNull();
    // The lane's two ends are the only sliders there are.
    expect(screen.getAllByRole("slider")).toHaveLength(2);
    expect(
      document.querySelector("[data-map-window] [role=slider]"),
    ).toBeNull();
  });

  it("narrows the orders every layer draws when a preset is pressed", async () => {
    ORDERS = EARLY;
    show(LONG);
    fireEvent.click(toggle("Buildings ordered"));
    fireEvent.click(toggle("Building density"));
    await screen.findByText(/3 of 3 orders/);
    expect(
      screen.getByText(/Most is 2 orders within 128 elmos of one spot\./),
    ).toBeTruthy();

    // The first five minutes hold the pregame order and the one at 30 seconds.
    press("First 5 minutes");
    expect(await screen.findByText(/2 of 3 orders/)).toBeTruthy();
    expect(screen.getByText(/Orders given from 0:00 to 5:00/)).toBeTruthy();
    // The legend's peak is the window's own.
    expect(
      screen.getByText(
        /Most is 2 orders within 128 elmos of one spot in this window/,
      ),
    ).toBeTruthy();
    // The start dots are set before the game and stay.
    expect(dots()).toHaveLength(2);
  });

  it("leaves out the pregame order once the window starts after zero", async () => {
    ORDERS = EARLY;
    show(LONG);
    fireEvent.click(toggle("Buildings ordered"));
    await screen.findByText(/3 of 3 orders/);
    const [start] = screen.getAllByRole("slider");
    act(() => start.focus());
    fireEvent.keyDown(start, { key: "ArrowRight" });
    expect(await screen.findByText(/2 of 3 orders/)).toBeTruthy();
  });

  it("says none of the orders, and not that no building was ordered, for an empty window", async () => {
    ORDERS = EARLY;
    show(LONG);
    fireEvent.click(toggle("Building density"));
    await screen.findByText(/3 of 3 orders/);
    press("Last 5 minutes");
    expect(await screen.findByText(/0 of 3 orders/)).toBeTruthy();
    expect(screen.queryByText(/no buildings were ordered/i)).toBeNull();
    expect(screen.queryByText("Least")).toBeNull();
    expect(document.querySelector('[data-layer="density"]')).toBeNull();
  });

  it("goes back to the whole match from the whole match button", async () => {
    ORDERS = EARLY;
    show(LONG);
    fireEvent.click(toggle("Building density"));
    await screen.findByText(/3 of 3 orders/);
    press("First 5 minutes");
    await screen.findByText(/2 of 3 orders/);
    press("Whole match");
    expect(await screen.findByText(/3 of 3 orders/)).toBeTruthy();
    expect(
      screen.getByText(/Most is 2 orders within 128 elmos of one spot\./),
    ).toBeTruthy();
  });

  it("starts the next replay on the whole match", async () => {
    ORDERS = EARLY;
    const props = {
      info: LONG,
      mapName: "Some Map",
      minimapUrl: "data:image/png;base64,",
      heightmap: HEIGHTMAP,
      preview: null,
    };
    // The page keys its stores by replay, so the next one starts again.
    const page = (path: string) => (
      <SeriesEmphasisProvider key={path}>
        <Lane info={LONG} />
        <ReplayMapHeat {...props} replayPath={path} />
      </SeriesEmphasisProvider>
    );
    const view = render(page("/replays/a.sdfz"));
    fireEvent.click(toggle("Building density"));
    await screen.findByText(/3 of 3 orders/);
    press("First 5 minutes");
    await screen.findByText(/2 of 3 orders/);
    view.rerender(page("/replays/b.sdfz"));
    // Read straight after the path changed, before anything is read for it.
    expect(screen.getByText(/The whole match, 0:00 to 30:00/)).toBeTruthy();
  });

  it("is not remembered between visits", async () => {
    ORDERS = EARLY;
    show(LONG);
    fireEvent.click(toggle("Building density"));
    await screen.findByText(/3 of 3 orders/);
    press("First 5 minutes");
    await screen.findByText(/2 of 3 orders/);
    cleanup();
    resetReplayBuildOrders();
    show(LONG);
    // The layer is still on from the last visit, and the window is not.
    expect(await screen.findByText(/3 of 3 orders/)).toBeTruthy();
    expect(screen.getByText(/The whole match, 0:00 to 30:00/)).toBeTruthy();
    expect(localStorage.getItem("coilbox.replayMap.layers")).not.toContain(
      "window",
    );
  });

  it("goes with the spatial layers when a profile hides them", () => {
    HIDE = ["analytics.spatialLayers"];
    show(LONG);
    expect(window()).toBeNull();
  });
});

describe("order density in the time window", () => {
  const MIN = 60 * 30;
  const LONG = { ...INFO, durationSec: 1800 } as DemoInfo;
  const POINTS_OVER_TIME = packOrders(
    [
      { x: 1024, z: 2048, frame: 100, source: 0 },
      { x: 1040, z: 2060, frame: 900, source: 1 },
      { x: 3000, z: 1000, frame: 28 * MIN, source: 1 },
      { x: 3010, z: 1010, frame: 28 * MIN, source: 1 },
    ],
    { lastFrame: 30 * MIN },
  );

  it("shows the window while only this layer is on, counting its own points", async () => {
    POINTS = POINTS_OVER_TIME;
    show(LONG);
    expect(screen.queryByTestId("time-window")).toBeNull();
    fireEvent.click(toggle("Order density"));
    expect(await screen.findByText(/4 of 4 orders on the map/)).toBeTruthy();
    expect(ordersRead).not.toHaveBeenCalled();
  });

  it("narrows the points the layer draws, its counts and its legend", async () => {
    POINTS = POINTS_OVER_TIME;
    show(LONG);
    fireEvent.click(toggle("Order density"));
    await screen.findByText(/4 of 4 orders on the map/);
    expect(screen.getByText(/Most is 2 orders within/)).toBeTruthy();

    press("First 5 minutes");
    expect(await screen.findByText(/2 of 4 orders on the map/)).toBeTruthy();
    // Two orders are in the first five minutes, 1 of them from a widget.
    const note = help().getByText(/roughly where attention went/i)
      .parentElement as HTMLElement;
    expect(note.textContent).toMatch(/2 orders in this window are on it/);
    expect(note.textContent).toMatch(/1 of them were sent by widgets/);
    expect(note.textContent).toMatch(/cannot narrow/);
    expect(
      screen.getByText(
        /Most is 2 orders within \d+ elmos of one spot in this window/,
      ),
    ).toBeTruthy();

    press("Last 5 minutes");
    expect(await screen.findByText(/2 of 4 orders on the map/)).toBeTruthy();
    expect(
      screen.getByText(
        /Most is 2 orders within \d+ elmos of one spot in this window/,
      ),
    ).toBeTruthy();
  });

  it("counts each layer's points under its own name when both are on", async () => {
    POINTS = POINTS_OVER_TIME;
    ORDERS = {
      ...PLACED,
      lastFrame: 30 * MIN,
      orders: PLACED.orders.map((o) => ({ ...o, frame: 100 })),
    };
    show(LONG);
    fireEvent.click(toggle("Building density"));
    fireEvent.click(toggle("Order density"));
    await screen.findByText(/4 of 4 orders on the map/);
    expect(screen.getByText(/3 of 3 building orders/)).toBeTruthy();
    press("Last 5 minutes");
    expect(await screen.findByText(/2 of 4 orders on the map/)).toBeTruthy();
    expect(screen.getByText(/0 of 3 building orders/)).toBeTruthy();
  });
});

describe("one read for the page", () => {
  it("shares the build order section's read instead of walking the stream again", async () => {
    ORDERS = PLACED;
    show(INFO, <ReplayBuildOrders replayPath="/replays/a.sdfz" info={INFO} />);
    fireEvent.click(screen.getByRole("button", { name: /show build orders/i }));
    await screen.findByText(/Opening length in minutes/i);
    fireEvent.click(toggle("Buildings ordered"));
    fireEvent.click(toggle("Building density"));
    await screen.findByText(/3 of 3 orders/);
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

describe("what stays in the page and what moves to the help", () => {
  it("keeps the warning, the reason, the counts and the key beside the controls", async () => {
    ORDERS = PLACED;
    GAMES = [game("Some Game 2.0")];
    DATASET = { units: UNITS };
    POINTS = packOrders([{ x: 1024, z: 2048, source: 0 }], { unitAimed: 5 });
    show();
    fireEvent.click(toggle("Buildings ordered"));
    fireEvent.click(toggle("Order density"));
    // The warning that the shapes may be wrong.
    expect(
      await screen.findByText(/Shapes come from Some Game 2\.0/i),
    ).toBeTruthy();
    // The reason a layer is off, on the layer and in one line.
    expect(toggle("Deaths").parentElement?.getAttribute("title")).toMatch(
      /This replay has not been analysed/,
    );
    expect(screen.getByTestId("event-block").textContent).toMatch(
      /This replay has not been analysed/,
    );
    // The window's counts, as short labels.
    expect(await screen.findByText(/3 of 3 building orders/)).toBeTruthy();
    expect(screen.getByText(/1 of 1 orders on the map/)).toBeTruthy();
    // The key to the shapes, and each legend's peak.
    expect(screen.getByText("Economy")).toBeTruthy();
    expect(screen.getByText(/Most is 1 order within/)).toBeTruthy();
  });

  it("keeps an empty state in the page", async () => {
    POINTS = packOrders([]);
    show();
    fireEvent.click(toggle("Order density"));
    expect(
      (await screen.findAllByText(/no orders with a place on the map/i)).length,
    ).toBeGreaterThan(0);
  });

  it("has none of the explanation in the page until the help is opened", async () => {
    ORDERS = PLACED;
    GAMES = [game("Some Game 1.0")];
    DATASET = { units: UNITS };
    POINTS = packOrders([{ x: 1024, z: 2048, source: 0 }], { unitAimed: 5 });
    show();
    fireEvent.click(toggle("Buildings ordered"));
    fireEvent.click(toggle("Order density"));
    await screen.findByText(/3 of 3 building orders/);
    const moved = [
      /orders and messages recorded/i,
      /allowed to start/i,
      /set before the game/i,
      /not what was built/i,
      /factory queue order/i,
      /A mark is one order/,
      /roughly where attention went/i,
      /Colours compare places on this map/,
      /not when anything was built/i,
      /draw events from an analysis/,
    ];
    for (const said of moved) expect(screen.queryByText(said)).toBeNull();
    const dialog = help();
    for (const said of moved)
      expect(dialog.getAllByText(said).length).toBeGreaterThan(0);
  });
});

describe("Zero-K's polygon start boxes (#5313)", () => {
  const ZK = { ...game("Zero-K v1.12.0"), info: { shortname: "ZK" } };
  const square = (x: number, z: number): [number, number][] => [
    [x, z],
    [x + 1000, z],
    [x + 1000, z + 1000],
    [x, z + 1000],
  ];
  const zerok = (mapName: string, over: Partial<DemoInfo> = {}): DemoInfo =>
    ({
      ...INFO,
      gameType: "Zero-K v1.12.0",
      mapName,
      // A Zero-K replay carries no rectangles.
      allyTeams: [
        { id: 0, color: [1, 0, 0] },
        { id: 1, color: [0, 0, 1] },
      ],
      ...over,
    }) as DemoInfo;
  const areas = () =>
    [...document.querySelectorAll("[data-layer='startBox']")].map((g) => ({
      points: g.querySelector("polygon")?.getAttribute("points"),
      stroke: g.querySelectorAll("polygon")[1]?.getAttribute("stroke"),
    }));
  const numbers = () =>
    [...document.querySelectorAll("[data-layer='startBoxLabel']")].map(
      (l) => l.textContent,
    );

  it("draws the polygons for the map, in the colour of the side that started in each", async () => {
    GAMES = [ZK];
    STARTBOXES = {
      source: "game",
      file: "Zk Shuffled.lua",
      teams: [
        { id: 0, startPoints: [], boxes: [square(2000, 0)] },
        { id: 1, startPoints: [], boxes: [square(1000, 0)] },
        { id: 2, startPoints: [], boxes: [square(0, 3000)] },
      ],
    };
    // Alice (side 1) starts at 1024, 512, which is in the second box.
    show(zerok("Zk Shuffled"));
    await waitFor(() => expect(areas()).toHaveLength(3));
    expect(areas()).toEqual([
      {
        points: "48.828,0 73.242,0 73.242,24.414 48.828,24.414",
        stroke: "#94a3b8",
      },
      {
        points: "24.414,0 48.828,0 48.828,24.414 24.414,24.414",
        stroke: "#ff0000",
      },
      {
        points: "0,73.242 24.414,73.242 24.414,97.656 0,97.656",
        stroke: "#94a3b8",
      },
    ]);
    // Bob (side 2) starts at 3072, 3584, in no box, so no area is his.
    expect(numbers()).toEqual(["1"]);
    // The number sits at the area's top left, clear of the start dot that
    // Zero-K's start points put in the middle.
    const badge = document.querySelector<HTMLElement>(
      "[data-layer='startBoxLabel']",
    ) as HTMLElement;
    expect(Number.parseFloat(badge.style.left)).toBeCloseTo(24.414, 2);
    expect(Number.parseFloat(badge.style.top)).toBe(0);
    expect(startBoxesAsked).toHaveBeenCalledTimes(1);
    expect(startBoxesAsked).toHaveBeenCalledWith({
      enginePath: "/engine",
      dataDir: "/data",
      gameArchive: "Zero-K v1.12.0.sdz",
      mapName: "Zk Shuffled",
      mapSizeX: 4096,
      mapSizeZ: 4096,
      allyTeams: [
        { allyTeam: 0, bots: [false] },
        { allyTeam: 1, bots: [false] },
      ],
    });
  });

  it("does not ask for a replay of another game, and draws its rectangles", async () => {
    GAMES = [game("Some Game 1.0")];
    STARTBOXES = {
      source: "game",
      file: "x.lua",
      teams: [{ id: 0, startPoints: [], boxes: [square(0, 0)] }],
    };
    show({ ...INFO, mapName: "Not Zk Map" });
    await act(async () => {});
    expect(startBoxesAsked).not.toHaveBeenCalled();
    expect(boxes()).toHaveLength(2);
  });

  it("does not ask when the replay's game is not installed", async () => {
    GAMES = [];
    show(zerok("Zk No Game"));
    await act(async () => {});
    expect(startBoxesAsked).not.toHaveBeenCalled();
    expect(boxes()).toHaveLength(0);
    screen.getByText("This match set no start boxes.");
  });

  it("shows none, with the same line, for a map Zero-K defines no areas for", async () => {
    GAMES = [ZK];
    STARTBOXES = null;
    show(zerok("Zk No Areas"));
    await waitFor(() => screen.getByText("This match set no start boxes."));
    expect(startBoxesAsked).toHaveBeenCalledTimes(1);
    expect(boxes()).toHaveLength(0);
  });

  it("says nothing while the file is being read", async () => {
    GAMES = [ZK];
    STARTBOXES = null;
    show(zerok("Zk Still Reading"));
    expect(screen.queryByText("This match set no start boxes.")).toBeNull();
    await waitFor(() => screen.getByText("This match set no start boxes."));
  });

  it("asks once for the session when the map is shown again", async () => {
    GAMES = [ZK];
    STARTBOXES = {
      source: "map",
      file: "mapconfig/map_startboxes.lua",
      teams: [{ id: 0, startPoints: [], boxes: [square(0, 0)] }],
    };
    const first = show(zerok("Zk Twice"));
    await waitFor(() => expect(areas()).toHaveLength(1));
    first.unmount();
    show(zerok("Zk Twice"));
    await waitFor(() => expect(areas()).toHaveLength(1));
    expect(startBoxesAsked).toHaveBeenCalledTimes(1);
  });

  it("does not run the file while the start boxes switch is off", async () => {
    GAMES = [ZK];
    STARTBOXES = null;
    localStorage.setItem(
      "coilbox.replayMap.layers",
      JSON.stringify({ startBoxes: false }),
    );
    show(zerok("Zk Switched Off"));
    await act(async () => {});
    expect(startBoxesAsked).not.toHaveBeenCalled();
  });
});

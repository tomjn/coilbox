// @vitest-environment happy-dom
/**
 * The base crops (#1177): one view of the map per player, with the orders that
 * player gave drawn on it. Where a mark lands is `replayBaseCrops.test.ts`, and
 * this file reads the positions the page gives the DOM. Nothing is painted, so
 * what is asserted is the style values, the text and the emphasis state.
 */
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type {
  BuildOrder,
  DemoBuildOrders,
  DemoInfo,
  GameItem,
  UnitDatasetEntry,
} from "../../bindings";

let HIDE: string[] = [];
let ORDERS: DemoBuildOrders | Error;
let GAMES: GameItem[] = [];
let DATASET: { units: UnitDatasetEntry[] } | null = null;
const ordersRead = vi.fn();

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
  usePrimaryPlayer: () => "",
}));
vi.mock("../../useMatchStats", () => ({
  useMatchStats: () => ({ data: null, loading: false, error: null }),
}));
vi.mock("../../../mapconv/pages/components/MapPreview3D", () => ({
  MapPreview3D: () => <div data-testid="preview-3d" />,
}));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: async () => {} }));

const { ReplayMap } = await import("./ReplayMap");
const { resetReplayBuildOrders } = await import("../../useReplayBuildOrders");
const { SeriesEmphasisProvider } = await import("../../useSeriesEmphasis");

const MIN = 60 * 30;

const order = (over: Partial<BuildOrder>): BuildOrder => ({
  frame: 100,
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

const read = (list: BuildOrder[]): DemoBuildOrders => ({
  orders: list,
  players: [{ player: 0, name: "Alice" }],
  removals: 0,
  lastFrame: 30 * MIN,
  incomplete: false,
});

/**
 * Alice's start is on the north edge and Bob's is in the south east corner of a
 * square map 4096 elmos a side, so a crop is 1024 elmos across. Alice orders
 * two buildings near her start, one far away, and one more at 20 minutes.
 */
const PLACED = read([
  order({ unitDefId: 1, position: { x: 1124, y: 0, z: 300 } }),
  order({ unitDefId: 1, position: { x: 1224, y: 0, z: 300 } }),
  order({ unitDefId: 1, position: { x: 3000, y: 0, z: 3000 } }),
  order({
    unitDefId: 2,
    frame: 20 * MIN,
    position: { x: 1000, y: 0, z: 400 },
  }),
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
  durationSec: 1800,
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
  allyTeams: [{ id: 0 }, { id: 1 }],
  startPositions: [
    { team: 0, x: 1024, y: 0, z: 200 },
    { team: 1, x: 4000, y: 0, z: 4000 },
  ],
} as unknown as DemoInfo;

const HEIGHTMAP = { width: 513, height: 513 };

function show(info: DemoInfo = INFO) {
  return render(
    <SeriesEmphasisProvider>
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

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

afterEach(() => {
  cleanup();
  resetReplayBuildOrders();
  localStorage.clear();
  ordersRead.mockClear();
  HIDE = [];
  GAMES = [];
  DATASET = null;
});

const toggle = (name: string) => screen.getByRole("button", { name });
const press = (name: string) =>
  fireEvent.click(screen.getByRole("button", { name }));
const card = (team: number) =>
  document.querySelector<HTMLElement>(`button[data-crop-team="${team}"]`);
const marks = (team: number) =>
  [...(card(team)?.querySelectorAll<SVGElement>("[data-crop-mark]") ?? [])].map(
    (m) => [Number(m.dataset.left), Number(m.dataset.top)],
  );
/** Marks match to a thousandth of a percent of the crop. */
const expectMarks = (team: number, want: number[][]) => {
  const got = marks(team);
  expect(got).toHaveLength(want.length);
  got.forEach(([left, top], i) => {
    expect(left).toBeCloseTo(want[i][0], 2);
    expect(top).toBeCloseTo(want[i][1], 2);
  });
};

async function open() {
  fireEvent.click(toggle("Bases"));
  await screen.findByTestId("base-crops");
}

describe("the Bases layer", () => {
  it("is off until it is switched on, and reads no build orders before that", () => {
    show();
    expect(toggle("Bases").dataset.state).toBe("off");
    expect(screen.queryByTestId("base-crops")).toBeNull();
    expect(ordersRead).not.toHaveBeenCalled();
  });

  it("is remembered with the other layers", () => {
    show();
    fireEvent.click(toggle("Bases"));
    expect(
      JSON.parse(localStorage.getItem("coilbox.replayMap.layers") ?? "{}"),
    ).toMatchObject({ bases: true });
  });

  it("is gone, with the other spatial layers, when a profile hides them", () => {
    HIDE = ["analytics.spatialLayers"];
    show();
    expect(screen.queryByRole("button", { name: "Bases" })).toBeNull();
    expect(screen.queryByTestId("base-crops")).toBeNull();
    expect(ordersRead).not.toHaveBeenCalled();
  });
});

describe("one crop for each player", () => {
  it("names each player, says what they opened with and says it is orders", async () => {
    ORDERS = PLACED;
    GAMES = [game("Some Game 1.0")];
    DATASET = { units: UNITS };
    show();
    await open();
    expect(card(0)?.textContent).toContain("Alice");
    expect(card(0)?.textContent).toContain("Opened with Metal Extractor ×3");
    expect(card(1)?.textContent).toContain("Bob");
    expect(card(1)?.textContent).not.toContain("Opened with");
    expect(
      screen.getByText(
        /the buildings a player ordered, not the buildings that were built/,
      ),
    ).toBeTruthy();
    // One source note under the layers, and one for the crops.
    expect(screen.getAllByText(/orders and messages recorded/i)).toHaveLength(
      2,
    );
    expect(ordersRead).toHaveBeenCalledTimes(1);
  });

  it("puts allies together under their side", async () => {
    ORDERS = PLACED;
    show();
    await open();
    const groups = [
      ...document.querySelectorAll<HTMLElement>("[data-crop-group]"),
    ];
    expect(groups.map((g) => g.dataset.cropGroup)).toEqual(["0", "1"]);
    expect(screen.getByText("Team 1")).toBeTruthy();
    expect(screen.getByText("Team 2")).toBeTruthy();
    expect(groups[0].querySelector("[data-crop-team='0']")).toBeTruthy();
  });

  it("names every player on a shared team", async () => {
    ORDERS = PLACED;
    show({
      ...INFO,
      players: [
        ...INFO.players,
        { name: "Carol", team: 0, allyTeam: 0, spectator: false },
      ],
    } as unknown as DemoInfo);
    await open();
    expect(card(0)?.textContent).toContain("Alice, Carol");
  });
});

describe("the scale", () => {
  it("states the crop's side and the bar's length once, above the views, and draws a bar on each", async () => {
    ORDERS = PLACED;
    show();
    await open();
    expect(screen.getByText(/Every view is 1,024 elmos across/)).toBeTruthy();
    // The bar is a quarter of the crop's width, which is 256 of 1024 elmos.
    expect(
      screen.getAllByText(/The bar at the bottom left of a view is 256 elmos/),
    ).toHaveLength(1);
    const bars = document.querySelectorAll("[data-crop-scale-bar]");
    expect(bars).toHaveLength(2);
    expect((bars[0] as HTMLElement).style.width).toBe("25%");
    // No view repeats it.
    expect(card(0)?.textContent).not.toContain("elmos");
  });

  it("cuts the minimap itself to the crop, scaled and offset to match", async () => {
    ORDERS = PLACED;
    show();
    await open();
    const image = card(0)?.querySelector<HTMLImageElement>("[data-crop-image]");
    expect(image?.getAttribute("src")).toBe("data:image/png;base64,");
    // A quarter of the map shows, so the image is four boxes wide. The
    // window's west edge is 512 elmos in, which is half a box, and its north
    // edge is the map's.
    expect(image?.style.width).toBe("400%");
    expect(image?.style.height).toBe("400%");
    expect(image?.style.left).toBe("-50%");
    expect(image?.style.top).toBe("0%");
  });
});

describe("where things sit inside a crop", () => {
  it("draws a start at its real place when it is near an edge", async () => {
    ORDERS = PLACED;
    show();
    await open();
    // Alice at 1024, 200: the window runs 512 to 1536 across and from the
    // north edge down, so she is half way across and 200 of 1024 down.
    const alice = card(0)?.querySelector<HTMLElement>("[data-crop-start]");
    expect(alice?.style.left).toBe("50%");
    expect(alice?.style.top).toBe("19.53125%");
    // Bob at 4000, 4000 is in the corner: the window is 3072 to 4096 each way.
    const bob = card(1)?.querySelector<HTMLElement>("[data-crop-start]");
    expect(bob?.style.left).toBe("90.625%");
    expect(bob?.style.top).toBe("90.625%");
  });

  it("positions a mark by its distance from the crop's corner", async () => {
    ORDERS = PLACED;
    show();
    await open();
    // 1124 is 612 east of 512 and 300 is 300 south of the north edge, out of
    // 1024. The pre-game window holds both near orders and the one at 20
    // minutes (1000, 400), which is 488 east of the window's edge.
    expectMarks(0, [
      [59.765625, 29.296875],
      [69.53125, 29.296875],
      [47.65625, 39.0625],
    ]);
  });

  it("draws a mark in its player's colour, in the shape of what was ordered", async () => {
    ORDERS = PLACED;
    GAMES = [game("Some Game 1.0")];
    DATASET = { units: UNITS };
    show();
    await open();
    const paths = [...(card(0)?.querySelectorAll("[data-crop-mark]") ?? [])];
    expect(paths).toHaveLength(3);
    expect(paths[0].getAttribute("fill")).toMatch(/rgb\(255, 0, 0\)|red|#f00/i);
    expect(new Set(paths.map((p) => p.getAttribute("d"))).size).toBe(2);
    expect(screen.getByText("Economy")).toBeTruthy();
    expect(screen.getByText("Factory")).toBeTruthy();
  });

  it("counts the orders outside the view, so they are not taken for orders not given", async () => {
    ORDERS = PLACED;
    show();
    await open();
    expect(card(0)?.textContent).toContain("4 ordered, 1 outside this view");
    expect(card(0)?.querySelector("[data-crop-outside]")?.textContent).toBe(
      ", 1 outside this view",
    );
    // What the two counts are is said once, above the views.
    expect(
      screen.getAllByText(
        /Under each view is how many buildings that player ordered, and how many of those fall outside the view/,
      ),
    ).toHaveLength(1);
    expect(card(1)?.querySelector("[data-crop-outside]")).toBeNull();
  });
});

describe("the time window", () => {
  it("shows the whole match, and says so, until a window is chosen", async () => {
    ORDERS = PLACED;
    show();
    await open();
    expect(
      screen.getByText(/Showing orders given across the whole match/),
    ).toBeTruthy();
    expect(marks(0)).toHaveLength(3);
  });

  it("shows only the orders given inside the window, and says which", async () => {
    ORDERS = PLACED;
    show();
    await open();
    press("First 5 minutes");
    expect(
      await screen.findByText(/Showing orders given from 0:00 to 5:00/),
    ).toBeTruthy();
    expectMarks(0, [
      [59.765625, 29.296875],
      [69.53125, 29.296875],
    ]);
    expect(card(0)?.textContent).toContain("3 ordered, 1 outside this view");
  });

  it("says a player ordered nothing in an empty window, and draws their start", async () => {
    ORDERS = PLACED;
    show();
    await open();
    expect(card(1)?.textContent).toContain("None ordered");
    expect(card(1)?.textContent).not.toContain("in this window");
    press("Last 5 minutes");
    await screen.findByText(/Showing orders given from 25:00 to 30:00/);
    expect(card(0)?.textContent).toContain("None ordered in this window");
    expect(card(0)?.querySelector("[data-crop-start]")).toBeTruthy();
    expect(marks(0)).toEqual([]);
  });
});

describe("when there is little to show", () => {
  it("says why there are no crops for a replay with no start positions", () => {
    ORDERS = PLACED;
    show({ ...INFO, startPositions: undefined } as unknown as DemoInfo);
    fireEvent.click(toggle("Bases"));
    expect(
      screen.getByText(/holds no start position to centre one on/),
    ).toBeTruthy();
    expect(document.querySelector("button[data-crop-team]")).toBeNull();
  });

  it("gives a crop to an AI team placed by the server", async () => {
    ORDERS = PLACED;
    show({
      ...INFO,
      players: [INFO.players[0]],
      ais: [{ name: "slot 3", shortName: "Some AI", team: 1, allyTeam: 1 }],
    } as unknown as DemoInfo);
    await open();
    expect(card(1)?.textContent).toContain("Some AI");
  });

  it("has no opening and says the game is not installed when it is not", async () => {
    ORDERS = PLACED;
    show();
    await open();
    expect(card(0)?.textContent).not.toContain("Opened with");
    expect(card(0)?.textContent).toContain("4 ordered");
    expect(card(0)?.textContent).not.toContain("not installed");
    expect(
      screen.getAllByText(
        /This replay's game is not installed, so every mark is the same shape/,
      ),
    ).toHaveLength(1);
    // Every mark is one shape, and there is no key to say what a shape means.
    const shapes = new Set(
      [...(card(0)?.querySelectorAll("[data-crop-mark]") ?? [])].map((p) =>
        p.getAttribute("d"),
      ),
    );
    expect(shapes.size).toBe(1);
    expect(screen.queryByText("Economy")).toBeNull();
  });

  it("draws no crops while the build orders cannot be read", async () => {
    ORDERS = new Error("damaged");
    show();
    fireEvent.click(toggle("Bases"));
    expect(
      await screen.findByText(/build orders could not be read/i),
    ).toBeTruthy();
    expect(screen.queryByTestId("base-crops")).toBeNull();
  });
});

describe("pointing at a player", () => {
  it("lights the pressed player's crop and fades the others", async () => {
    ORDERS = PLACED;
    show();
    await open();
    fireEvent.click(card(0) as HTMLElement);
    expect(card(0)?.getAttribute("aria-pressed")).toBe("true");
    expect(card(1)?.getAttribute("aria-pressed")).toBe("false");
    expect(card(1)?.className).toContain("opacity-40");
    expect(card(0)?.className).not.toContain("opacity-40");
    // The same press lights the player's start dot on the whole map.
    expect(
      document
        .querySelector('button[data-team="0"]')
        ?.getAttribute("aria-pressed"),
    ).toBe("true");
  });

  it("lights a crop when the player is pointed at somewhere else", async () => {
    ORDERS = PLACED;
    show();
    await open();
    fireEvent.click(
      document.querySelector('button[data-team="1"]') as HTMLElement,
    );
    expect(card(1)?.getAttribute("aria-pressed")).toBe("true");
    expect(card(0)?.className).toContain("opacity-40");
  });

  it("can be reached by keyboard", async () => {
    ORDERS = PLACED;
    show();
    await open();
    const crop = card(0) as HTMLElement;
    expect(crop.tagName).toBe("BUTTON");
    expect(crop.tabIndex).toBe(0);
    act(() => crop.focus());
    expect(document.activeElement).toBe(crop);
  });
});

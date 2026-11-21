// @vitest-environment happy-dom

/**
 * The replay page's map view of a recorded track (#3807): what it shows in each
 * state, what it draws, what the pointer names, and when it stops drawing.
 *
 * The real section, the real track handle and the real drawing loop, over the
 * fixture track the Rust reader wrote. The commands that read a track, the
 * canvas and the browser's animation frames are replaced. happy-dom does no
 * layout, so the canvas is given a size and nothing here says how it looks.
 */

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ChatLine,
  DemoInfo,
  DemoTrailer,
  GameItem,
  ReplayTrackFault,
  ReplayTrackHeader,
  StartBoxConfig,
  StoredReplayAnalysis,
  StoredReplayTrack,
  TimelineEvent,
} from "../../bindings";
import { useStoredColorMode } from "../../chartColorMode";
import fixture from "../../fixtures/replay-track-window.json";
import { type ChartColorMode, colorSeries, teamSeries } from "../../matchStats";
import {
  resetReplayAnalysisForTests,
  seedReplayAnalysisForTests,
} from "../../replayAnalysis";
import type { ReplayWatch } from "../../replayEngine";
import { resetReplayEventReadsForTests } from "../../replayEventRead";
import { FAINT_UNITS } from "../../replayMapView/paint";
import { recordingContext } from "../../replayMapView/testTrack";
import { ReplayTrackError } from "../../replayTrack/fault";
import {
  decodeWindowPayload,
  type TrackWindow,
} from "../../replayTrack/trackWindow";
import {
  resetReplayTracksForTests,
  seedReplayTracksForTests,
} from "../../replayTracks";
import type { EmphasisStore } from "../../seriesEmphasis";

const ID = "00112233445566778899aabbccddeeff";
const HEADER = fixture.header as ReplayTrackHeader;

/** What reading the header answers: the header, or a fault. */
let HEADER_ANSWER: ReplayTrackHeader | ReplayTrackFault = HEADER;
const headerReads: string[] = [];
/** Holds the header read back until a test lets it go. */
let HELD_HEADER = false;
const headerReleases: (() => void)[] = [];
/** Windows that are held back until the test lets them go, or fails them. */
let HELD: Set<number> = new Set();
const held: {
  k: number;
  resolve: (w: TrackWindow) => void;
  reject: (e: unknown) => void;
}[] = [];

function fixtureWindow(k: number): TrackWindow {
  const b = Buffer.from(fixture.windows[k].payload, "base64");
  return decodeWindowPayload(
    b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength),
    fixture.rotationBits,
  );
}

vi.mock("../../replayTrack/commands", () => ({
  readTrackHeader: async (gameId: string) => {
    headerReads.push(gameId);
    if (HELD_HEADER) {
      await new Promise<void>((resolve) => headerReleases.push(resolve));
    }
    if ("kind" in HEADER_ANSWER) throw new ReplayTrackError(HEADER_ANSWER);
    return HEADER_ANSWER;
  },
  windowLoader: () => (k: number) =>
    HELD.has(k)
      ? new Promise<TrackWindow>((resolve, reject) => {
          held.push({ k, resolve, reject });
        })
      : Promise.resolve(fixtureWindow(k)),
}));

let MINIMAP: string | null = "asset://minimap.png";
/** What the unitsync heightmap hook answers: null for a map with none. */
let HEIGHTMAP: { width: number; height: number } | null = {
  width: 513,
  height: 385,
};
vi.mock("../../config", () => ({
  useUnitsyncMinimap: () => ({ url: MINIMAP, loading: false }),
  useUnitsyncHeightmap: () => ({
    data: HEIGHTMAP,
    url: HEIGHTMAP ? "asset://height.png" : null,
    range: undefined,
    loading: false,
  }),
  useUnitsyncMapSkybox: () => ({ dataUrl: null, loading: false }),
  useScanTargetSelection: () => ({
    selected: { enginePath: "/engine", rootPath: "/data" },
  }),
  useUnitsyncScan: () => ({ data: { games: GAMES }, loading: false }),
  useUnitsyncUnitDataset: () => ({ dataset: null, status: "idle" }),
  useUnitsyncUnitBuildpics: () => ({ units: {}, errors: [] }),
}));
vi.mock("@picoframe/frame", async (orig) => ({
  ...(await orig<typeof import("@picoframe/frame")>()),
  useTheme: () => ({ resolved: "dark" }),
}));
vi.mock("../../usePrimaryPlayer", () => ({ usePrimaryPlayer: () => "" }));
/** The statistics the chart would draw from. None unless a test sets them. */
let TRAILER: DemoTrailer | null = null;
vi.mock("../../useMatchStats", () => ({
  useMatchStats: () => ({
    data: TRAILER ? { trailer: TRAILER, metrics: [] } : null,
    loading: false,
    error: null,
  }),
}));
vi.mock("../../../mapconv/pages/components/MapPreview3D", () => ({
  MapPreview3D: () => <div data-testid="preview-3d" />,
}));

/** The installed games, and the start boxes a Zero-K file gives (#5313). */
let GAMES: GameItem[] = [];
let STARTBOXES: StartBoxConfig | null = null;
const startBoxesAsked = vi.fn();

/** What the replay file holds, and what the analysis logged. */
let CHAT: {
  messages: ChatLine[];
  incomplete: boolean;
  events: TimelineEvent[];
};
let LOGGED: { kind: string; frame: number }[] = [];
/** The build orders the replay holds, for the layers that draw them. */
let ORDERS: unknown = {
  orders: [],
  players: [],
  removals: 0,
  lastFrame: 0,
  incomplete: false,
};

vi.mock("../../bindings", async () => {
  const actual =
    await vi.importActual<Record<string, unknown>>("../../bindings");
  return {
    ...actual,
    contentReplayTracks: async () => {
      throw new Error("seeded in the test");
    },
    contentStartBoxes: async (args: unknown) => {
      startBoxesAsked(args);
      return { config: STARTBOXES };
    },
    contentDemoChat: async () => CHAT,
    contentDemoBuildOrders: async () => ORDERS,
    contentReplayAnalysisEvents: async (args: { kinds?: string[] }) => ({
      events: LOGGED.filter((e) => !args.kinds || args.kinds.includes(e.kind)),
    }),
  };
});

vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: async () => {} }));

/** The profile's hidden keys. */
let HIDE: string[] = [];
vi.mock("../../../profile/profile", async (orig) => ({
  ...(await orig<typeof import("../../../profile/profile")>()),
  getProfile: () => ({ version: 1, hide: HIDE }),
}));

/** What the open-in-engine button reaches for: the running state, the launch
 *  and the engine the replay page resolves for Watch. */
let RUNNING = false;
let LAUNCH: (opts: Record<string, unknown>) => Promise<unknown>;
const launches: Record<string, unknown>[] = [];
vi.mock("../../../play/PlayProvider", () => ({
  usePlay: () => ({
    running: RUNNING,
    launchReplayPlayback: (opts: Record<string, unknown>) => LAUNCH(opts),
  }),
}));
vi.mock("../../../play/LaunchContentProvider", () => ({
  useLaunchContent: () => ({
    ensureContent: async () => ({
      ready: true,
      target: { executable: "/downloaded/spring", dataDir: "/downloaded" },
    }),
  }),
}));
vi.mock("../../../play/config", () => ({
  useReplayTarget: () => ({
    resolved: {
      matched: true,
      target: { executable: "/engine/spring", dataDir: "/data" },
    },
  }),
}));

const { resetReplayBuildOrders } = await import("../../useReplayBuildOrders");
const { ReplayMapCard } = await import("./ReplayMapCard");
const { ReplayTimelineDock, TimelineKeysProvider } = await import(
  "./ReplayTimelineDock"
);
const { MatchClockProvider, useMatchClock, useMatchFrame, useSettledFrame } =
  await import("../../useMatchClock");
const { SeriesEmphasisProvider, useSeriesEmphasis } = await import(
  "../../useSeriesEmphasis"
);
const { ANALYSIS_ACTION_ATTRIBUTE, ANALYSIS_SECTION_ID } = await import(
  "../../replayAnalysis"
);

const info = {
  gameId: ID,
  mapName: "Test Map",
  remixed: false,
  engineVersion: "105.1.1-2511-g4d1de6d",
  // The fixture track is 150 frames, which is 5 seconds.
  durationSec: 5,
  // What the flat map reads of a match.
  gameType: "Some Game 1.0",
  winningAllyTeams: [],
  winnersKnown: false,
  players: [],
  ais: [],
  allyTeams: [],
  modOptions: {},
  startPositions: [],
} as unknown as DemoInfo;

const track = (state: StoredReplayTrack["state"]): StoredReplayTrack => ({
  gameId: ID,
  state,
  sizeBytes: 1000,
  lastWatchedMs: 1,
});

/** Animation frames, run by hand. */
const raf = {
  waiting: new Map<number, FrameRequestCallback>(),
  next: 1,
  asked: 0,
  /** The stamp of the last run: animation frames never go back in time. */
  last: 0,
  run(
    this: { last: number; waiting: Map<number, FrameRequestCallback> },
    stamp = this.last,
  ) {
    this.last = stamp;
    const due = [...this.waiting.values()];
    this.waiting.clear();
    for (const cb of due) cb(stamp);
  },
};

/** What a test adds to the replay's info, such as who played. */
let INFO_OVER: Partial<DemoInfo> = {};

/** What the page hands the section about launching. */
let WATCH: ReplayWatch;
let BLOCK: string | null;
let GAME: string | undefined;

let ctx: ReturnType<typeof recordingContext>;
let onScreen: ((entries: { isIntersecting: boolean }[]) => void) | undefined;
let hidden = false;

beforeEach(() => {
  HEADER_ANSWER = HEADER;
  TRAILER = null;
  INFO_OVER = {};
  GAMES = [];
  STARTBOXES = null;
  startBoxesAsked.mockClear();
  RUNNING = false;
  launches.length = 0;
  LAUNCH = async (opts) => {
    launches.push(opts);
    return { exitCode: 0, signal: null };
  };
  WATCH = { kind: "recorded" };
  BLOCK = null;
  GAME = undefined;
  HELD = new Set();
  held.length = 0;
  headerReads.length = 0;
  HELD_HEADER = false;
  headerReleases.length = 0;
  MINIMAP = "asset://minimap.png";
  HEIGHTMAP = { width: 513, height: 385 };
  HIDE = [];
  hidden = false;
  onScreen = undefined;
  CHAT = { messages: [], incomplete: false, events: [] };
  LOGGED = [];
  resetReplayAnalysisForTests();
  resetReplayEventReadsForTests();
  raf.waiting.clear();
  raf.last = 0;
  raf.asked = 0;
  ctx = recordingContext();
  resetReplayTracksForTests();

  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    raf.asked++;
    raf.waiting.set(raf.next, cb);
    return raf.next++;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => {
    raf.waiting.delete(id);
  });
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(cb: (entries: { isIntersecting: boolean }[]) => void) {
        onScreen = cb;
      }
      observe() {}
      disconnect() {}
    },
  );
  Object.defineProperty(document, "hidden", {
    configurable: true,
    get: () => hidden,
  });
  // A canvas 1,024 by 768 CSS pixels at the page's corner, for the fixture's
  // 8,192 by 6,144 elmo map: an eighth of a pixel for each elmo.
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    left: 0,
    top: 0,
    right: 1024,
    bottom: 768,
    width: 1024,
    height: 768,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  });
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
    () => ctx as unknown as CanvasRenderingContext2D,
  );
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** Lets promises settle, then runs the animation frames asked for. */
async function settle() {
  for (let i = 0; i < 3; i++) {
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {
      raf.run();
    });
  }
}

/** Every navigation the router made, to tell a replace from a push. */
const navigations: { action: string; search: string }[] = [];

/** The page's emphasis store, so a test can point at a team the way the roster does. */
let emphasisStore: EmphasisStore;
function GrabStore() {
  emphasisStore = useSeriesEmphasis().store;
  return null;
}

/** The chart's In-game colours switch, which is a stored choice the page reads. */
let setColourMode: (mode: ChartColorMode) => void;
function GrabColourMode() {
  setColourMode = useStoredColorMode()[1];
  return null;
}

/**
 * The page as the replay page has it: one match clock and one set of keys over
 * the map and the dock, which sits under it.
 */
function Page({
  remixed = false,
  durationSec = 5,
  children,
}: {
  remixed?: boolean;
  durationSec?: number;
  children?: React.ReactNode;
}) {
  const shown = { ...info, ...INFO_OVER, remixed } as DemoInfo;
  return (
    <SeriesEmphasisProvider>
      <MatchClockProvider durationSec={durationSec}>
        <TimelineKeysProvider>
          <ReplayMapCard
            info={shown}
            replayPath="/replays/a.sdfz"
            enginePath="/engine"
            dataDir="/data"
          />
          <ReplayTimelineDock
            info={shown}
            replayPath="/replays/a.sdfz"
            showStats
            watch={WATCH}
            dependencyBlock={BLOCK}
            game={GAME}
          />
          <GrabStore />
          <GrabColourMode />
          {children}
        </TimelineKeysProvider>
      </MatchClockProvider>
    </SeriesEmphasisProvider>
  );
}

function mount(url: string, remixed = false, durationSec = 5) {
  const router = createMemoryRouter(
    [
      {
        path: "*",
        element: <Page remixed={remixed} durationSec={durationSec} />,
      },
    ],
    { initialEntries: [url] },
  );
  router.subscribe((state) => {
    navigations.push({
      action: state.historyAction,
      search: state.location.search,
    });
  });
  return { router, ...render(<RouterProvider router={router} />) };
}

async function show(
  state: StoredReplayTrack["state"] | null = "current",
  url = "/replay",
) {
  if (state) seedReplayTracksForTests([track(state)]);
  navigations.length = 0;
  const view = mount(url);
  await settle();
  return view;
}

/** Moves the temporary slider with its own keys, as a keyboard user would. */
async function press(key: string, times = 1) {
  const thumb = screen.getByRole("slider", { name: "Time in the match" });
  for (let i = 0; i < times; i++) fireEvent.keyDown(thumb, { key });
  await settle();
}

const pictures = () => ctx.count("clearRect");
const canvas = () =>
  document.querySelector("canvas[data-layer='recorded-units']") as HTMLElement;

describe("when there is nothing to draw", () => {
  it("shows no map for a replay with no track", async () => {
    await show(null);
    expect(screen.queryByRole("group", { name: "Recorded match" })).toBeNull();
    expect(screen.queryByText("Recorded match")).toBeNull();
    expect(headerReads).toEqual([]);
  });

  it("shows no map for a remix, which has no track of its own", async () => {
    seedReplayTracksForTests([track("current")]);
    mount("/replay", true);
    await settle();
    expect(screen.queryByRole("group", { name: "Recorded match" })).toBeNull();
    expect(headerReads).toEqual([]);
  });

  it("says a stale track is not shown, does not read it, and leads to the button that records", async () => {
    // The analysis and recording section, as the page has it above the view:
    // its help button, then the button that asks for a run.
    const section = document.createElement("section");
    section.id = ANALYSIS_SECTION_ID;
    const record = document.createElement("button");
    record.setAttribute(ANALYSIS_ACTION_ATTRIBUTE, "");
    section.append(document.createElement("button"), record);
    document.body.append(section);

    await show("stale");
    expect(headerReads).toEqual([]);
    expect(document.querySelector("canvas")).toBeNull();
    screen.getByText(/has to be recorded again/);
    fireEvent.click(screen.getByRole("button", { name: "Go to recording" }));
    expect(document.activeElement).toBe(record);
    section.remove();
  });

  it.each<[ReplayTrackFault, RegExp]>([
    [
      { kind: "stale", recorderVersion: 2, current: 3 },
      /has to be recorded again/,
    ],
    [{ kind: "missing" }, /no longer on this computer/],
    [{ kind: "otherGame" }, /belongs to another match/],
    [
      { kind: "unknownFormat", field: "version", found: "2", expected: "1" },
      /its version is 2 and this version of coilbox reads 1/,
    ],
    [
      { kind: "unreadable", message: "the info chunk is corrupt" },
      /could not be read\. The info chunk is corrupt\./,
    ],
    [
      { kind: "io", message: "permission denied" },
      /could not be read\. Permission denied\./,
    ],
  ])("says why a track that answers %j is not shown", async (fault, words) => {
    HEADER_ANSWER = fault;
    await show();
    expect(document.querySelector("canvas")).toBeNull();
    screen.getByText(words);
    screen.getByRole("button", { name: "Go to recording" });
  });

  it("draws on plain ground of the map's proportions when the map has no picture", async () => {
    MINIMAP = null;
    await show();
    expect(document.querySelector("img")).toBeNull();
    const ground = document.querySelector("[data-map-ground]") as HTMLElement;
    expect(ground.style.aspectRatio).toBe("8192 / 6144");
    screen.getByText(/picture of this map is not available/);
    // The units are still drawn.
    expect(pictures()).toBe(1);
  });
});

describe("a current track", () => {
  it("is drawn over the map's picture, at the map's proportions", async () => {
    await show();
    const img = screen.getByAltText("Minimap of Test Map") as HTMLImageElement;
    expect(img.getAttribute("src")).toBe("asset://minimap.png");
    const ground = document.querySelector("[data-map-ground]") as HTMLElement;
    expect(ground.style.aspectRatio).toBe("8192 / 6144");
    expect(canvas()).not.toBeNull();
    expect(headerReads).toEqual([ID]);
  });

  it("draws a mark for each live unit as the time moves, and says how many", async () => {
    await show();
    // Frame 0: unit 0 alone.
    expect(ctx.count("closePath")).toBe(1);
    screen.getByText("1 unit, 0 projectiles, 0 wrecks");

    // Three pages of ten frames: frame 30, where unit 1 and a projectile are.
    await press("PageUp", 3);
    const at30 = fixture.alive.find((a) => a.frame === 30);
    expect(at30).toEqual({ frame: 30, units: 2, projectiles: 1 });
    screen.getByText("2 units, 1 projectile, 0 wrecks");

    // The last frame: unit 0 alone again, and the wreck that came at 40.
    const before = ctx.count("closePath");
    await press("End");
    expect(ctx.count("closePath") - before).toBe(1);
    screen.getByText("1 unit, 0 projectiles, 1 wreck");
  });

  it("names the unit under the pointer with whose it is, and forgets it when the pointer leaves", async () => {
    await show();
    await press("PageUp", 3);
    // Unit 1 is an armpw of team 1 at 3000, 2000 elmos: 375, 250 on the canvas.
    fireEvent.pointerMove(canvas(), { clientX: 375, clientY: 250 });
    await settle();
    const named = screen.getByTestId("recorded-unit-name");
    expect(named.textContent).toBe("armpw, Bot (AI), Team 2");
    // The unit is ringed on the canvas.
    expect(ctx.count("arc")).toBe(1);

    // Unit 0, an armcom of team 0, is elsewhere.
    fireEvent.pointerMove(canvas(), { clientX: 600, clientY: 600 });
    await settle();
    expect(screen.getByTestId("recorded-unit-name").textContent).toBe("");

    fireEvent.pointerMove(canvas(), { clientX: 375, clientY: 250 });
    fireEvent.pointerLeave(canvas());
    await settle();
    expect(screen.getByTestId("recorded-unit-name").textContent).toBe("");
  });

  it("keeps a unit named after a click, for a pointer that cannot hover", async () => {
    await show();
    await press("PageUp", 3);
    fireEvent.click(canvas(), { clientX: 375, clientY: 250 });
    fireEvent.pointerLeave(canvas());
    await settle();
    expect(screen.getByTestId("recorded-unit-name").textContent).toBe(
      "armpw, Bot (AI), Team 2",
    );
    // A click on empty ground lets it go.
    fireEvent.click(canvas(), { clientX: 600, clientY: 600 });
    await settle();
    expect(screen.getByTestId("recorded-unit-name").textContent).toBe("");
  });

  it("stops asking for frames while the document is hidden, and draws when it is seen again", async () => {
    await show();
    const [drawn, asked] = [pictures(), raf.asked];
    hidden = true;
    document.dispatchEvent(new Event("visibilitychange"));
    await press("PageUp", 3);
    expect(raf.asked).toBe(asked);
    expect(pictures()).toBe(drawn);

    hidden = false;
    document.dispatchEvent(new Event("visibilitychange"));
    await settle();
    expect(pictures()).toBe(drawn + 1);
    screen.getByText("2 units, 1 projectile, 0 wrecks");
  });

  it("stops asking for frames while it is scrolled out of view", async () => {
    await show();
    const [drawn, asked] = [pictures(), raf.asked];
    act(() => onScreen?.([{ isIntersecting: false }]));
    await press("PageUp", 3);
    expect(raf.asked).toBe(asked);
    expect(pictures()).toBe(drawn);
    act(() => onScreen?.([{ isIntersecting: true }]));
    await settle();
    expect(pictures()).toBe(drawn + 1);
  });

  it("asks for no frame while nothing changes", async () => {
    await show();
    const asked = raf.asked;
    await settle();
    await settle();
    expect(raf.asked).toBe(asked);
  });

  it("keeps the last picture and says it is loading while a window is on its way", async () => {
    HELD = new Set([2]);
    await show();
    await press("PageUp", 3);
    const calls = ctx.calls.length;
    expect(screen.queryByRole("status", { name: /Loading/ })).toBeNull();

    // The last frame is in window 2, which has not arrived.
    await press("End");
    expect(ctx.calls.length).toBe(calls);
    screen.getByRole("status", { name: "Loading this part of the match" });
    // What the picture still shows is what the count still says.
    screen.getByText("2 units, 1 projectile, 0 wrecks");

    await act(async () => {
      for (const h of held) h.resolve(fixtureWindow(h.k));
    });
    await settle();
    expect(screen.queryByRole("status", { name: /Loading/ })).toBeNull();
    screen.getByText("1 unit, 0 projectiles, 1 wreck");
  });

  it("says a window cannot be read over the map, and still draws the rest of the match", async () => {
    HELD = new Set([2]);
    await show();
    await press("End");
    await act(async () => {
      for (const h of held) {
        h.reject(
          new ReplayTrackError({
            kind: "corruptWindow",
            window: 2,
            message: "its checksum is wrong",
          }),
        );
      }
    });
    await settle();
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toMatch(/This part of the match cannot be read/);
    expect(alert.textContent).toMatch(/window 2 cannot be read/i);

    await press("Home");
    expect(screen.queryByRole("alert")).toBeNull();
    screen.getByText("1 unit, 0 projectiles, 0 wrecks");
  });

  it("passes no typed array or buffer to any component as a prop", async () => {
    const { container } = await show();
    await press("PageUp", 3);
    fireEvent.pointerMove(canvas(), { clientX: 375, clientY: 250 });
    await settle();

    /** Every typed array or buffer reachable from a value through plain data. */
    function typedArraysIn(
      value: unknown,
      seen = new Set<unknown>(),
    ): string[] {
      if (value === null || typeof value !== "object") return [];
      if (seen.has(value)) return [];
      seen.add(value);
      if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) {
        return ["<value>"];
      }
      // A DOM node, or React's own bookkeeping on an element.
      if (value instanceof Node) return [];
      return Object.entries(value).flatMap(([key, inner]) =>
        key.startsWith("_")
          ? []
          : typedArraysIn(inner, seen).map((path) => `${key}.${path}`),
      );
    }
    // The check finds one when there is one.
    expect(typedArraysIn({ a: { b: new Float32Array(1) } })).toEqual([
      "a.b.<value>",
    ]);

    type Fiber = {
      memoizedProps: unknown;
      child: Fiber | null;
      sibling: Fiber | null;
      type: unknown;
    };
    const rootKey = Object.keys(container).find((k) =>
      k.startsWith("__reactContainer$"),
    );
    expect(rootKey).toBeDefined();
    const root = (container as unknown as Record<string, Fiber>)[
      rootKey as string
    ];
    const found: string[] = [];
    let components = 0;
    const walk = (fiber: Fiber | null) => {
      for (let f = fiber; f; f = f.sibling) {
        if (typeof f.type === "function" || typeof f.type === "object") {
          components++;
        }
        found.push(...typedArraysIn(f.memoizedProps));
        walk(f.child);
      }
    };
    walk(root);
    // The walk reached the view's own components and its canvas.
    expect(components).toBeGreaterThan(3);
    expect(found).toEqual([]);
  });
});

// ---- the timeline (#3808) ---------------------------------------------------

import type { ReplayClock } from "../../replayMapView/clock";

const hook = () =>
  (
    canvas() as unknown as {
      __replayMapView: {
        clock: ReplayClock;
        handle: { heldWindows(): number[] };
      };
    }
  ).__replayMapView;
const clockFrame = () => hook().clock.frame;
const view = () => screen.getByRole("group", { name: "Recorded match" });

/** Runs animation frames at a time stamp, as the browser would. */
async function frameAt(stamp: number) {
  await act(async () => {
    raf.run(stamp);
  });
}

const click = (name: string | RegExp) =>
  act(async () => {
    fireEvent.click(screen.getByRole("button", { name }));
  });

const key = (
  target: Element,
  name: string,
  init: Partial<KeyboardEventInit> = {},
) => fireEvent.keyDown(target, { key: name, ...init });

/**
 * Where the last picture put each unit, as the centre of its outline: the mean
 * of the four corners the painter walked.
 */
function drawnCentres(): [number, number][] {
  const calls = ctx.calls;
  const from = calls.map((c) => c.op).lastIndexOf("clearRect");
  const centres: [number, number][] = [];
  let corners: number[][] = [];
  for (const call of calls.slice(from)) {
    if (call.op === "moveTo") corners = [call.args];
    else if (call.op === "lineTo") corners.push(call.args);
    else if (call.op === "closePath" && corners.length === 4) {
      centres.push([
        corners.reduce((n, c) => n + c[0], 0) / 4,
        corners.reduce((n, c) => n + c[1], 0) / 4,
      ]);
    }
  }
  return centres;
}

/** Where the fixture puts a unit at a frame, on the 1,024 pixel canvas. */
function fixtureCentre(serial: number, frame: number): [number, number] {
  const at = fixture.transform.find(
    (t) => t.serial === serial && t.frame === frame,
  );
  if (!at) throw new Error(`the fixture has no unit ${serial} at ${frame}`);
  return [at.x * 0.125, at.z * 0.125];
}

describe("the timeline's controls", () => {
  it("names the knob, which is what a screen reader lands on", async () => {
    await show();
    const knob = screen.getByRole("slider", { name: "Time in the match" });
    expect(knob.getAttribute("aria-valuenow")).toBe("0");
    expect(knob.getAttribute("aria-valuetext")).toBe("0:00");
  });

  it("names every control, and gives the icon buttons a tooltip name", async () => {
    await show();
    for (const name of ["Play", "Play in reverse"]) {
      screen.getByRole("button", { name });
    }
    screen.getByRole("combobox", { name: "Playback speed" });
    expect(screen.getByTestId("match-clock").textContent).toBe("0:00 / 0:05");
  });

  it("lists the keys in the section's help", async () => {
    await show();
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "About the recorded match" }),
      );
    });
    screen.getByText("Play or pause");
    screen.getByText("Back 1 second");
    screen.getByText("Go to the next mark");
  });
});

describe("opening a link with a time", () => {
  it("shows that moment: the clock, the knob and the units", async () => {
    await show("current", "/replay?frame=60");
    expect(clockFrame()).toBe(60);
    expect(
      screen
        .getByRole("slider", { name: "Time in the match" })
        .getAttribute("aria-valuenow"),
    ).toBe("60");
    expect(screen.getByTestId("match-clock").textContent).toBe("0:02 / 0:05");
    const [x, z] = fixtureCentre(0, 60);
    const centres = drawnCentres();
    expect(centres).toHaveLength(2);
    expect(centres.some(([cx, cz]) => Math.hypot(cx - x, cz - z) < 1e-3)).toBe(
      true,
    );
    // Opening is not a seek: the address is left as it came.
    expect(navigations).toEqual([]);
  });

  it.each([
    ["9999", 150],
    ["-20", 0],
    ["soon", 0],
    ["", 0],
  ])("holds a time of %j to the match, at frame %j", async (value, frame) => {
    await show("current", `/replay?frame=${value}`);
    expect(clockFrame()).toBe(frame);
  });

  it("shows no map for a replay with no track, and leaves the address as it came", async () => {
    await show(null, "/replay?frame=60");
    expect(canvas()).toBeNull();
    expect(navigations).toEqual([]);
  });
});

describe("playing", () => {
  it("advances by elapsed time times speed times the track's frames per second", async () => {
    await show("current", "/replay?frame=20");
    await click("Play");
    await frameAt(5000);
    await frameAt(6000);
    expect(clockFrame()).toBe(50);
    expect(hook().clock.direction).toBe(1);

    // The speed control and the key say the same thing.
    key(view(), "=");
    await settle();
    screen.getByRole("combobox", { name: "Playback speed" });
    expect(
      screen.getByRole("combobox", { name: "Playback speed" }).textContent,
    ).toContain("2x");
    await frameAt(6500);
    expect(clockFrame()).toBe(80);
  });

  it("stops at the last frame, asks for no more frames, and replaces the address once", async () => {
    await show("current", "/replay?frame=100");
    await click("Play");
    await frameAt(0);
    await frameAt(500);
    await frameAt(600_000);
    expect(clockFrame()).toBe(150);
    await settle();
    screen.getByRole("button", { name: "Play" });
    expect(raf.waiting.size).toBe(0);
    expect(navigations).toEqual([{ action: "REPLACE", search: "?frame=150" }]);
  });

  it("stops the loop when paused", async () => {
    await show();
    await click("Play");
    await frameAt(0);
    await frameAt(1000);
    expect(clockFrame()).toBe(30);
    await click("Pause");
    await settle();
    expect(raf.waiting.size).toBe(0);
    await frameAt(9000);
    expect(clockFrame()).toBe(30);
  });

  it("plays in reverse, moving units backward along their paths", async () => {
    await show("current", "/replay?frame=90");
    const [x90, z90] = fixtureCentre(0, 90);
    expect(
      drawnCentres().some(([cx, cz]) => Math.hypot(cx - x90, cz - z90) < 1e-3),
    ).toBe(true);

    await click("Play in reverse");
    await frameAt(10_000);
    await frameAt(11_000);
    // A second of real time at 1x is 30 frames of the track.
    expect(clockFrame()).toBe(60);
    // The direction the view is given, so it holds the window before.
    expect(hook().clock.direction).toBe(-1);

    await click("Pause");
    await settle();
    expect(hook().handle.heldWindows()).toEqual([0, 1]);
    const [x60, z60] = fixtureCentre(0, 60);
    expect(x60).toBeLessThan(x90);
    expect(
      drawnCentres().some(([cx, cz]) => Math.hypot(cx - x60, cz - z60) < 1e-3),
    ).toBe(true);
  });

  it("stops at the first frame when playing in reverse", async () => {
    await show("current", "/replay?frame=20");
    await click("Play in reverse");
    await frameAt(0);
    await frameAt(60_000);
    expect(clockFrame()).toBe(0);
    expect(hook().clock.direction).toBe(-1);
    await settle();
    expect(raf.waiting.size).toBe(0);
    screen.getByRole("button", { name: "Play in reverse" });
  });

  it("stops when the document is hidden, and does not jump ahead when it returns", async () => {
    await show();
    await click("Play");
    await frameAt(0);
    await frameAt(1000);
    expect(clockFrame()).toBe(30);

    hidden = true;
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    screen.getByRole("button", { name: "Play" });
    await frameAt(900_000);
    expect(clockFrame()).toBe(30);

    hidden = false;
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await frameAt(1_800_000);
    expect(clockFrame()).toBe(30);
  });

  it("cancels its animation frame when the component unmounts", async () => {
    const { unmount } = await show();
    await click("Play");
    await frameAt(0);
    expect(raf.waiting.size).toBeGreaterThan(0);
    unmount();
    expect(raf.waiting.size).toBe(0);
  });
});

describe("dragging the knob", () => {
  const dragTo = (x: number) =>
    fireEvent.pointerMove(knobRoot(), { clientX: x, pointerId: 1 });
  const knobRoot = () =>
    document.querySelector("[data-slot='slider']") as HTMLElement;

  beforeEach(() => {
    const held = new Set<number>();
    vi.spyOn(Element.prototype, "setPointerCapture").mockImplementation(
      (id) => void held.add(id),
    );
    vi.spyOn(Element.prototype, "hasPointerCapture").mockImplementation((id) =>
      held.has(id),
    );
    vi.spyOn(Element.prototype, "releasePointerCapture").mockImplementation(
      (id) => void held.delete(id),
    );
  });

  it("calls clock.set for each pointer move before the move returns", async () => {
    await show();
    const set = vi.spyOn(hook().clock, "set");
    fireEvent.pointerDown(knobRoot(), {
      clientX: 0,
      pointerId: 1,
      button: 0,
    });
    for (const [i, x] of [256, 512, 768].entries()) {
      dragTo(x);
      // Not after a settle: the clock has moved already.
      const lastTarget = set.mock.calls[set.mock.calls.length - 1][0];
      expect(set.mock.calls.length).toBeGreaterThanOrEqual(i + 1);
      expect(lastTarget).toBe(Math.round((x / 1024) * 150));
    }
    expect(clockFrame()).toBe(Math.round((768 / 1024) * 150));
  });

  it("keeps the knob under the pointer while the window it asks for is loading", async () => {
    HELD = new Set([2]);
    await show();
    fireEvent.pointerDown(knobRoot(), { clientX: 0, pointerId: 1, button: 0 });
    dragTo(1024);
    await settle();
    expect(
      screen
        .getByRole("slider", { name: "Time in the match" })
        .getAttribute("aria-valuenow"),
    ).toBe("150");
    // The picture is the last one, and the view says it is loading.
    screen.getByRole("status", { name: "Loading this part of the match" });
  });

  it("stops a match that is playing, and leaves the address alone until the drag ends", async () => {
    await show();
    await click("Play");
    await frameAt(0);
    fireEvent.pointerDown(knobRoot(), { clientX: 0, pointerId: 1, button: 0 });
    dragTo(256);
    dragTo(512);
    screen.getByRole("button", { name: "Play" });
    expect(navigations).toEqual([]);

    fireEvent.pointerUp(knobRoot(), { clientX: 512, pointerId: 1 });
    await settle();
    expect(navigations).toEqual([
      { action: "REPLACE", search: `?frame=${Math.round((512 / 1024) * 150)}` },
    ]);
  });
});

describe("the address", () => {
  it("is replaced and not added to, only when playing stops and not on a tick", async () => {
    await show("current", "/replay?other=1&frame=10");
    await click("Play");
    for (const stamp of [0, 100, 200, 300, 400, 500]) await frameAt(stamp);
    expect(navigations).toEqual([]);

    await click("Pause");
    expect(navigations).toHaveLength(1);
    expect(navigations[0].action).toBe("REPLACE");
    // 500 ms at 1x is 15 frames from frame 10, and the rest of the address stays.
    expect(navigations[0].search).toBe("?other=1&frame=25");
  });
});

describe("the keys", () => {
  it("each does its job while focus is in the view", async () => {
    await show("current", "/replay?frame=60");
    const v = view();

    key(v, "ArrowRight");
    expect(clockFrame()).toBe(90);
    key(v, "ArrowLeft");
    expect(clockFrame()).toBe(60);
    key(v, "ArrowRight", { shiftKey: true });
    expect(clockFrame()).toBe(150);
    key(v, "ArrowLeft", { shiftKey: true });
    expect(clockFrame()).toBe(0);
    key(v, ".");
    expect(clockFrame()).toBe(1);
    key(v, ",");
    expect(clockFrame()).toBe(0);
    key(v, "End");
    expect(clockFrame()).toBe(150);
    key(v, "Home");
    expect(clockFrame()).toBe(0);

    // Speed: down and up the list.
    key(v, "=");
    key(v, "+", { shiftKey: true });
    await settle();
    expect(
      screen.getByRole("combobox", { name: "Playback speed" }).textContent,
    ).toContain("4x");
    key(v, "-");
    await settle();
    expect(
      screen.getByRole("combobox", { name: "Playback speed" }).textContent,
    ).toContain("2x");

    // Space plays and pauses, R plays the other way.
    key(v, " ");
    await settle();
    screen.getByRole("button", { name: "Pause" });
    key(v, " ");
    await settle();
    screen.getByRole("button", { name: "Play" });
    key(v, "r");
    await settle();
    expect(hook().clock.direction).toBe(-1);
    // The reverse button is the one that now says Pause.
    screen.getByRole("button", { name: "Play" });
    key(v, "r");
    await settle();
    screen.getByRole("button", { name: "Play in reverse" });
  });

  it("does not act on a key from a text field, or from outside the view", async () => {
    await show("current", "/replay?frame=60");
    const field = document.createElement("input");
    field.type = "text";
    view().append(field);
    key(field, "ArrowRight");
    key(field, " ");
    key(field, "End");
    expect(clockFrame()).toBe(60);
    screen.getByRole("button", { name: "Play" });

    key(document.body, "ArrowRight");
    key(document.body, " ");
    expect(clockFrame()).toBe(60);
    screen.getByRole("button", { name: "Play" });
    field.remove();
  });

  it("leaves Space to a button that has focus", async () => {
    await show("current", "/replay?frame=60");
    key(screen.getByRole("button", { name: "Play in reverse" }), " ");
    await settle();
    // The button's own click would have started it. The key did not.
    screen.getByRole("button", { name: "Play" });
    expect(raf.waiting.size).toBe(0);
  });

  it("does not take a key held with a command modifier", async () => {
    await show("current", "/replay?frame=60");
    key(view(), "ArrowRight", { metaKey: true });
    key(view(), "r", { ctrlKey: true });
    expect(clockFrame()).toBe(60);
  });

  it("steps one second from the knob and not also by its own step", async () => {
    await show("current", "/replay?frame=60");
    key(
      screen.getByRole("slider", { name: "Time in the match" }),
      "ArrowRight",
    );
    expect(clockFrame()).toBe(90);
  });
});

describe("the lanes of the dock", () => {
  const analysed = () =>
    seedReplayAnalysisForTests({
      analyses: [
        {
          gameId: ID,
          state: "current",
          analysedAtMs: 1,
          loggerVersion: 1,
        } as unknown as StoredReplayAnalysis,
      ],
    });
  const kills = (frames: number[]) =>
    frames.map((frame) => ({ kind: "unit_destroyed", frame }));
  const line = (
    frame: number,
    text: string,
    over: Partial<ChatLine> = {},
  ): ChatLine =>
    ({
      frame,
      time: 0,
      player: 0,
      playerName: "Ann",
      text,
      system: false,
      ...over,
    }) as unknown as ChatLine;
  const event = (
    type: string,
    frame: number,
    over: Record<string, unknown> = {},
  ) =>
    ({
      type,
      frame,
      time: 0,
      player: 1,
      playerName: "Bot",
      ...over,
    }) as unknown as TimelineEvent;
  const lane = (name: string) => screen.getByRole("group", { name });
  /** Where a mark sits across the axis, from its left edge to the right. */
  const leftOf = (button: HTMLElement) => Number.parseFloat(button.style.left);
  /** A mark's centre as a share of the axis, for a frame. 1,024 pixels of axis
   *  in columns of 8 is 128 columns over the 150 frames. */
  const centreOf = (frame: number) =>
    ((Math.min(127, Math.floor((frame / 150) * 128)) + 0.5) / 128) * 100;

  it("shows all three lanes, with no marks in them, for a replay with no events", async () => {
    await show();
    for (const name of ["Kills", "Chat", "Players"]) {
      expect(lane(name).querySelectorAll("button")).toHaveLength(0);
    }
  });

  it("marks kills from the analysis, chat and the players from the file, each in its own lane", async () => {
    analysed();
    LOGGED = kills([100]);
    CHAT = {
      messages: [line(45, "gl hf")],
      incomplete: false,
      events: [event("playerLeft", 120, { reason: { kind: "left" } })],
    };
    await show();
    const kill = screen.getByRole("button", { name: /Unit destroyed, 0:03/ });
    const chat = screen.getByRole("button", {
      name: /Everyone, 0:01: Ann: gl hf/,
    });
    const left = screen.getByRole("button", {
      name: /Bot left the game, 0:04/,
    });
    expect(lane("Kills").contains(kill)).toBe(true);
    expect(lane("Chat").contains(chat)).toBe(true);
    expect(lane("Players").contains(left)).toBe(true);
  });

  it("puts a mark where its frame is on the axis, and presses move the clock there", async () => {
    analysed();
    LOGGED = kills([30, 75, 150]);
    await show();
    const marks = Array.from(lane("Kills").querySelectorAll("button"));
    expect(marks.map(leftOf)).toEqual([
      centreOf(30),
      centreOf(75),
      centreOf(150),
    ]);
    // The middle of the match is the middle of the axis, give or take a column.
    expect(Math.abs(leftOf(marks[1]) - 50)).toBeLessThan(100 / 128);

    for (const [i, frame] of [30, 75, 150].entries()) {
      await act(async () => {
        fireEvent.click(marks[i]);
      });
      expect(clockFrame()).toBe(frame);
    }
    expect(navigations.at(-1)).toEqual({
      action: "REPLACE",
      search: "?frame=150",
    });
  });

  it("draws chat sent before the match at the start of the axis, and says so", async () => {
    CHAT = {
      messages: [line(-1, "hi all"), line(60, "later")],
      incomplete: false,
      events: [],
    };
    await show("current", "/replay?frame=100");
    const early = screen.getByRole("button", {
      name: "Everyone, before the game: Ann: hi all",
    });
    expect(leftOf(early)).toBe(centreOf(0));
    await act(async () => {
      fireEvent.click(early);
    });
    expect(clockFrame()).toBe(0);
  });

  it("tells chat lines apart by colour, and names who each was sent to", async () => {
    CHAT = {
      messages: [
        line(10, "all", { dest: { kind: "everyone" } }),
        line(40, "allies", { dest: { kind: "allies" } }),
        line(70, "spec", { dest: { kind: "spectators" } }),
        line(100, "psst", { dest: { kind: "player", player: 1 } }),
        line(130, "*", { system: true, player: 255, playerName: undefined }),
      ],
      incomplete: false,
      events: [],
    };
    await show();
    const dot = (name: RegExp) =>
      (screen.getByRole("button", { name }).firstElementChild as HTMLElement)
        .className;
    const classes = [
      dot(/^Everyone, 0:00: Ann: all/),
      dot(/^Allies, 0:01: Ann: allies/),
      dot(/^Spectators, 0:02: Ann: spec/),
      dot(/^Whispers, 0:03: Ann: psst/),
      dot(/^System, 0:04/),
    ];
    expect(new Set(classes).size).toBe(5);
  });

  it("holds joining, pausing, resigning, giving away, leaving and a team dying, and leaves out an action it does not name", async () => {
    CHAT = {
      messages: [],
      incomplete: false,
      events: [
        event("joined", 10, { spectator: false }),
        event("paused", 30, { paused: true }),
        event("resigned", 50),
        event("giveAway", 70),
        event("playerLeft", 90, { reason: { kind: "kicked" } }),
        event("teamDied", 110, { players: ["Bot"] }),
        event("other", 130, { action: 9 }),
      ],
    };
    await show();
    const names = Array.from(lane("Players").querySelectorAll("button")).map(
      (b) => b.getAttribute("aria-label"),
    );
    expect(names).toEqual([
      "Bot joined the game, 0:00",
      "Bot paused the game, 0:01",
      "Bot resigned, 0:01",
      "Bot gave away all the units of an army, 0:02",
      "Bot was kicked, 0:03",
      "Bot's army was eliminated, 0:03",
    ]);
  });

  it("says the Kills lane needs the analysis, and keeps the lane, when there is none", async () => {
    LOGGED = kills([30, 100]);
    await show();
    expect(lane("Kills").textContent).toBe("Needs analysis");
    expect(lane("Kills").querySelectorAll("button")).toHaveLength(0);
    // The other lanes do not say it.
    expect(lane("Chat").textContent).toBe("");
  });

  it("does not say the Kills lane needs the analysis when there is one", async () => {
    analysed();
    LOGGED = kills([30]);
    await show();
    expect(screen.queryByText("Needs analysis")).toBeNull();
    expect(lane("Kills").querySelectorAll("button")).toHaveLength(1);
  });

  it("says why a remix has no kills of its own, and shows none", async () => {
    analysed();
    LOGGED = kills([30]);
    seedReplayTracksForTests([track("current")]);
    mount("/replay", true);
    await settle();
    expect(canvas()).toBeNull();
    expect(lane("Kills").textContent).toBe("Needs analysis");
  });

  it("goes to a mark from the keyboard", async () => {
    analysed();
    LOGGED = kills([30, 100]);
    await show();
    key(view(), "]");
    expect(clockFrame()).toBe(30);
    key(view(), "]");
    expect(clockFrame()).toBe(100);
    key(view(), "[");
    expect(clockFrame()).toBe(30);
  });

  describe("team emphasis on the chat lane", () => {
    const seat = (player: number, team: number, spectator = false) => ({
      name: `P${player}`,
      player,
      team,
      spectator,
    });
    const emphasised = (name: RegExp) =>
      screen.getByRole("button", { name }).getAttribute("data-emphasised");
    const original = info.players;
    afterEach(() => {
      (info as { players: unknown }).players = original;
    });

    async function chart() {
      (info as { players: unknown }).players = [
        seat(0, 0),
        seat(1, 1),
        seat(2, 2, true),
      ];
      CHAT = {
        messages: [
          line(20, "from zero", { player: 0 }),
          line(50, "from one", { player: 1 }),
          line(80, "from spec", { player: 2 }),
          line(110, "from server", { player: 255 }),
          line(140, "from nobody", { player: 9 }),
        ],
        incomplete: false,
        events: [],
      };
      await show();
      act(() => emphasisStore.setPlot({ charted: [0, 1], resting: null }));
    }

    it("lights the pointed team's marks and dims the other team's", async () => {
      await chart();
      act(() => emphasisStore.hover([0]));
      expect(emphasised(/from zero/)).toBe("true");
      expect(emphasised(/from one/)).toBe("false");
      expect(
        screen.getByRole("button", { name: /from one/ }).className,
      ).toContain("opacity-40");
    });

    it("leaves spectator, server and unnumbered marks as they are", async () => {
      await chart();
      act(() => emphasisStore.hover([0]));
      for (const name of [/from spec/, /from server/, /from nobody/]) {
        const mark = screen.getByRole("button", { name });
        expect(mark.getAttribute("data-emphasised")).toBeNull();
        expect(mark.className).not.toContain("opacity-40");
      }
    });

    it("lights its team across the page when a mark is pointed at", async () => {
      await chart();
      const mark = screen.getByRole("button", { name: /from one/ });
      fireEvent.pointerEnter(mark, { pointerType: "mouse" });
      expect(emphasisStore.getState().hovered).toEqual([1]);
      fireEvent.pointerLeave(mark);
      expect(emphasisStore.getState().hovered).toBeNull();
    });
  });

  it("says what a mark is when the pointer is on it or the keyboard has moved to it", async () => {
    analysed();
    LOGGED = kills([30]);
    CHAT = { messages: [line(100, "gg")], incomplete: false, events: [] };
    await show();
    const readout = () => screen.getByTestId("timeline-readout").textContent;
    expect(readout()).toBe("");

    const chat = screen.getByRole("button", { name: /gg/ });
    fireEvent.pointerEnter(chat);
    expect(readout()).toBe("Everyone, 0:03: Ann: gg");
    fireEvent.pointerLeave(chat);
    expect(readout()).toBe("");

    key(view(), "]");
    await settle();
    expect(readout()).toBe("Unit destroyed, 0:01");
  });

  it("merges marks that fall in one column into one with a count, that seeks to the earliest", async () => {
    analysed();
    // 128 columns over 150 frames, so three kills at one frame share a column
    // and one at 140 has its own.
    LOGGED = kills([30, 30, 30, 140]);
    await show();
    const merged = screen.getByRole("button", {
      name: "3 units destroyed from 0:01",
    });
    expect(lane("Kills").querySelectorAll("button")).toHaveLength(2);
    await act(async () => {
      fireEvent.click(merged);
    });
    expect(clockFrame()).toBe(30);
  });

  it("draws no more than a mark for each column however many kills there are", async () => {
    analysed();
    LOGGED = kills(Array.from({ length: 5000 }, (_, i) => i % 151));
    await show();
    const buttons = Array.from(lane("Kills").querySelectorAll("button"));
    expect(buttons.length).toBeGreaterThan(0);
    expect(buttons.length).toBeLessThanOrEqual(128);
    const counted = buttons.reduce((n, b) => {
      const m = /^(\d+) units/.exec(b.getAttribute("aria-label") ?? "");
      return n + (m ? Number(m[1]) : 1);
    }, 0);
    expect(counted).toBe(5000);
  });
});

describe("the playhead", () => {
  const head = () => screen.getByTestId("playhead");

  it("is at the match time, on the same axis as the marks", async () => {
    await show("current", "/replay?frame=75");
    expect(head().style.left).toBe("50%");
    await act(async () => {
      hook().clock.set(150);
    });
    expect(head().style.left).toBe("100%");
    await act(async () => {
      hook().clock.set(0);
    });
    expect(head().style.left).toBe("0%");
  });

  it("is inside the box that holds the scrubber and every lane, and no wider", async () => {
    await show();
    const box = head().parentElement as HTMLElement;
    expect(
      box.contains(screen.getByRole("slider", { name: "Time in the match" })),
    ).toBe(true);
    for (const name of ["Kills", "Chat", "Players", "Heat window"]) {
      expect(box.contains(screen.getByRole("group", { name }))).toBe(true);
    }
    expect(box.contains(screen.getByTestId("timeline-axis"))).toBe(false);
  });
});

describe("the dock's place", () => {
  it("is pinned to the bottom of the page, and reads left to right", async () => {
    await show();
    const dock = screen.getByRole("group", { name: "Timeline" });
    expect(dock.className).toContain("sticky");
    expect(dock.className).toContain("bottom-0");
    expect(dock.getAttribute("dir")).toBe("ltr");
  });

  it("has the transport row, the scrubber, the lanes and a time axis", async () => {
    await show();
    const dock = within(screen.getByRole("group", { name: "Timeline" }));
    dock.getByRole("button", { name: "Play" });
    dock.getByRole("combobox", { name: "Playback speed" });
    dock.getByRole("button", { name: "Open in engine" });
    dock.getByTestId("match-clock");
    dock.getByRole("slider", { name: "Time in the match" });
    expect(dock.getByTestId("timeline-axis").textContent).toBe("0:00");
  });
});

describe("a replay with no recording", () => {
  it("still has the dock, with the scrubber and the lanes, and nothing that plays", async () => {
    CHAT = {
      messages: [
        {
          frame: 60,
          time: 2,
          player: 0,
          playerName: "Ann",
          text: "gg",
          system: false,
        } as unknown as ChatLine,
      ],
      incomplete: false,
      events: [],
    };
    await show(null);
    screen.getByRole("slider", { name: "Time in the match" });
    for (const name of ["Kills", "Chat", "Players"]) {
      screen.getByRole("group", { name });
    }
    expect(screen.queryByRole("button", { name: "Play" })).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Play in reverse" }),
    ).toBeNull();
    expect(
      screen.queryByRole("combobox", { name: "Playback speed" }),
    ).toBeNull();
    // The axis is the replay's duration.
    expect(screen.getByTestId("match-clock").textContent).toBe("0:00 / 0:05");
    expect(screen.getByRole("group", { name: "Kills" }).textContent).toBe(
      "Needs analysis",
    );
  });

  it("moves the clock from a mark and from the scrubber's keys, and its play keys do nothing", async () => {
    CHAT = {
      messages: [
        {
          frame: 60,
          time: 2,
          player: 0,
          playerName: "Ann",
          text: "gg",
          system: false,
        } as unknown as ChatLine,
      ],
      incomplete: false,
      events: [],
    };
    await show(null);
    const frame = () =>
      Math.round(
        Number(
          screen
            .getByRole("slider", { name: "Time in the match" })
            .getAttribute("aria-valuenow"),
        ),
      );
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /gg/ }));
    });
    expect(frame()).toBe(60);
    expect(navigations.at(-1)).toEqual({
      action: "REPLACE",
      search: "?frame=60",
    });

    const dock = screen.getByRole("group", { name: "Timeline" });
    key(dock, "ArrowRight");
    expect(frame()).toBe(90);
    key(dock, "Home");
    expect(frame()).toBe(0);
    key(dock, " ");
    key(dock, "r");
    key(dock, "=");
    await settle();
    expect(raf.waiting.size).toBe(0);
    expect(frame()).toBe(0);
  });

  it("has the Open in engine button", async () => {
    await show(null);
    screen.getByRole("button", { name: "Open in engine" });
  });
});

describe("the dock follows the range", () => {
  it("takes the replay's duration until the track is read, then the track's", async () => {
    seedReplayTracksForTests([track("current")]);
    HELD_HEADER = true;
    mount("/replay", false, 600);
    await settle();
    expect(screen.getByTestId("match-clock").textContent).toBe("0:00 / 10:00");
    expect(screen.queryByRole("button", { name: "Play" })).toBeNull();

    HELD_HEADER = false;
    await act(async () => {
      for (const release of headerReleases) release();
    });
    await settle();
    expect(screen.getByTestId("match-clock").textContent).toBe("0:00 / 0:05");
    screen.getByRole("button", { name: "Play" });
  });
});

describe("opening the engine at the moment shown", () => {
  const open = () => screen.getByRole("button", { name: "Open in engine" });
  const setClock = (frame: number) =>
    act(async () => {
      hook().clock.set(frame);
    });

  it("launches the playback paused at the clock's frame, rounded", async () => {
    await show("current", "/replay?frame=20");
    await setClock(87.6);
    fireEvent.click(open());
    await settle();
    expect(launches).toEqual([
      {
        replayPath: "/replays/a.sdfz",
        executable: "/engine/spring",
        dataDir: "/data",
        game: undefined,
        startFrame: 88,
        paused: true,
      },
    ]);
  });

  it("reads the clock and not the address, which lags", async () => {
    const { router } = await show("current", "/replay?frame=20");
    await setClock(61);
    // The address still holds the frame the page opened at.
    expect(router.state.location.search).toBe("?frame=20");
    fireEvent.click(open());
    await settle();
    expect(launches[0]?.startFrame).toBe(61);
  });

  it("rounds down below the half", async () => {
    await show("current", "/replay?frame=20");
    await setClock(40.4);
    fireEvent.click(open());
    await settle();
    expect(launches[0]?.startFrame).toBe(40);
  });

  it("names another installed version of the game when the page does", async () => {
    GAME = "Some Game 1.1";
    await show("current", "/replay?frame=20");
    fireEvent.click(open());
    await settle();
    expect(launches[0]?.game).toBe("Some Game 1.1");
  });

  it("is unavailable while a game is running, and says so", async () => {
    RUNNING = true;
    await show("current", "/replay?frame=20");
    const button = open() as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.title).toBe("A game is already running.");
    fireEvent.click(button);
    await settle();
    expect(launches).toEqual([]);
  });

  it("is unavailable when the replay's game cannot run", async () => {
    BLOCK = "This game needs another archive.";
    await show("current", "/replay?frame=20");
    const button = open() as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.title).toBe("This game needs another archive.");
  });

  it("is unavailable when no engine can run the replay", async () => {
    WATCH = { kind: "none" };
    await show("current", "/replay?frame=20");
    expect((open() as HTMLButtonElement).disabled).toBe(true);
  });

  it("shows the reason when the launch is refused", async () => {
    LAUNCH = async () => {
      throw new Error(
        "this replay has no track yet, so it has to be recorded first",
      );
    };
    await show("current", "/replay?frame=20");
    fireEvent.click(open());
    await settle();
    screen.getByText(/has no track yet/);
    // The button is usable again for another try.
    expect((open() as HTMLButtonElement).disabled).toBe(false);
  });

  it("shows a refusal that is not an Error", async () => {
    LAUNCH = async () => {
      throw "a game is already running";
    };
    await show("current", "/replay?frame=20");
    fireEvent.click(open());
    await settle();
    screen.getByText("a game is already running");
  });

  it("says when the engine exits with a code", async () => {
    LAUNCH = async () => ({ exitCode: 3, signal: null });
    await show("current", "/replay?frame=20");
    fireEvent.click(open());
    await settle();
    screen.getByText("Engine exited with code 3.");
  });

  it("is there when the track is not shown, since the replay still opens", async () => {
    await show("stale");
    expect((open() as HTMLButtonElement).disabled).toBe(false);
  });
});

describe("the page's match clock", () => {
  /** A section elsewhere on the page that reads the clock. */
  const renders = { table: 0 };
  function Elsewhere() {
    const frame = useMatchFrame();
    const { range } = useMatchClock();
    return (
      <span data-testid="elsewhere">
        {`${Math.round(frame)} ${range.source} ${range.firstFrame}-${range.lastFrame}`}
      </span>
    );
  }
  function Table() {
    renders.table++;
    return <span data-testid="table">{Math.round(useSettledFrame())}</span>;
  }

  async function showInPage(url = "/replay") {
    seedReplayTracksForTests([track("current")]);
    navigations.length = 0;
    renders.table = 0;
    const router = createMemoryRouter(
      [
        {
          path: "*",
          element: (
            <Page durationSec={600}>
              <Elsewhere />
              <Table />
            </Page>
          ),
        },
      ],
      { initialEntries: [url] },
    );
    router.subscribe((state) => {
      navigations.push({
        action: state.historyAction,
        search: state.location.search,
      });
    });
    render(<RouterProvider router={router} />);
    await settle();
  }

  const elsewhere = () => screen.getByTestId("elsewhere").textContent;
  const table = () => screen.getByTestId("table").textContent;
  const knobRoot = () =>
    document.querySelector("[data-slot='slider']") as HTMLElement;

  beforeEach(() => {
    const held = new Set<number>();
    vi.spyOn(Element.prototype, "setPointerCapture").mockImplementation(
      (id) => void held.add(id),
    );
    vi.spyOn(Element.prototype, "hasPointerCapture").mockImplementation((id) =>
      held.has(id),
    );
    vi.spyOn(Element.prototype, "releasePointerCapture").mockImplementation(
      (id) => void held.delete(id),
    );
  });

  it("takes the track's range from the replay's duration once the track is read, and opens at the address's time", async () => {
    await showInPage("/replay?frame=60");
    expect(elsewhere()).toBe("60 track 0-150");
    expect(clockFrame()).toBe(60);
    expect(table()).toBe("60");
    expect(navigations).toEqual([]);
  });

  it("shows a seek through the dock to another section", async () => {
    await showInPage();
    fireEvent.pointerDown(knobRoot(), { clientX: 0, pointerId: 1, button: 0 });
    fireEvent.pointerMove(knobRoot(), { clientX: 512, pointerId: 1 });
    await settle();
    const dragged = Math.round((512 / 1024) * 150);
    expect(elsewhere()).toBe(`${dragged} track 0-150`);
    // A drag has not settled until it ends.
    expect(table()).toBe("0");

    fireEvent.pointerUp(knobRoot(), { clientX: 512, pointerId: 1 });
    await settle();
    expect(table()).toBe(String(dragged));
    expect(navigations).toEqual([
      { action: "REPLACE", search: `?frame=${dragged}` },
    ]);
  });

  it("does not render a table on the frames of playback, and gives it the time when it stops", async () => {
    await showInPage("/replay?frame=20");
    await click("Play");
    const before = renders.table;
    for (const stamp of [0, 100, 200, 300, 400, 500]) await frameAt(stamp);
    expect(elsewhere()).toBe("35 track 0-150");
    expect(renders.table).toBe(before);
    expect(table()).toBe("20");

    await click("Pause");
    expect(table()).toBe("35");
  });
});

describe("the map card's modes", () => {
  const radio = (name: string) =>
    screen.getByRole("radio", { name }) as HTMLButtonElement;
  const chosen = () =>
    ["Units", "Heat", "3D"].filter(
      (name) => radio(name).getAttribute("aria-checked") === "true",
    );
  const rail = () => document.querySelector("[data-map-rail]") as HTMLElement;
  const pick = async (name: string) => {
    await act(async () => {
      fireEvent.click(radio(name));
    });
    await settle();
  };

  it("opens on Units when the replay has a current recording", async () => {
    await show();
    expect(chosen()).toEqual(["Units"]);
    expect(canvas()).not.toBeNull();
    expect(radio("Heat").disabled).toBe(false);
    expect(radio("3D").disabled).toBe(false);
    expect(screen.queryByRole("button", { name: "Analyse replay" })).toBeNull();
  });

  it("opens on Heat when it has no recording, with Units disabled and Analyse replay offered", async () => {
    await show(null);
    expect(chosen()).toEqual(["Heat"]);
    expect(radio("Units").disabled).toBe(true);
    expect(radio("Units").parentElement?.title).toBe(
      "Needs a recording of the match.",
    );
    screen.getByRole("button", { name: "Analyse replay" });
    expect(canvas()).toBeNull();
    screen.getByAltText("Minimap of Test Map");
  });

  it("opens on Heat for a recording an older version made, says so, and leads to recording again", async () => {
    await show("stale");
    expect(chosen()).toEqual(["Heat"]);
    expect(radio("Units").disabled).toBe(true);
    screen.getByText(/has to be recorded again/);
    screen.getByRole("button", { name: "Go to recording" });
    expect(screen.queryByRole("button", { name: "Analyse replay" })).toBeNull();
  });

  it("opens on Heat for a remix, which has no recording of its own", async () => {
    seedReplayTracksForTests([track("current")]);
    mount("/replay", true);
    await settle();
    expect(chosen()).toEqual(["Heat"]);
    expect(radio("Units").disabled).toBe(true);
  });

  it("has the Analyse replay button press the analysis section's own button", async () => {
    const section = document.createElement("section");
    section.id = ANALYSIS_SECTION_ID;
    const record = document.createElement("button");
    record.setAttribute(ANALYSIS_ACTION_ATTRIBUTE, "");
    const pressed = vi.fn();
    record.addEventListener("click", pressed);
    section.append(record);
    section.scrollIntoView = vi.fn();
    record.scrollIntoView = vi.fn();
    document.body.append(section);

    await show(null);
    fireEvent.click(screen.getByRole("button", { name: "Analyse replay" }));
    expect(pressed).toHaveBeenCalledTimes(1);

    // A button that cannot be pressed yet is brought into view, so the reasons
    // beside it can be read.
    record.disabled = true;
    fireEvent.click(screen.getByRole("button", { name: "Analyse replay" }));
    expect(pressed).toHaveBeenCalledTimes(1);
    expect(record.scrollIntoView).toHaveBeenCalledTimes(2);
    section.remove();
  });

  it("has no Analyse replay button when the profile hides the run", async () => {
    HIDE = ["analytics.run"];
    await show(null);
    expect(chosen()).toEqual(["Heat"]);
    expect(radio("Units").disabled).toBe(true);
    expect(screen.queryByRole("button", { name: "Analyse replay" })).toBeNull();
  });

  it("puts the count of marks and the unit's name in the rail in Units, and the flat map's layers in Heat", async () => {
    await show();
    expect(within(rail()).getByText(/1 unit, 0 projectiles/)).toBeTruthy();
    expect(within(rail()).getByTestId("recorded-unit-name")).toBeTruthy();
    expect(within(rail()).getByText(/Bot \(AI\), Team 2/)).toBeTruthy();

    await pick("Heat");
    expect(chosen()).toEqual(["Heat"]);
    expect(canvas()).toBeNull();
    const layers = within(rail()).getByRole("toolbar", { name: "Map layers" });
    for (const name of ["Start boxes", "Buildings ordered"]) {
      within(layers).getByRole("button", { name });
    }
    // The base pictures are in the build orders now (#5318).
    expect(within(layers).queryByRole("button", { name: "Bases" })).toBeNull();
  });

  it("shows the 3D view with only the layers that paint on terrain in its rail", async () => {
    await show();
    await pick("3D");
    expect(chosen()).toEqual(["3D"]);
    screen.getByTestId("preview-3d");
    const layers = within(rail()).getByRole("toolbar", { name: "Map layers" });
    expect(
      within(layers)
        .getAllByRole("button")
        .map((b) => b.textContent),
    ).toEqual(["Building density", "Order density", "Deaths", "Damage dealt"]);
  });

  it("disables 3D for a map with no height data", async () => {
    HEIGHTMAP = null;
    await show();
    expect(radio("3D").disabled).toBe(true);
    expect(radio("3D").parentElement?.title).toBe(
      "Needs the map's picture and height data.",
    );
  });

  it("keeps the mode the reader chose when a recording appears", async () => {
    await show(null);
    expect(chosen()).toEqual(["Heat"]);
    await act(async () => {
      seedReplayTracksForTests([track("current")]);
    });
    await settle();
    expect(chosen()).toEqual(["Heat"]);
    expect(radio("Units").disabled).toBe(false);
  });

  it("gives the dock the track's range whichever mode is open", async () => {
    seedReplayTracksForTests([track("current")]);
    mount("/replay", false, 600);
    await settle();
    await pick("Heat");
    expect(chosen()).toEqual(["Heat"]);
    expect(screen.getByTestId("match-clock").textContent).toBe("0:00 / 0:05");
    await pick("3D");
    expect(screen.getByTestId("match-clock").textContent).toBe("0:00 / 0:05");
  });

  it("holds the time when the mode changes", async () => {
    await show("current", "/replay?frame=60");
    await pick("Heat");
    await pick("Units");
    expect(clockFrame()).toBe(60);
    expect(navigations).toEqual([]);
  });

  it("gives the map all the card's width, in its own shape, limited by its column's height", async () => {
    await show();
    const ground = document.querySelector("[data-map-ground]") as HTMLElement;
    expect(ground.style.aspectRatio).toBe("8192 / 6144");
    // No wider than lets the map keep its shape inside the height of the
    // column the page puts the card in, less what is around the map, and no
    // fixed cap.
    const column = ground.closest("[data-map-column]") as HTMLElement;
    expect(column.style.maxWidth).toBe(
      "calc(max(16rem, 100cqh - 4.5rem) * 8192 / 6144)",
    );

    await pick("Heat");
    const flat = document.querySelector("[data-map-ground]") as HTMLElement;
    expect(flat.style.aspectRatio).toBe("513 / 385");
    expect(
      (flat.closest("[data-map-column]") as HTMLElement).style.maxWidth,
    ).toBe(`calc(max(16rem, 100cqh - 4.5rem) * ${513 / 385} / 1)`);
  });
});

describe("the Heat window lane (#5309)", () => {
  const lane = () => screen.getByTestId("heat-window-lane");
  const pick = async (name: string) => {
    await act(async () => {
      fireEvent.click(screen.getByRole("radio", { name }));
    });
    await settle();
  };

  afterEach(() => {
    // The layer a test switched on is remembered between visits.
    localStorage.removeItem("coilbox.replayMap.layers");
    resetReplayBuildOrders();
  });

  it("is the last lane of the dock, inside the box the playhead crosses, with its label in the label column", async () => {
    await show();
    const box = screen.getByTestId("playhead").parentElement as HTMLElement;
    expect(box.contains(lane())).toBe(true);
    // After the lanes of marks, which come first.
    const kills = screen.getByRole("group", { name: "Kills" });
    expect(
      kills.compareDocumentPosition(lane()) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      within(screen.getByRole("group", { name: "Timeline" })).getByRole(
        "button",
        { name: "Heat window" },
      ),
    ).toBeTruthy();
    // The label column is as wide as every other lane's.
    expect(lane().getAttribute("aria-labelledby")).toBeTruthy();
  });

  it("is there in every mode of the map, and in Units where no layer reads it", async () => {
    await show();
    expect(screen.getAllByRole("slider", { name: /Heat window/ })).toHaveLength(
      2,
    );
    await pick("Heat");
    expect(screen.getAllByRole("slider", { name: /Heat window/ })).toHaveLength(
      2,
    );
    await pick("3D");
    expect(screen.getAllByRole("slider", { name: /Heat window/ })).toHaveLength(
      2,
    );
  });

  it("keeps the window when the map changes mode", async () => {
    await show();
    fireEvent.keyDown(
      screen.getByRole("slider", { name: "Heat window start" }),
      {
        key: "ArrowRight",
      },
    );
    await pick("Heat");
    expect(
      screen
        .getByRole("slider", { name: "Heat window start" })
        .getAttribute("aria-valuenow"),
    ).toBe("1");
  });

  it("goes with the spatial layers when a profile hides them", async () => {
    HIDE = ["analytics.spatialLayers"];
    await show();
    expect(screen.queryByTestId("heat-window-lane")).toBeNull();
    expect(screen.queryByRole("button", { name: "Heat window" })).toBeNull();
  });

  it("sets the window the map's layers read, which says so under the map", async () => {
    ORDERS = {
      orders: [
        {
          frame: 10,
          player: 0,
          team: 0,
          origin: { kind: "selection" },
          unitDefId: 1,
          count: 1,
          slot: { kind: "append" },
          builders: 1,
          options: 0,
          position: { x: 1024, y: 0, z: 2048 },
        },
        {
          frame: 100,
          player: 0,
          team: 0,
          origin: { kind: "selection" },
          unitDefId: 1,
          count: 1,
          slot: { kind: "append" },
          builders: 1,
          options: 0,
          position: { x: 1040, y: 0, z: 2060 },
        },
      ],
      players: [{ player: 0, name: "Alice" }],
      removals: 0,
      lastFrame: 150,
      incomplete: false,
    };
    // The marks are painted with paths, and this environment has none. What
    // is painted is not asserted here.
    vi.stubGlobal("Path2D", class {});
    await show();
    await pick("Heat");
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Buildings ordered" }),
      );
    });
    await settle();
    screen.getByText(/The whole match, 0:00 to 0:05\. 2 of 2 orders/);

    // The order at frame 10 is in the first second.
    const start = screen.getByRole("slider", { name: "Heat window start" });
    fireEvent.keyDown(start, { key: "ArrowRight" });
    await settle();
    screen.getByText(/Orders given from 0:01 to 0:05\. 1 of 2 orders/);
  });

  it("keeps an arrow on an end from also stepping the match", async () => {
    await show();
    expect(hook().clock.frame).toBe(0);
    const start = screen.getByRole("slider", { name: "Heat window start" });
    fireEvent.keyDown(start, { key: "ArrowRight" });
    fireEvent.keyDown(start, { key: "ArrowRight", shiftKey: true });
    await settle();
    expect(hook().clock.frame).toBe(0);
    // The same key anywhere else in the dock does step it.
    fireEvent.keyDown(screen.getByRole("group", { name: "Timeline" }), {
      key: "ArrowRight",
    });
    await settle();
    expect(hook().clock.frame).toBe(30);
  });
});

// ---- the players table and the chart's colours (#5311) -----------------------

describe("the units follow the players table and the colour switch", () => {
  const TWO_SEATS = {
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
  } as unknown as Partial<DemoInfo>;
  const sample = { frame: 0 } as DemoTrailer["teams"][number]["samples"][0];
  const STATS = {
    teams: [
      { team: 0, samples: [sample] },
      { team: 1, samples: [sample] },
    ],
  } as DemoTrailer;

  /** The fill and the share shown of each team's units in the latest picture,
   *  team 0 first unless it is the one pointed at. */
  const lastFills = () => {
    const from = ctx.calls.map((c) => c.op).lastIndexOf("clearRect");
    const picture = ctx.calls.slice(from);
    // A wreck is filled too, before any unit's outline is closed.
    const firstUnit = picture.findIndex((c) => c.op === "closePath");
    return picture
      .filter((c, i) => c.op === "fill" && i > firstUnit)
      .map((c) => ({ fill: c.fillStyle, alpha: c.globalAlpha }));
  };
  /** What the chart draws each team's line in, in a mode. */
  const chartColours = (mode: ChartColorMode) => {
    const lines = colorSeries(
      teamSeries(STATS, { ...info, ...TWO_SEATS } as DemoInfo),
      STATS,
      { ...info, ...TWO_SEATS } as DemoInfo,
      mode,
      "dark",
    );
    return [lines[0].color, lines[1].color];
  };
  /** The colour of each team's swatch in the rail, as the browser reads it. */
  const swatches = () =>
    [
      ...document.querySelectorAll<HTMLElement>("[data-map-rail] ul li > span"),
    ].map((el) => el.style.backgroundColor);
  /** A colour the way an element's style gives it back. */
  const asStyled = (colour: string) => {
    const el = document.createElement("span");
    el.style.backgroundColor = colour;
    return el.style.backgroundColor;
  };

  async function open() {
    INFO_OVER = TWO_SEATS;
    TRAILER = STATS;
    await show("current", "/replay?frame=100");
    // The choice is remembered between tests, so every one starts on palette.
    await act(async () => setColourMode("palette"));
    await settle();
  }

  it("draws a team's units and its rail swatch in its chart line's colour, in both modes", async () => {
    await open();
    for (const mode of ["palette", "game"] as const) {
      await act(async () => setColourMode(mode));
      await settle();
      const [first, second] = chartColours(mode);
      expect(lastFills().map((f) => f.fill)).toEqual([first, second]);
      expect(swatches()).toEqual([first, second].map(asStyled));
    }
    // The two modes are not the same colours, or this would prove nothing.
    expect(chartColours("palette")).not.toEqual(chartColours("game"));
  });

  it("draws an unticked player's units faint and leaves the others whole", async () => {
    await open();
    expect(lastFills().map((f) => f.alpha)).toEqual([1, 1]);
    await act(async () => emphasisStore.setShown([0], false));
    await settle();
    const fills = lastFills();
    expect(fills.map((f) => f.alpha)).toEqual([FAINT_UNITS, 1]);
    // Still there, and still in the same colours.
    expect(fills).toHaveLength(2);
    await act(async () => emphasisStore.setShown([0], true));
    await settle();
    expect(lastFills().map((f) => f.alpha)).toEqual([1, 1]);
  });

  it("lights the player the table points at and fades the others", async () => {
    await open();
    await act(async () => emphasisStore.hover([0]));
    await settle();
    // The lit team goes last, so it is on top.
    expect(lastFills()).toEqual([
      { fill: chartColours("palette")[1], alpha: FAINT_UNITS },
      { fill: chartColours("palette")[0], alpha: 1 },
    ]);
    await act(async () => emphasisStore.hover(null));
    await settle();
    expect(lastFills().map((f) => f.alpha)).toEqual([1, 1]);
  });
});

describe("start boxes and start positions in Units (#5312)", () => {
  // Unit 1 is at 3000, 2000 elmos of the fixture's 8192 by 6144 map, which is
  // 0.37, 0.33 of the way across. Team 1's box is round it.
  const SETUP = {
    allyTeams: [
      {
        id: 0,
        startBox: { left: 0, top: 0, right: 0.2, bottom: 0.3 },
        color: [1, 0, 0],
      },
      {
        id: 1,
        startBox: { left: 0.3, top: 0.25, right: 0.5, bottom: 0.5 },
        color: [0, 0.5, 1],
      },
    ],
    startPositions: [
      { team: 0, x: 1024, y: 0, z: 768 },
      { team: 1, x: 3072, y: 0, z: 2048 },
    ],
  } as unknown as Partial<DemoInfo>;
  const NO_BOXES = {
    allyTeams: [{ id: 0 }, { id: 1 }],
    startPositions: SETUP.startPositions,
  } as unknown as Partial<DemoInfo>;

  const boxes = () =>
    [
      ...document.querySelectorAll<HTMLElement>("[data-layer='startBox']"),
    ] as HTMLElement[];
  const labels = () =>
    [
      ...document.querySelectorAll<HTMLElement>("[data-layer='startBoxLabel']"),
    ] as HTMLElement[];
  /** The colour an area is outlined in. */
  const outline = (box: Element) =>
    box.querySelectorAll("polygon")[1]?.getAttribute("stroke");
  const dotMarks = () =>
    [
      ...document.querySelectorAll<HTMLElement>("[data-layer='startDot']"),
    ] as HTMLElement[];
  const switchFor = (name: string) =>
    within(document.querySelector("[data-map-rail]") as HTMLElement).getByRole(
      "button",
      { name },
    );
  const pick = async (name: string) => {
    await act(async () => {
      fireEvent.click(screen.getByRole("radio", { name }));
    });
    await settle();
  };
  const flip = async (name: string) => {
    await act(async () => {
      fireEvent.click(switchFor(name));
    });
    await settle();
  };

  async function open(over: Partial<DemoInfo> = SETUP, url = "/replay") {
    localStorage.removeItem("coilbox.replayMap.layers");
    INFO_OVER = over;
    await show("current", url);
  }

  it("draws each team's box in its colour with its number, under the units", async () => {
    await open();
    const drawn = boxes();
    expect(labels().map((b) => b.textContent)).toEqual(["1", "2"]);
    // Team 2's box is the 30% to 50% across and 25% to 50% down.
    expect(drawn[1].querySelector("polygon")?.getAttribute("points")).toBe(
      "30,25 50,25 50,50 30,50",
    );
    expect(outline(drawn[1])).toBe("#0080ff");
    // The canvas is later in the box that holds both, so it is in front.
    for (const el of [
      ...drawn.map((b) => b.closest("svg") as Element),
      ...labels(),
      ...dotMarks(),
    ]) {
      expect(
        el.compareDocumentPosition(canvas()) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
      expect(el.parentElement).toBe(canvas().parentElement);
    }
  });

  it("draws a dot at each recorded start, in the team's colour, that the pointer goes through", async () => {
    await open();
    const dots = dotMarks();
    expect(
      dots.map((d) => [
        d.dataset.team,
        Number.parseFloat(d.style.left).toFixed(2),
        Number.parseFloat(d.style.top).toFixed(2),
      ]),
    ).toEqual([
      ["0", "12.50", "12.50"],
      ["1", "37.50", "33.33"],
    ]);
    for (const dot of dots) {
      expect(dot.className).toContain("pointer-events-none");
      expect(dot.getAttribute("aria-hidden")).toBe("true");
    }
    expect(
      screen.queryByRole("button", { name: /^Start position of/ }),
    ).toBeNull();
    for (const el of [
      ...boxes().map((b) => b.closest("svg") as Element),
      ...labels(),
    ])
      expect(el.getAttribute("class")).toContain("pointer-events-none");
  });

  it("still names a unit inside a start box when the pointer is on it", async () => {
    await open();
    expect(boxes()).toHaveLength(2);
    await press("PageUp", 3);
    fireEvent.pointerMove(canvas(), { clientX: 375, clientY: 250 });
    await settle();
    expect(screen.getByTestId("recorded-unit-name").textContent).toBe(
      "armpw, Bot (AI), Team 2",
    );
    fireEvent.click(canvas(), { clientX: 375, clientY: 250 });
    fireEvent.pointerLeave(canvas());
    await settle();
    expect(screen.getByTestId("recorded-unit-name").textContent).toBe(
      "armpw, Bot (AI), Team 2",
    );
  });

  it("has one switch for each, which hides them in Units and in Heat", async () => {
    await open();
    expect(boxes()).toHaveLength(2);
    expect(dotMarks()).toHaveLength(2);

    await flip("Start boxes");
    expect(boxes()).toHaveLength(0);
    expect(dotMarks()).toHaveLength(2);
    // The same choice holds in the flat map.
    await pick("Heat");
    expect(boxes()).toHaveLength(0);
    expect(
      screen.getAllByRole("button", { name: /^Start position of/ }),
    ).toHaveLength(2);

    await flip("Start positions");
    expect(
      screen.queryByRole("button", { name: /^Start position of/ }),
    ).toBeNull();
    await pick("Units");
    expect(boxes()).toHaveLength(0);
    expect(dotMarks()).toHaveLength(0);

    // And switched on in one mode, on in the other.
    await flip("Start boxes");
    await flip("Start positions");
    expect(boxes()).toHaveLength(2);
    expect(dotMarks()).toHaveLength(2);
    await pick("Heat");
    expect(boxes()).toHaveLength(2);
    expect(
      screen.getAllByRole("button", { name: /^Start position of/ }),
    ).toHaveLength(2);
  });

  it("gives a box and a dot the same colours in Units as in Heat", async () => {
    // With the chart's colours, which both modes then draw in.
    TRAILER = {
      teams: [
        { team: 0, samples: [{ frame: 0 }] },
        { team: 1, samples: [{ frame: 0 }] },
      ],
    } as DemoTrailer;
    await open({
      ...SETUP,
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
    } as unknown as Partial<DemoInfo>);
    const inUnits = {
      boxes: boxes().map(outline),
      dots: dotMarks().map(
        (d) => (d.firstElementChild as HTMLElement).style.backgroundColor,
      ),
    };
    await pick("Heat");
    const inHeat = {
      boxes: boxes().map(outline),
      dots: screen
        .getAllByRole("button", { name: /^Start position of/ })
        .map((d) => (d.firstElementChild as HTMLElement).style.backgroundColor),
    };
    expect(inUnits.boxes.every(Boolean)).toBe(true);
    expect(inUnits).toEqual(inHeat);
  });

  it("rings the dot of the player the table points at", async () => {
    await open();
    const ring = (team: string) =>
      (
        dotMarks().find((d) => d.dataset.team === team)
          ?.firstElementChild as HTMLElement
      ).className;
    expect(ring("0")).not.toContain("ring-2 ring-white");
    await act(async () => emphasisStore.hover([0]));
    await settle();
    expect(ring("0")).toContain("ring-2 ring-white");
    expect(ring("1")).toContain("opacity-40");
    await act(async () => emphasisStore.hover(null));
  });

  it("draws Zero-K's polygon areas in Units, in the colour and number of the side that started in each (#5313)", async () => {
    GAMES = [
      {
        name: "Zero-K v1.12.0",
        primaryArchive: { name: "zk.sdz" },
        dependencyArchives: [],
        info: { shortname: "ZK" },
      } as unknown as GameItem,
    ];
    const square = (x: number, z: number): [number, number][] => [
      [x, z],
      [x + 1500, z],
      [x + 1500, z + 1500],
      [x, z + 1500],
    ];
    // Side 1 started at 1024, 768 and side 2 at 3072, 2048, and Zero-K dealt
    // the first area to the side in the second.
    STARTBOXES = {
      source: "game",
      file: "Zk Units Map.lua",
      teams: [
        { id: 0, startPoints: [], boxes: [square(2500, 1500)] },
        { id: 1, startPoints: [], boxes: [square(300, 100)] },
        { id: 2, startPoints: [], boxes: [square(6000, 4000)] },
      ],
    };
    await open({
      ...NO_BOXES,
      gameType: "Zero-K v1.12.0",
      mapName: "Zk Units Map",
      allyTeams: [
        { id: 0, color: [1, 0, 0] },
        { id: 1, color: [0, 0.5, 1] },
      ],
      players: [
        { name: "Alice", team: 0, allyTeam: 0, spectator: false },
        { name: "Bob", team: 1, allyTeam: 1, spectator: false },
      ],
    } as unknown as Partial<DemoInfo>);
    await vi.waitFor(() => expect(boxes()).toHaveLength(3));
    expect(labels().map((l) => l.textContent)).toEqual(["2", "1"]);
    expect(boxes().map(outline)).toEqual(["#0080ff", "#ff0000", "#94a3b8"]);
    expect(startBoxesAsked).toHaveBeenCalledWith(
      expect.objectContaining({
        mapName: "Zk Units Map",
        mapSizeX: 8192,
        mapSizeZ: 6144,
      }),
    );
    // Under the canvas and out of the pointer's way, as the rectangles were.
    for (const el of [
      ...boxes().map((b) => b.closest("svg") as Element),
      ...labels(),
    ]) {
      expect(el.getAttribute("class")).toContain("pointer-events-none");
      expect(
        el.compareDocumentPosition(canvas()) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    }
    // And they are still there in Heat, in the same colours.
    await pick("Heat");
    await vi.waitFor(() => expect(boxes()).toHaveLength(3));
    expect(boxes().map(outline)).toEqual(["#0080ff", "#ff0000", "#94a3b8"]);
  });

  it("shows no box for a match that set none, and says so", async () => {
    await open(NO_BOXES);
    expect(boxes()).toHaveLength(0);
    screen.getByText("This match set no start boxes.");
    expect(dotMarks()).toHaveLength(2);
  });

  it("says a replay recorded no start positions, and draws no dot", async () => {
    await open({ ...SETUP, startPositions: [] } as Partial<DemoInfo>);
    expect(dotMarks()).toHaveLength(0);
    screen.getByText("This replay recorded no start positions.");
  });

  it("still draws the boxes, with no switches, when the profile hides the layers", async () => {
    HIDE = ["analytics.spatialLayers"];
    await open();
    expect(boxes()).toHaveLength(2);
    expect(dotMarks()).toHaveLength(0);
    expect(screen.queryByRole("toolbar", { name: "Map layers" })).toBeNull();
    screen.getByText("Start boxes per team.");
  });
});

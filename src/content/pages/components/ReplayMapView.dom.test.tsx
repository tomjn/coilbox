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
} from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ChatLine,
  DemoInfo,
  ReplayTrackFault,
  ReplayTrackHeader,
  StoredReplayAnalysis,
  StoredReplayTrack,
  TimelineEvent,
} from "../../bindings";
import fixture from "../../fixtures/replay-track-window.json";
import {
  resetReplayAnalysisForTests,
  seedReplayAnalysisForTests,
} from "../../replayAnalysis";
import type { ReplayWatch } from "../../replayEngine";
import { resetReplayEventReadsForTests } from "../../replayEventRead";
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

const ID = "00112233445566778899aabbccddeeff";
const HEADER = fixture.header as ReplayTrackHeader;

/** What reading the header answers: the header, or a fault. */
let HEADER_ANSWER: ReplayTrackHeader | ReplayTrackFault = HEADER;
const headerReads: string[] = [];
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
vi.mock("../../config", () => ({
  useUnitsyncMinimap: () => ({ url: MINIMAP, loading: false }),
}));

/** What the replay file holds, and what the analysis logged. */
let CHAT: {
  messages: ChatLine[];
  incomplete: boolean;
  events: TimelineEvent[];
};
let LOGGED: { kind: string; frame: number }[] = [];

vi.mock("../../bindings", async () => {
  const actual =
    await vi.importActual<Record<string, unknown>>("../../bindings");
  return {
    ...actual,
    contentReplayTracks: async () => {
      throw new Error("seeded in the test");
    },
    contentDemoChat: async () => CHAT,
    contentReplayAnalysisEvents: async (args: { kinds?: string[] }) => ({
      events: LOGGED.filter((e) => !args.kinds || args.kinds.includes(e.kind)),
    }),
  };
});

vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: async () => {} }));

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

const { ReplayMapViewSection } = await import("./ReplayMapView");
const { ANALYSIS_ACTION_ATTRIBUTE, ANALYSIS_SECTION_ID } = await import(
  "../../replayAnalysis"
);

const info = {
  gameId: ID,
  mapName: "Test Map",
  remixed: false,
  engineVersion: "105.1.1-2511-g4d1de6d",
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

/** What the page hands the section about launching. */
let WATCH: ReplayWatch;
let BLOCK: string | null;
let GAME: string | undefined;

let ctx: ReturnType<typeof recordingContext>;
let onScreen: ((entries: { isIntersecting: boolean }[]) => void) | undefined;
let hidden = false;

beforeEach(() => {
  HEADER_ANSWER = HEADER;
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
  MINIMAP = "asset://minimap.png";
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

function mount(url: string, remixed = false) {
  const router = createMemoryRouter(
    [
      {
        path: "*",
        element: (
          <ReplayMapViewSection
            info={{ ...info, remixed } as DemoInfo}
            enginePath="/engine"
            dataDir="/data"
            replayPath="/replays/a.sdfz"
            watch={WATCH}
            dependencyBlock={BLOCK}
            game={GAME}
          />
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
  const thumb = screen.getByRole("slider");
  for (let i = 0; i < times; i++) fireEvent.keyDown(thumb, { key });
  await settle();
}

const pictures = () => ctx.count("clearRect");
const canvas = () =>
  document.querySelector("canvas[data-layer='recorded-units']") as HTMLElement;

describe("when there is nothing to draw", () => {
  it("shows nothing for a replay with no track", async () => {
    const { container } = await show(null);
    expect(container.innerHTML).toBe("");
    expect(headerReads).toEqual([]);
  });

  it("shows nothing for a remix, which has no track of its own", async () => {
    seedReplayTracksForTests([track("current")]);
    const { container } = mount("/replay", true);
    await settle();
    expect(container.innerHTML).toBe("");
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

  it("does nothing for a replay with no track", async () => {
    const { container } = await show(null, "/replay?frame=60");
    expect(container.innerHTML).toBe("");
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

describe("marks on the bar", () => {
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
  const line = (frame: number, text: string) =>
    ({
      frame,
      time: 0,
      player: 0,
      playerName: "Ann",
      text,
      system: false,
    }) as unknown as ChatLine;
  const group = (name: string) => screen.queryByRole("group", { name });

  it("has no marks and says nothing about it when the replay has no events", async () => {
    LOGGED = kills([30, 100]);
    await show();
    expect(group("Kills")).toBeNull();
    expect(group("Chat")).toBeNull();
    expect(group("Players leaving")).toBeNull();
    expect(screen.queryByText(/analys/i)).toBeNull();
  });

  it("marks kills from the analysis, chat and players leaving from the file, in lanes of their own", async () => {
    analysed();
    LOGGED = kills([100]);
    CHAT = {
      messages: [line(45, "gl hf")],
      incomplete: false,
      events: [
        {
          type: "playerLeft",
          frame: 120,
          time: 4,
          player: 1,
          playerName: "Bot",
          reason: { kind: "left" },
        } as unknown as TimelineEvent,
      ],
    };
    await show();
    const kill = screen.getByRole("button", { name: /Unit destroyed, 0:03/ });
    screen.getByRole("button", { name: /Chat, 0:01: Ann: gl hf/ });
    screen.getByRole("button", { name: /Bot left the game, 0:04/ });
    expect(group("Kills")?.contains(kill)).toBe(true);

    await act(async () => {
      fireEvent.click(kill);
    });
    expect(clockFrame()).toBe(100);
    expect(navigations).toEqual([{ action: "REPLACE", search: "?frame=100" }]);
  });

  it("goes to a mark's event from the keyboard", async () => {
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

  it("merges marks that fall in one column into one with a count, that seeks to the earliest", async () => {
    analysed();
    // 1,024 pixels of bar in columns of 8 is 128 columns over 150 frames, so
    // three kills at one frame share a column and one at 140 has its own.
    LOGGED = kills([30, 30, 30, 140]);
    await show();
    const merged = screen.getByRole("button", {
      name: "3 units destroyed from 0:01",
    });
    expect(group("Kills")?.querySelectorAll("button")).toHaveLength(2);
    await act(async () => {
      fireEvent.click(merged);
    });
    expect(clockFrame()).toBe(30);
  });

  it("draws no more than a mark for each column however many kills there are", async () => {
    analysed();
    LOGGED = kills(Array.from({ length: 5000 }, (_, i) => i % 151));
    await show();
    const buttons = Array.from(
      group("Kills")?.querySelectorAll("button") ?? [],
    );
    // 1,024 pixels in columns of 8 is 128 columns.
    expect(buttons.length).toBeGreaterThan(0);
    expect(buttons.length).toBeLessThanOrEqual(128);
    const counted = buttons.reduce((n, b) => {
      const m = /^(\d+) units/.exec(b.getAttribute("aria-label") ?? "");
      return n + (m ? Number(m[1]) : 1);
    }, 0);
    expect(counted).toBe(5000);
  });

  it("leaves a remix with no kills of its own", async () => {
    analysed();
    LOGGED = kills([30]);
    seedReplayTracksForTests([track("current")]);
    mount("/replay", true);
    await settle();
    expect(document.querySelector("canvas")).toBeNull();
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

  it("is not there when the track is not shown", async () => {
    await show("stale");
    expect(screen.queryByRole("button", { name: "Open in engine" })).toBeNull();
  });
});

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
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  DemoInfo,
  ReplayTrackFault,
  ReplayTrackHeader,
  StoredReplayTrack,
} from "../../bindings";
import fixture from "../../fixtures/replay-track-window.json";
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

vi.mock("../../bindings", async () => {
  const actual =
    await vi.importActual<Record<string, unknown>>("../../bindings");
  return {
    ...actual,
    contentReplayTracks: async () => {
      throw new Error("seeded in the test");
    },
  };
});

vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: async () => {} }));

const { ReplayMapViewSection } = await import("./ReplayMapView");
const { RECORDING_SECTION_ID } = await import("./ReplayRecordingSection");

const info = {
  gameId: ID,
  mapName: "Test Map",
  remixed: false,
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
  run() {
    const due = [...this.waiting.values()];
    this.waiting.clear();
    for (const cb of due) cb(0);
  },
};

let ctx: ReturnType<typeof recordingContext>;
let onScreen: ((entries: { isIntersecting: boolean }[]) => void) | undefined;
let hidden = false;

beforeEach(() => {
  HEADER_ANSWER = HEADER;
  HELD = new Set();
  held.length = 0;
  headerReads.length = 0;
  MINIMAP = "asset://minimap.png";
  hidden = false;
  onScreen = undefined;
  raf.waiting.clear();
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

async function show(state: StoredReplayTrack["state"] | null = "current") {
  if (state) seedReplayTracksForTests([track(state)]);
  const view = render(
    <ReplayMapViewSection info={info} enginePath="/engine" dataDir="/data" />,
  );
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
    const { container } = render(
      <ReplayMapViewSection
        info={{ ...info, remixed: true } as DemoInfo}
        enginePath="/engine"
        dataDir="/data"
      />,
    );
    await settle();
    expect(container.innerHTML).toBe("");
  });

  it("says a stale track is not shown, does not read it, and leads to the recording section", async () => {
    // The recording section, as the page has it above the view.
    const section = document.createElement("section");
    section.id = RECORDING_SECTION_ID;
    const record = document.createElement("button");
    section.append(record);
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

/**
 * Which windows of a track the frontend holds (#3806): the one the time is in
 * and the next one in the direction of travel, and no others.
 */
import { describe, expect, it, vi } from "vitest";
import { ReplayTrackError } from "./fault";
import type { TrackWindow } from "./trackWindow";
import { createWindowStore, windowOfFrame } from "./windowStore";

// Frames 100 to 400 in windows of 60: 100-160, 160-220, 220-280, 280-340,
// 340-400. Five windows.
const geometry = { firstFrame: 100, windowLength: 60, windowCount: 5 };

function fakeWindow(index: number): TrackWindow {
  const startFrame = 100 + index * 60;
  return { index, startFrame, endFrame: startFrame + 60 } as TrackWindow;
}

/** A loader whose windows arrive when the test says so. */
function loader() {
  const waiting = new Map<
    number,
    { resolve: () => void; reject: (e: unknown) => void }
  >();
  const load = vi.fn(
    (k: number) =>
      new Promise<TrackWindow>((resolve, reject) => {
        waiting.set(k, { resolve: () => resolve(fakeWindow(k)), reject });
      }),
  );
  return {
    load,
    arrive: async (...ks: number[]) => {
      for (const k of ks) waiting.get(k)?.resolve();
      await Promise.resolve();
      await Promise.resolve();
    },
    fail: async (k: number, e: unknown) => {
      waiting.get(k)?.reject(e);
      await Promise.resolve();
      await Promise.resolve();
    },
  };
}

describe("windowOfFrame", () => {
  it("puts a frame in the window that holds it", () => {
    expect(windowOfFrame(geometry, 100)).toBe(0);
    expect(windowOfFrame(geometry, 159)).toBe(0);
    expect(windowOfFrame(geometry, 161)).toBe(1);
    expect(windowOfFrame(geometry, 399)).toBe(4);
  });

  it("gives a frame on a boundary to the later window, as the Rust reader does", () => {
    expect(windowOfFrame(geometry, 160)).toBe(1);
    expect(windowOfFrame(geometry, 220)).toBe(2);
  });

  it("puts a frame past the end in the last window and one before the start in the first", () => {
    expect(windowOfFrame(geometry, 400)).toBe(4);
    expect(windowOfFrame(geometry, 10_000)).toBe(4);
    expect(windowOfFrame(geometry, 0)).toBe(0);
  });
});

describe("the windows held", () => {
  it("loads the current window and the next one going forward", async () => {
    const l = loader();
    const store = createWindowStore(geometry, l.load);
    store.follow(110, 1);
    expect(l.load.mock.calls.map((c) => c[0]).sort()).toEqual([0, 1]);
    await l.arrive(0, 1);
    expect(store.held()).toEqual([0, 1]);
  });

  it("loads the previous window going backward", async () => {
    const l = loader();
    const store = createWindowStore(geometry, l.load);
    store.follow(300, -1);
    await l.arrive(3, 2);
    expect(store.held()).toEqual([2, 3]);
  });

  it("holds one window at the end of the track in the direction of travel", async () => {
    const l = loader();
    const store = createWindowStore(geometry, l.load);
    store.follow(399, 1);
    await l.arrive(4);
    expect(store.held()).toEqual([4]);
    expect(l.load).toHaveBeenCalledTimes(1);
    store.follow(105, -1);
    await l.arrive(0);
    expect(store.held()).toEqual([0]);
  });

  it("drops every window it no longer wants", async () => {
    const l = loader();
    const store = createWindowStore(geometry, l.load);
    store.follow(110, 1);
    await l.arrive(0, 1);
    store.follow(170, 1);
    await l.arrive(2);
    expect(store.held()).toEqual([1, 2]);
    store.follow(230, 1);
    await l.arrive(3);
    expect(store.held()).toEqual([2, 3]);
    expect(store.windowFor(110)).toBeUndefined();
    expect(store.windowFor(230)?.index).toBe(2);
    expect(store.windowFor(290)?.index).toBe(3);
  });

  it("never holds more than two windows, however far time jumps", async () => {
    const l = loader();
    const store = createWindowStore(geometry, l.load);
    for (const frame of [110, 390, 250, 120, 330]) {
      store.follow(frame, 1);
      await l.arrive(0, 1, 2, 3, 4);
      expect(store.held().length).toBeLessThanOrEqual(2);
    }
  });

  it("turns round: the current window stays and the one behind it loads", async () => {
    const l = loader();
    const store = createWindowStore(geometry, l.load);
    store.follow(230, 1);
    await l.arrive(2, 3);
    expect(store.held()).toEqual([2, 3]);
    l.load.mockClear();
    store.follow(231, -1);
    expect(l.load.mock.calls.map((c) => c[0])).toEqual([1]);
    // The window ahead is no longer wanted, so it goes at once.
    expect(store.held()).toEqual([2]);
    await l.arrive(1);
    expect(store.held()).toEqual([1, 2]);
  });

  it("does not load a window again while it is held or on its way", async () => {
    const l = loader();
    const store = createWindowStore(geometry, l.load);
    store.follow(110, 1);
    store.follow(111, 1);
    store.follow(112, 1);
    expect(l.load).toHaveBeenCalledTimes(2);
    await l.arrive(0, 1);
    store.follow(113, 1);
    expect(l.load).toHaveBeenCalledTimes(2);
  });

  it("says a frame is not ready until its window has arrived", async () => {
    const l = loader();
    const store = createWindowStore(geometry, l.load);
    store.follow(110, 1);
    expect(store.windowFor(110)).toBeUndefined();
    await l.arrive(0);
    expect(store.windowFor(110)?.index).toBe(0);
  });

  it("throws away a window that arrives after it stopped being wanted", async () => {
    const l = loader();
    const store = createWindowStore(geometry, l.load);
    store.follow(110, 1);
    store.follow(390, 1);
    await l.arrive(0, 1, 4);
    expect(store.held()).toEqual([4]);
  });

  it("holds both sides of a boundary frame, whichever way time is going", async () => {
    const l = loader();
    const store = createWindowStore(geometry, l.load);
    // Frame 160 is the last of window 0 and the first of window 1.
    store.follow(160, -1);
    await l.arrive(0, 1);
    expect(store.held()).toEqual([0, 1]);
    store.follow(160, 1);
    await l.arrive(2);
    expect(store.held()).toEqual([1, 2]);
  });

  it("answers a boundary frame from the earlier window when only that one is held", async () => {
    const l = loader();
    const store = createWindowStore(geometry, l.load);
    store.follow(150, -1);
    await l.arrive(0);
    expect(store.held()).toEqual([0]);
    // Time stepped onto the boundary before the next follow call.
    expect(store.windowFor(160)?.index).toBe(0);
    expect(store.windowFor(161)).toBeUndefined();
  });

  it("tells subscribers when a window arrives and when one is dropped", async () => {
    const l = loader();
    const store = createWindowStore(geometry, l.load);
    const heard = vi.fn();
    const stop = store.subscribe(heard);
    store.follow(110, 1);
    await l.arrive(0, 1);
    expect(heard).toHaveBeenCalledTimes(2);
    store.follow(230, 1);
    expect(heard).toHaveBeenCalledTimes(3);
    stop();
    await l.arrive(2, 3);
    expect(heard).toHaveBeenCalledTimes(3);
  });

  it("holds nothing after it is disposed, and ignores windows still coming", async () => {
    const l = loader();
    const store = createWindowStore(geometry, l.load);
    store.follow(110, 1);
    await l.arrive(0);
    store.dispose();
    await l.arrive(1);
    expect(store.held()).toEqual([]);
    store.follow(110, 1);
    expect(l.load).toHaveBeenCalledTimes(2);
  });
});

describe("a window that cannot be read", () => {
  const corrupt = new ReplayTrackError({
    kind: "corruptWindow",
    window: 1,
    message: "checksum",
  });

  it("is an error for that window only, and the others still read", async () => {
    const l = loader();
    const store = createWindowStore(geometry, l.load);
    store.follow(110, 1);
    await l.arrive(0);
    await l.fail(1, corrupt);
    expect(store.failure(1)?.kind).toBe("corruptWindow");
    expect(store.failure(0)).toBeUndefined();
    expect(store.held()).toEqual([0]);
    expect(store.windowFor(110)?.index).toBe(0);
    expect(store.windowFor(170)).toBeUndefined();
  });

  it("is not asked for again while it is still wanted", async () => {
    const l = loader();
    const store = createWindowStore(geometry, l.load);
    store.follow(110, 1);
    await l.arrive(0);
    await l.fail(1, corrupt);
    l.load.mockClear();
    store.follow(111, 1);
    store.follow(112, 1);
    expect(l.load).not.toHaveBeenCalled();
  });

  it("is tried again once time has left it and come back", async () => {
    const l = loader();
    const store = createWindowStore(geometry, l.load);
    store.follow(110, 1);
    await l.arrive(0);
    await l.fail(1, corrupt);
    store.follow(330, 1);
    await l.arrive(3, 4);
    expect(store.failure(1)).toBeUndefined();
    l.load.mockClear();
    store.follow(110, 1);
    expect(l.load.mock.calls.map((c) => c[0]).sort()).toEqual([0, 1]);
  });

  it("keeps a fault that is not a ReplayTrackError as an io fault", async () => {
    const l = loader();
    const store = createWindowStore(geometry, l.load);
    store.follow(110, 1);
    await l.arrive(0);
    await l.fail(1, new Error("the bridge went away"));
    expect(store.failure(1)?.kind).toBe("io");
    expect(store.failure(1)?.message).toContain("the bridge went away");
  });
});

import { describe, expect, it } from "vitest";
import {
  createAdaptiveResolution,
  createDisplayClock,
  type FrameSample,
  LOWEST_PIXEL_RATIO,
} from "./adaptiveResolution";

// A 60 Hz display.
const interval = 1000 / 60;
const moving: FrameSample = {
  waited: interval,
  moving: true,
  baking: false,
  displayInterval: interval,
};
const still: FrameSample = { ...moving, moving: false };
// A frame that missed one refresh.
const missed = interval * 2;

describe("createAdaptiveResolution", () => {
  it("never drops while the frames keep up", () => {
    const r = createAdaptiveResolution();
    // Every interval a webview measured on a 60 Hz display in #3994 fell
    // between 15 and 19 ms.
    for (const waited of [15, 19, 16, 18, 15, 19, 17, 15, 19, 19]) {
      expect(r.frame({ ...moving, waited }, 2)).toBe(2);
    }
    expect(r.reduced()).toBe(false);
  });

  it("does not drop for a single long frame", () => {
    const r = createAdaptiveResolution();
    expect(r.frame({ ...moving, waited: missed }, 1)).toBe(1);
    expect(r.frame(moving, 1)).toBe(1);
    expect(r.frame({ ...moving, waited: missed }, 1)).toBe(1);
    expect(r.frame(moving, 1)).toBe(1);
  });

  it("drops by the root of the time over after two long frames in a row", () => {
    const r = createAdaptiveResolution();
    r.frame({ ...moving, waited: missed }, 1);
    const ratio = r.frame({ ...moving, waited: missed * 1.5 }, 1);
    // Steps from the shorter of the two waits.
    expect(ratio).toBeCloseTo(Math.sqrt(interval / missed), 6);
    expect(r.reduced()).toBe(true);
  });

  it("does not drop while the camera holds still, however long the frames", () => {
    const r = createAdaptiveResolution();
    for (let i = 0; i < 5; i++) {
      expect(r.frame({ ...still, waited: missed * 3 }, 1)).toBe(1);
    }
  });

  it("restores full resolution on the frame after the camera stops", () => {
    const r = createAdaptiveResolution();
    r.frame({ ...moving, waited: missed }, 2);
    expect(r.frame({ ...moving, waited: missed }, 2)).toBeLessThan(2);
    expect(r.frame({ ...still, waited: missed }, 2)).toBe(2);
    expect(r.reduced()).toBe(false);
  });

  it("holds a reduced ratio while the camera keeps moving", () => {
    const r = createAdaptiveResolution();
    r.frame({ ...moving, waited: missed }, 1);
    const dropped = r.frame({ ...moving, waited: missed }, 1);
    for (let i = 0; i < 5; i++) expect(r.frame(moving, 1)).toBe(dropped);
  });

  it("ignores the wait of the frame after a change", () => {
    const r = createAdaptiveResolution();
    r.frame({ ...moving, waited: missed }, 1);
    const dropped = r.frame({ ...moving, waited: missed }, 1);
    // The resize of the drawing buffer lands on this one.
    expect(r.frame({ ...moving, waited: missed }, 1)).toBe(dropped);
    expect(r.frame({ ...moving, waited: missed }, 1)).toBe(dropped);
    expect(r.frame({ ...moving, waited: missed }, 1)).toBeLessThan(dropped);
  });

  it("steps down while frames stay long, and no lower than the floor", () => {
    const r = createAdaptiveResolution();
    let ratio = 2;
    for (let i = 0; i < 30; i++) {
      ratio = r.frame({ ...moving, waited: missed * 2 }, 2);
    }
    expect(ratio).toBe(LOWEST_PIXEL_RATIO);
  });

  it("never drops below a full ratio that is already under the floor", () => {
    const r = createAdaptiveResolution(0.5);
    for (let i = 0; i < 10; i++) {
      expect(r.frame({ ...moving, waited: missed * 2 }, 0.4)).toBe(0.4);
    }
  });

  it("ignores frames that bake the ground, and the frame after each", () => {
    const r = createAdaptiveResolution();
    const bake = { ...moving, waited: missed, baking: true };
    for (let i = 0; i < 20; i++) expect(r.frame(bake, 1)).toBe(1);
    // The first frame after the bake waited on the last tile.
    expect(r.frame({ ...moving, waited: missed }, 1)).toBe(1);
    expect(r.frame({ ...moving, waited: missed }, 1)).toBe(1);
  });

  it("does not drop before the display's interval is measured", () => {
    const r = createAdaptiveResolution();
    const unmeasured = { ...moving, displayInterval: undefined };
    for (let i = 0; i < 10; i++) {
      expect(r.frame({ ...unmeasured, waited: missed * 3 }, 1)).toBe(1);
    }
  });

  it("starts from full resolution again after a reset", () => {
    const r = createAdaptiveResolution();
    r.frame({ ...moving, waited: missed }, 1);
    r.frame({ ...moving, waited: missed }, 1);
    r.reset();
    expect(r.reduced()).toBe(false);
    expect(r.frame(moving, 1)).toBe(1);
  });
});

/** A hand-cranked requestAnimationFrame that passes each frame's time. */
function fakeFrames() {
  let next = 1;
  const queued = new Map<number, (time: number) => void>();
  return {
    schedule: (cb: (time: number) => void) => {
      queued.set(next, cb);
      return next++;
    },
    unschedule: (handle: number) => {
      queued.delete(handle);
    },
    tick: (...times: number[]) => {
      for (const time of times) {
        const due = [...queued.values()];
        queued.clear();
        for (const cb of due) cb(time);
      }
    },
  };
}

describe("createDisplayClock", () => {
  it("measures the middle of three intervals after the first frame", () => {
    const f = fakeFrames();
    const clock = createDisplayClock(f.schedule, f.unschedule);
    expect(clock.interval()).toBeUndefined();
    clock.measure();
    f.tick(100, 116, 132);
    expect(clock.interval()).toBeUndefined();
    f.tick(149, 165);
    expect(clock.interval()).toBe(16);
  });

  it("is not shortened by a first frame that ran late", () => {
    const f = fakeFrames();
    const clock = createDisplayClock(f.schedule, f.unschedule);
    clock.measure();
    // Under a millisecond apart, as measured in #3994.
    f.tick(100, 100.1, 116.8, 133.5, 150.2);
    expect(clock.interval()).toBeCloseTo(16.7, 6);
  });

  it("is not moved by one late frame after the first", () => {
    const f = fakeFrames();
    const clock = createDisplayClock(f.schedule, f.unschedule);
    clock.measure();
    f.tick(0, 16.7, 32, 35, 50);
    expect(clock.interval()).toBeCloseTo(15, 6);
  });

  it("keeps the last measurement when one is cancelled", () => {
    const f = fakeFrames();
    const clock = createDisplayClock(f.schedule, f.unschedule);
    clock.measure();
    f.tick(0, 16, 32, 48, 64);
    clock.measure();
    f.tick(100);
    clock.cancel();
    f.tick(200, 300, 400, 500);
    expect(clock.interval()).toBe(16);
  });

  it("replaces the last measurement with a new one", () => {
    const f = fakeFrames();
    const clock = createDisplayClock(f.schedule, f.unschedule);
    clock.measure();
    f.tick(0, 16, 32, 48, 64);
    clock.measure();
    f.tick(100, 108, 116, 124, 132);
    expect(clock.interval()).toBe(8);
  });
});

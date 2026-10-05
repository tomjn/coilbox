import { describe, expect, it } from "vitest";
import {
  createFrameScheduler,
  type FrameActivity,
  needsAnotherFrame,
} from "./frameDemand";

const still: FrameActivity = {
  alwaysMoving: false,
  intro: false,
  focusEase: false,
  headingEase: false,
  cameraMoved: false,
  burst: false,
  selectionPulse: false,
  combatFlashes: false,
  effects: true,
};

describe("needsAnotherFrame", () => {
  it("stops when nothing moves", () => {
    expect(needsAnotherFrame(still)).toBe(false);
  });

  it.each([
    "alwaysMoving",
    "intro",
    "focusEase",
    "headingEase",
    "cameraMoved",
    "burst",
    "selectionPulse",
    "combatFlashes",
  ] as const)("keeps drawing while %s", (key) => {
    expect(needsAnotherFrame({ ...still, [key]: true })).toBe(true);
  });

  it("lets the pulse and the flashes rest with effects off", () => {
    const off = { ...still, effects: false };
    expect(needsAnotherFrame({ ...off, selectionPulse: true })).toBe(false);
    expect(needsAnotherFrame({ ...off, combatFlashes: true })).toBe(false);
  });

  it("keeps the camera, bursts and Galaxy maps moving with effects off", () => {
    const off = { ...still, effects: false };
    expect(needsAnotherFrame({ ...off, cameraMoved: true })).toBe(true);
    expect(needsAnotherFrame({ ...off, burst: true })).toBe(true);
    expect(needsAnotherFrame({ ...off, alwaysMoving: true })).toBe(true);
  });
});

/** A hand-cranked requestAnimationFrame. */
function fakeFrames() {
  let next = 1;
  const queued = new Map<number, () => void>();
  return {
    schedule: (cb: () => void) => {
      queued.set(next, cb);
      return next++;
    },
    unschedule: (handle: number) => {
      queued.delete(handle);
    },
    queued: () => queued.size,
    /** Run every callback queued before this call, as one vsync does. */
    tick: () => {
      const due = [...queued.values()];
      queued.clear();
      for (const cb of due) cb();
    },
  };
}

describe("createFrameScheduler", () => {
  it("draws nothing until asked", () => {
    const frames = fakeFrames();
    let drawn = 0;
    createFrameScheduler(
      () => {
        drawn++;
        return false;
      },
      frames.schedule,
      frames.unschedule,
    );
    frames.tick();
    expect(drawn).toBe(0);
  });

  it("draws once for several requests in one frame", () => {
    const frames = fakeFrames();
    let drawn = 0;
    const s = createFrameScheduler(
      () => {
        drawn++;
        return false;
      },
      frames.schedule,
      frames.unschedule,
    );
    s.request();
    s.request();
    s.request();
    expect(frames.queued()).toBe(1);
    frames.tick();
    expect(drawn).toBe(1);
    frames.tick();
    expect(drawn).toBe(1);
  });

  it("keeps drawing while the frame asks for more, then stops", () => {
    const frames = fakeFrames();
    let left = 3;
    let drawn = 0;
    const s = createFrameScheduler(
      () => {
        drawn++;
        left--;
        return left > 0;
      },
      frames.schedule,
      frames.unschedule,
    );
    s.request();
    for (let t = 0; t < 10; t++) frames.tick();
    expect(drawn).toBe(3);
    expect(frames.queued()).toBe(0);
  });

  it("draws the next frame for a request made during a frame", () => {
    const frames = fakeFrames();
    let drawn = 0;
    const s = createFrameScheduler(
      () => {
        drawn++;
        if (drawn === 1) s.request();
        return false;
      },
      frames.schedule,
      frames.unschedule,
    );
    s.request();
    frames.tick();
    frames.tick();
    frames.tick();
    expect(drawn).toBe(2);
  });

  it("drops a pending frame on cancel and can start again", () => {
    const frames = fakeFrames();
    let drawn = 0;
    const s = createFrameScheduler(
      () => {
        drawn++;
        return false;
      },
      frames.schedule,
      frames.unschedule,
    );
    s.request();
    s.cancel();
    frames.tick();
    expect(drawn).toBe(0);
    s.request();
    frames.tick();
    expect(drawn).toBe(1);
  });
});

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
  reducedResolution: false,
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
    "reducedResolution",
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
    expect(needsAnotherFrame({ ...off, reducedResolution: true })).toBe(true);
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

  it("tells a frame how long it waited", () => {
    const frames = fakeFrames();
    let time = 0;
    const waits: number[] = [];
    let left = 3;
    const s = createFrameScheduler(
      (waited) => {
        waits.push(waited);
        return --left > 0;
      },
      frames.schedule,
      frames.unschedule,
      () => time,
    );
    // Asked for between frames: from the request.
    time = 10;
    s.request();
    time = 16;
    frames.tick();
    // Asked for by the frame before: from that frame's start.
    time = 50;
    frames.tick();
    time = 66;
    frames.tick();
    expect(waits).toEqual([6, 34, 16]);
  });

  it("times a request made during a frame from that frame's start", () => {
    const frames = fakeFrames();
    let time = 0;
    const waits: number[] = [];
    const s = createFrameScheduler(
      (waited) => {
        waits.push(waited);
        time += 5;
        if (waits.length === 1) s.request();
        return false;
      },
      frames.schedule,
      frames.unschedule,
      () => time,
    );
    s.request();
    time = 16;
    frames.tick();
    time = 40;
    frames.tick();
    expect(waits).toEqual([16, 24]);
  });

  it("goes idle after a frame that leaves nothing asked for", () => {
    const frames = fakeFrames();
    let idle = 0;
    let left = 2;
    const s = createFrameScheduler(
      () => --left > 0,
      frames.schedule,
      frames.unschedule,
      () => 0,
      () => idle++,
    );
    s.request();
    frames.tick();
    expect(idle).toBe(0);
    frames.tick();
    expect(idle).toBe(1);
    frames.tick();
    expect(idle).toBe(1);
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

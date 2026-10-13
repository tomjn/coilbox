// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createReplayClock } from "./clock";
import { createPlayback, SPEEDS } from "./playback";

const HEADER = { firstFrame: 0, lastFrame: 150, framesPerSecond: 30 };

/** Animation frames, run by hand with a time stamp. */
const raf = {
  waiting: new Map<number, (stamp: number) => void>(),
  next: 1,
  run(stamp: number) {
    const due = [...this.waiting.values()];
    this.waiting.clear();
    for (const callback of due) callback(stamp);
  },
};

let hidden = false;

function make(startAt = 0, onSettled = vi.fn()) {
  const clock = createReplayClock(startAt);
  const sets: [number, number][] = [];
  clock.subscribe(() => sets.push([clock.frame, clock.direction]));
  const playback = createPlayback({
    clock,
    header: HEADER,
    env: {
      requestFrame: (callback) => {
        raf.waiting.set(raf.next, callback);
        return raf.next++;
      },
      cancelFrame: (id) => {
        raf.waiting.delete(id);
      },
    },
    onSettled,
  });
  return { clock, playback, sets, onSettled };
}

beforeEach(() => {
  raf.waiting.clear();
  hidden = false;
  Object.defineProperty(document, "hidden", {
    configurable: true,
    get: () => hidden,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("playing forward", () => {
  it("advances by elapsed time times speed times the track's frames per second", () => {
    const { clock, playback } = make();
    playback.play();
    // The first stamp only says when playing began.
    raf.run(5000);
    expect(clock.frame).toBe(0);
    raf.run(6000);
    expect(clock.frame).toBe(30);
    playback.setSpeed(2);
    raf.run(7000);
    expect(clock.frame).toBe(90);
    expect(clock.direction).toBe(1);
  });

  it("does not slow the match when an animation frame is dropped", () => {
    const { clock, playback } = make();
    playback.play();
    raf.run(0);
    // Half a second passes in one step.
    raf.run(500);
    expect(clock.frame).toBe(15);
  });

  it("stops at the last frame and says so once", () => {
    const { clock, playback, onSettled } = make(100);
    playback.play();
    raf.run(0);
    raf.run(60_000);
    expect(clock.frame).toBe(150);
    expect(playback.getSnapshot().playing).toBe(false);
    expect(raf.waiting.size).toBe(0);
    expect(onSettled).toHaveBeenCalledTimes(1);
    expect(onSettled).toHaveBeenCalledWith(150);
  });

  it("starts again from the first frame when played at the last", () => {
    const { clock, playback } = make(150);
    playback.play();
    expect(clock.frame).toBe(0);
    expect(playback.getSnapshot().playing).toBe(true);
  });

  it("asks for no animation frame once paused", () => {
    const { playback, onSettled, clock } = make();
    playback.play();
    raf.run(0);
    raf.run(1000);
    expect(raf.waiting.size).toBe(1);
    playback.pause();
    expect(raf.waiting.size).toBe(0);
    expect(playback.getSnapshot().playing).toBe(false);
    expect(onSettled).toHaveBeenCalledWith(clock.frame);
    raf.run(5000);
    expect(clock.frame).toBe(30);
  });
});

describe("playing in reverse", () => {
  it("falls by elapsed time times speed times frames per second and gives the clock direction -1", () => {
    const { clock, playback } = make(120);
    playback.play(-1);
    raf.run(0);
    raf.run(1000);
    expect(clock.frame).toBe(90);
    expect(clock.direction).toBe(-1);
  });

  it("stops at the first frame", () => {
    const { clock, playback, onSettled } = make(30);
    playback.play(-1);
    raf.run(0);
    raf.run(10_000);
    expect(clock.frame).toBe(0);
    expect(clock.direction).toBe(-1);
    expect(playback.getSnapshot().playing).toBe(false);
    expect(raf.waiting.size).toBe(0);
    expect(onSettled).toHaveBeenCalledWith(0);
  });

  it("starts again from the last frame when played in reverse at the first", () => {
    const { clock, playback } = make(0);
    playback.play(-1);
    expect(clock.frame).toBe(150);
  });
});

describe("a document that is hidden", () => {
  it("stops the loop, and does not jump ahead when it is seen again", () => {
    const { clock, playback } = make();
    playback.play();
    raf.run(0);
    raf.run(1000);
    expect(clock.frame).toBe(30);

    hidden = true;
    document.dispatchEvent(new Event("visibilitychange"));
    expect(raf.waiting.size).toBe(0);
    expect(playback.getSnapshot().playing).toBe(false);

    hidden = false;
    document.dispatchEvent(new Event("visibilitychange"));
    expect(raf.waiting.size).toBe(0);
    expect(clock.frame).toBe(30);

    // Played again later, the first stamp is only a starting point.
    playback.play();
    raf.run(900_000);
    expect(clock.frame).toBe(30);
    raf.run(901_000);
    expect(clock.frame).toBe(60);
  });
});

describe("seeking", () => {
  it("moves the clock at once, towards the target, and clamps to the match", () => {
    const { clock, playback, sets, onSettled } = make(60);
    playback.seek(20);
    expect(sets).toEqual([[20, -1]]);
    playback.seek(500);
    expect(clock.frame).toBe(150);
    expect(clock.direction).toBe(1);
    playback.seek(-7);
    expect(clock.frame).toBe(0);
    expect(onSettled).toHaveBeenCalledTimes(3);
  });

  it("can move without settling, as a drag does, and settle afterwards", () => {
    const { playback, onSettled, clock } = make(60);
    playback.seek(70, { settle: false });
    playback.seek(80, { settle: false });
    expect(onSettled).not.toHaveBeenCalled();
    playback.settle();
    expect(onSettled).toHaveBeenCalledWith(clock.frame);
  });

  it("steps by a number of frames from where the clock is", () => {
    const { clock, playback } = make(60);
    playback.step(30);
    expect(clock.frame).toBe(90);
    playback.step(-45);
    expect(clock.frame).toBe(45);
  });

  it("stops playing when the knob is dragged, and leaves settling to the end of the drag", () => {
    const { playback, onSettled } = make(60);
    playback.play();
    raf.run(0);
    playback.seek(10, { settle: false, pause: true });
    expect(playback.getSnapshot().playing).toBe(false);
    expect(raf.waiting.size).toBe(0);
    expect(onSettled).not.toHaveBeenCalled();
  });
});

describe("speed", () => {
  it("steps through the speeds and stops at either end", () => {
    const { playback } = make();
    const start = SPEEDS.indexOf(playback.getSnapshot().speed);
    expect(start).toBeGreaterThanOrEqual(0);
    playback.faster();
    expect(playback.getSnapshot().speed).toBe(SPEEDS[start + 1]);
    for (let i = 0; i < SPEEDS.length; i++) playback.faster();
    expect(playback.getSnapshot().speed).toBe(SPEEDS[SPEEDS.length - 1]);
    for (let i = 0; i < SPEEDS.length; i++) playback.slower();
    expect(playback.getSnapshot().speed).toBe(SPEEDS[0]);
  });

  it("ignores a speed that is not one of the speeds", () => {
    const { playback } = make();
    const before = playback.getSnapshot().speed;
    playback.setSpeed(3);
    expect(playback.getSnapshot().speed).toBe(before);
  });
});

describe("direction", () => {
  it("plays the other way, and starts playing when paused", () => {
    const { clock, playback } = make(60);
    playback.reverse();
    expect(playback.getSnapshot()).toMatchObject({
      playing: true,
      direction: -1,
    });
    raf.run(0);
    raf.run(1000);
    expect(clock.frame).toBe(30);
    playback.reverse();
    expect(playback.getSnapshot().direction).toBe(1);
  });
});

describe("dispose", () => {
  it("cancels the pending animation frame and stops listening", () => {
    const { playback, onSettled } = make();
    playback.play();
    expect(raf.waiting.size).toBe(1);
    playback.dispose();
    expect(raf.waiting.size).toBe(0);

    hidden = true;
    document.dispatchEvent(new Event("visibilitychange"));
    expect(onSettled).not.toHaveBeenCalled();
  });

  it("notifies subscribers when the state changes and not after they stop", () => {
    const { playback } = make();
    const listener = vi.fn();
    const stop = playback.subscribe(listener);
    playback.play();
    expect(listener).toHaveBeenCalledTimes(1);
    stop();
    playback.pause();
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

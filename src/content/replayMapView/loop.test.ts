/** When the map view draws and when it does not (#3807). */
import { describe, expect, it, vi } from "vitest";
import { createReplayClock } from "./clock";
import { createMapView, type MapViewStatus } from "./loop";
import { teamStyles } from "./paint";
import { fixtureHeader, recordingContext, testTrack } from "./testTrack";

/** Animation frames, run by hand. */
function frames() {
  const waiting = new Map<number, () => void>();
  let next = 1;
  return {
    env: {
      requestFrame: vi.fn((cb: () => void) => {
        waiting.set(next, cb);
        return next++;
      }),
      cancelFrame: vi.fn((id: number) => {
        waiting.delete(id);
      }),
    },
    waiting: () => waiting.size,
    /** Runs the frames asked for so far. */
    run() {
      const due = [...waiting.values()];
      waiting.clear();
      for (const cb of due) cb();
    },
  };
}

function setup(frame = 45) {
  const track = testTrack();
  const clock = createReplayClock(frame);
  const raf = frames();
  const ctx = recordingContext();
  const statuses: MapViewStatus[] = [];
  const painted: { frame: number; units: number }[] = [];
  const lost = vi.fn();
  const view = createMapView({
    handle: track.handle,
    clock,
    teams: teamStyles(fixtureHeader.teams),
    surface: () => ({
      ctx,
      view: { width: 1024, height: 768, scale: 1024 / 8192, pixelRatio: 1 },
    }),
    env: raf.env,
    onStatus: (s) => statuses.push(s),
    onPainted: (f, counts) => painted.push({ frame: f, units: counts.units }),
    onHighlightLost: lost,
  });
  const pictures = () => ctx.count("clearRect");
  /** Answers every window asked for, then runs the frame that follows. */
  const load = async () => {
    for (const k of track.waiting()) await track.arrive(k);
    raf.run();
  };
  return {
    track,
    clock,
    raf,
    ctx,
    view,
    statuses,
    painted,
    pictures,
    load,
    lost,
  };
}

describe("createMapView", () => {
  it("draws nothing until it is shown", () => {
    const { raf, view } = setup();
    expect(raf.env.requestFrame).not.toHaveBeenCalled();
    view.setShown(true);
    expect(raf.waiting()).toBe(1);
  });

  it("draws the clock's frame once its window has arrived", async () => {
    const s = setup(45);
    s.view.setShown(true);
    s.raf.run();
    // The window is still on its way: no picture yet.
    expect(s.pictures()).toBe(0);
    expect(s.statuses.at(-1)).toEqual({ kind: "loading" });
    await s.load();
    expect(s.pictures()).toBe(1);
    expect(s.painted).toEqual([{ frame: 45, units: 2 }]);
    expect(s.statuses.at(-1)).toEqual({ kind: "ready" });
  });

  it("asks for no frame while nothing has changed", async () => {
    const s = setup(45);
    s.view.setShown(true);
    s.raf.run();
    await s.load();
    const asked = s.raf.env.requestFrame.mock.calls.length;
    // A paused view: frames pass and it neither draws nor asks for another.
    s.raf.run();
    s.raf.run();
    expect(s.raf.waiting()).toBe(0);
    expect(s.raf.env.requestFrame.mock.calls.length).toBe(asked);
    expect(s.pictures()).toBe(1);
  });

  it("draws again when the time changes, once for each frame however many changes", async () => {
    const s = setup(45);
    s.view.setShown(true);
    s.raf.run();
    await s.load();
    s.clock.set(46);
    s.clock.set(47);
    s.clock.set(48.5);
    expect(s.raf.waiting()).toBe(1);
    s.raf.run();
    expect(s.pictures()).toBe(2);
    expect(s.painted.at(-1)).toEqual({ frame: 48.5, units: 2 });
  });

  it("draws again when the canvas changes size", async () => {
    const s = setup(45);
    s.view.setShown(true);
    s.raf.run();
    await s.load();
    s.view.invalidate();
    s.raf.run();
    expect(s.pictures()).toBe(2);
  });

  it("stops when it is hidden and draws the newest time when it comes back", async () => {
    const s = setup(45);
    s.view.setShown(true);
    s.raf.run();
    await s.load();
    s.clock.set(46);
    expect(s.raf.waiting()).toBe(1);
    s.view.setShown(false);
    // The frame it had asked for is taken back.
    expect(s.raf.env.cancelFrame).toHaveBeenCalledTimes(1);
    expect(s.raf.waiting()).toBe(0);
    s.clock.set(50);
    s.clock.set(52);
    expect(s.raf.waiting()).toBe(0);
    expect(s.pictures()).toBe(1);

    s.view.setShown(true);
    s.raf.run();
    expect(s.pictures()).toBe(2);
    expect(s.painted.at(-1)).toEqual({ frame: 52, units: 2 });
  });

  it("keeps the last picture while a window loads, and draws when it arrives", async () => {
    const s = setup(45);
    s.view.setShown(true);
    s.raf.run();
    await s.load();
    const calls = s.ctx.calls.length;
    // Frame 149 is in window 2, which is not held.
    s.clock.set(149);
    s.raf.run();
    expect(s.ctx.calls.length).toBe(calls);
    expect(s.statuses.at(-1)).toEqual({ kind: "loading" });
    expect(s.track.waiting()).toContain(2);
    await s.load();
    expect(s.pictures()).toBe(2);
    expect(s.painted.at(-1)).toEqual({ frame: 149, units: 2 });
    expect(s.statuses.at(-1)).toEqual({ kind: "ready" });
  });

  it("names a window that cannot be read, keeps the picture, and goes on drawing other times", async () => {
    const s = setup(45);
    s.view.setShown(true);
    s.raf.run();
    await s.load();
    s.clock.set(149);
    s.raf.run();
    const calls = s.ctx.calls.length;
    await s.track.fail(2);
    s.raf.run();
    const last = s.statuses.at(-1);
    expect(last?.kind).toBe("fault");
    expect(last?.kind === "fault" && last.error.kind).toBe("corruptWindow");
    expect(s.ctx.calls.length).toBe(calls);

    s.clock.set(45, -1);
    s.raf.run();
    await s.load();
    expect(s.statuses.at(-1)).toEqual({ kind: "ready" });
    expect(s.painted.at(-1)).toEqual({ frame: 45, units: 2 });
  });

  it("says a status once, not on every frame", async () => {
    const s = setup(45);
    s.view.setShown(true);
    s.raf.run();
    await s.load();
    s.clock.set(46);
    s.raf.run();
    s.clock.set(47);
    s.raf.run();
    expect(s.statuses.map((x) => x.kind)).toEqual(["loading", "ready"]);
  });

  it("finds the unit under a point of the canvas", async () => {
    const s = setup(30);
    s.view.setShown(true);
    s.raf.run();
    await s.load();
    // Unit 1 is at 3000, 2000 elmos, and the canvas is an eighth of that.
    expect(s.view.pick(375, 250)).toEqual({ serial: 1, def: 1, team: 1 });
    // A mark is at least 3 pixels, so 1 pixel off the middle still finds it.
    expect(s.view.pick(376, 251)?.serial).toBe(1);
    expect(s.view.pick(600, 600)).toBeNull();
  });

  it("rings the unit it is told to, and says when that unit is gone", async () => {
    const s = setup(45);
    s.view.setShown(true);
    s.raf.run();
    await s.load();
    s.view.setHighlight(1);
    s.raf.run();
    expect(s.ctx.count("arc")).toBe(1);
    expect(s.lost).not.toHaveBeenCalled();
    // Unit 1 dies at frame 89.
    s.clock.set(100);
    s.raf.run();
    await s.load();
    expect(s.lost).toHaveBeenCalledTimes(1);
  });

  it("stops for good when it is disposed", async () => {
    const s = setup(45);
    s.view.setShown(true);
    s.raf.run();
    await s.load();
    s.view.dispose();
    s.clock.set(60);
    s.view.invalidate();
    expect(s.raf.waiting()).toBe(0);
    expect(s.pictures()).toBe(1);
  });
});

describe("createReplayClock", () => {
  it("tells its listeners when the time or the direction changes, and not when neither does", () => {
    const clock = createReplayClock(10);
    const heard = vi.fn();
    const stop = clock.subscribe(heard);
    expect([clock.frame, clock.direction]).toEqual([10, 1]);
    clock.set(10);
    expect(heard).not.toHaveBeenCalled();
    clock.set(12);
    clock.set(12, -1);
    expect(heard).toHaveBeenCalledTimes(2);
    expect([clock.frame, clock.direction]).toEqual([12, -1]);
    stop();
    clock.set(20);
    expect(heard).toHaveBeenCalledTimes(2);
  });
});

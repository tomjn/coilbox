import type { ReplayTrackError, ReplayTrackHandle } from "../replayTrack";
import type { ReplayClock } from "./clock";
import {
  LEAST_HALF_MARK,
  type MapViewport,
  type PaintContext,
  type PaintCounts,
  paintScene,
  type TeamStyle,
} from "./paint";
import { collectScene, createMapScene, unitAt } from "./scene";

/** What the view can say about the frame it was last asked to draw. */
export type MapViewStatus =
  | { kind: "ready" }
  /** The frame's window is on its way. The last picture stays up. */
  | { kind: "loading" }
  /** The frame's window cannot be read. Other times still draw. */
  | { kind: "fault"; error: ReplayTrackError };

/** The browser's animation frames, so a test can run them by hand. */
export interface MapViewEnv {
  requestFrame(callback: () => void): number;
  cancelFrame(id: number): void;
}

export interface MapViewOptions {
  handle: ReplayTrackHandle;
  clock: ReplayClock;
  teams: ReadonlyMap<number, TeamStyle>;
  /** The canvas's context and its size now, or null when there is none. */
  surface(): { ctx: PaintContext; view: MapViewport } | null;
  env: MapViewEnv;
  /** Called when the status changes, not on every frame. */
  onStatus(status: MapViewStatus): void;
  /** Called after every picture, with what it drew. */
  onPainted(frame: number, counts: PaintCounts): void;
  /** Called once when the ringed unit is no longer in the picture. */
  onHighlightLost(): void;
}

export interface MapView {
  /** Say the picture is out of date: the canvas changed size, for one. */
  invalidate(): void;
  /** Whether anyone can see the canvas. It draws only while they can. */
  setShown(shown: boolean): void;
  /** Ring the unit with this serial, or none. */
  setHighlight(serial: number | null): void;
  /** The unit under a point of the canvas, in the canvas's own pixels. */
  pick(
    x: number,
    y: number,
  ): { serial: number; def: number; team: number } | null;
  /** Draws the clock's frame now, whether shown or not. For measuring. */
  drawNow(): PaintCounts | null;
  dispose(): void;
}

/** How far outside a mark the pointer still finds it, in CSS pixels. */
const PICK_SLOP = 2;

/**
 * Draws a track on a canvas as time moves (#3807).
 *
 * It draws when something changed and at no other time. A change is the clock
 * moving, a window arriving, dropping or failing, the canvas changing size, or
 * the ringed unit changing. Each marks the picture out of date and asks for
 * one animation frame, and the frame draws once however many changes came
 * before it. With nothing changing no frame is asked for, so a paused view
 * costs nothing.
 *
 * While nobody can see the canvas it asks for no frame at all, and takes back
 * one it had asked for. Changes in that time are remembered as one out of date
 * picture, drawn when the canvas is seen again.
 */
export function createMapView(options: MapViewOptions): MapView {
  const { handle, clock, env } = options;
  const scene = createMapScene();
  let shown = false;
  let dirty = true;
  let pending: number | null = null;
  let disposed = false;
  let highlight: number | null = null;
  let status: string | null = null;
  /** The size the scene was last painted at, for the pointer. */
  let painted: MapViewport | null = null;

  const say = (next: MapViewStatus) => {
    const key =
      next.kind === "fault" ? `fault ${next.error.message}` : next.kind;
    if (key === status) return;
    status = key;
    options.onStatus(next);
  };

  const draw = (): PaintCounts | null => {
    const frame = clock.frame;
    handle.follow(frame, clock.direction);
    const surface = options.surface();
    if (!surface) return null;
    if (!collectScene(handle, frame, scene)) {
      const error = handle.windowFault(frame);
      say(error ? { kind: "fault", error } : { kind: "loading" });
      return null;
    }
    const counts = paintScene(
      surface.ctx,
      scene,
      surface.view,
      options.teams,
      highlight,
    );
    painted = surface.view;
    say({ kind: "ready" });
    options.onPainted(frame, counts);
    if (highlight !== null && !counts.highlighted) {
      highlight = null;
      options.onHighlightLost();
    }
    return counts;
  };

  const tick = () => {
    pending = null;
    if (disposed || !dirty) return;
    dirty = false;
    draw();
  };

  const schedule = () => {
    if (disposed || !shown || !dirty || pending !== null) return;
    pending = env.requestFrame(tick);
  };

  const invalidate = () => {
    dirty = true;
    schedule();
  };

  const stops = [clock.subscribe(invalidate), handle.subscribe(invalidate)];

  return {
    invalidate,
    setShown(next) {
      if (next === shown) return;
      shown = next;
      if (shown) {
        schedule();
      } else if (pending !== null) {
        env.cancelFrame(pending);
        pending = null;
      }
    },
    setHighlight(serial) {
      if (serial === highlight) return;
      highlight = serial;
      invalidate();
    },
    pick(x, y) {
      if (!painted || scene.frame < 0) return null;
      const { scale, pixelRatio } = painted;
      const found = unitAt(
        scene,
        x / scale,
        y / scale,
        (LEAST_HALF_MARK * pixelRatio) / scale,
        (PICK_SLOP * pixelRatio) / scale,
      );
      if (found < 0) return null;
      return {
        serial: scene.unitSerial[found],
        def: scene.unitDef[found],
        team: scene.unitTeam[found],
      };
    },
    drawNow: draw,
    dispose() {
      disposed = true;
      if (pending !== null) env.cancelFrame(pending);
      pending = null;
      for (const stop of stops) stop();
    },
  };
}

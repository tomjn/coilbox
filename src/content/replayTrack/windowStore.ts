import { ReplayTrackError } from "./fault";
import type { TrackWindow } from "./trackWindow";

/** How a track is cut into windows. From the track's header. */
export interface WindowGeometry {
  firstFrame: number;
  windowLength: number;
  windowCount: number;
}

/** Which way time is going: 1 forward, -1 backward. */
export type Direction = 1 | -1;

/**
 * The window that holds `frame`. A frame on the boundary between two windows is
 * in both, and this gives the later, except at the track's last frame, which
 * has no later window. A frame past the end is in the last window and one
 * before the start is in the first. The arithmetic of `window_of_frame` in
 * `crates/coilbox-track/src/header.rs`, whose comment says the earlier.
 */
export function windowOfFrame(g: WindowGeometry, frame: number): number {
  const k = Math.floor(Math.max(frame - g.firstFrame, 0) / g.windowLength);
  return Math.min(k, g.windowCount - 1);
}

/**
 * The windows of one track that the frontend holds (#3806): the window the time
 * is in, and the next one in the direction of travel. Every other window is
 * dropped as soon as {@link follow} says time has moved away from it.
 *
 * Why the next window in the direction of travel and not always the later one:
 * the timeline can play in reverse, and then the window about to be needed is
 * the earlier one. Holding two windows keeps a boundary crossing from waiting on
 * a load, since both sides are in memory before time reaches it.
 *
 * A window that cannot be read is recorded against its own index and the others
 * go on loading. It is asked for again only once time has moved off it and come
 * back, so an animation loop that calls {@link follow} every frame does not
 * read a bad window sixty times a second.
 */
export interface WindowStore {
  /**
   * Say where time is and which way it is going. Starts any load that is
   * needed and drops any window that is not the current or the next. Cheap to
   * call on every animation frame.
   */
  follow(frame: number, direction: Direction): void;
  /** The held window that has `frame`, or none while it is still loading. */
  windowFor(frame: number): TrackWindow | undefined;
  /** The indexes of the windows held, rising. */
  held(): readonly number[];
  /** Why window `index` could not be read, if it could not. */
  failure(index: number): ReplayTrackError | undefined;
  /** Called when a window arrives, is dropped or fails. Returns the stop. */
  subscribe(listener: () => void): () => void;
  /** Drops every window. Windows still on their way are ignored. */
  dispose(): void;
}

function asError(e: unknown): ReplayTrackError {
  if (e instanceof ReplayTrackError) return e;
  return new ReplayTrackError({
    kind: "io",
    message: e instanceof Error ? e.message : String(e),
  });
}

export function createWindowStore(
  geometry: WindowGeometry,
  load: (index: number) => Promise<TrackWindow>,
): WindowStore {
  const held = new Map<number, TrackWindow>();
  const pending = new Set<number>();
  const failures = new Map<number, ReplayTrackError>();
  const listeners = new Set<() => void>();
  let wanted = new Set<number>();
  let lastIndex = -1;
  let lastDirection: Direction | 0 = 0;
  let disposed = false;

  const emit = () => {
    for (const l of listeners) l();
  };

  const start = (index: number) => {
    pending.add(index);
    load(index).then(
      (window) => {
        pending.delete(index);
        if (disposed || !wanted.has(index)) return;
        held.set(index, window);
        emit();
      },
      (e) => {
        pending.delete(index);
        if (disposed || !wanted.has(index)) return;
        failures.set(index, asError(e));
        emit();
      },
    );
  };

  return {
    follow(frame, direction) {
      if (disposed) return;
      const current = windowOfFrame(geometry, frame);
      if (current === lastIndex && direction === lastDirection) return;
      lastIndex = current;
      lastDirection = direction;
      const next = Math.min(
        Math.max(current + direction, 0),
        geometry.windowCount - 1,
      );
      wanted = new Set([current, next]);

      let changed = false;
      for (const index of [...held.keys()]) {
        if (!wanted.has(index)) {
          held.delete(index);
          changed = true;
        }
      }
      for (const index of [...failures.keys()]) {
        if (!wanted.has(index)) failures.delete(index);
      }
      for (const index of wanted) {
        if (!held.has(index) && !pending.has(index) && !failures.has(index)) {
          start(index);
        }
      }
      if (changed) emit();
    },

    windowFor(frame) {
      const k = windowOfFrame(geometry, frame);
      const here = held.get(k);
      if (here) return here;
      // The last frame of the window before is also the first of this one.
      const before = held.get(k - 1);
      return before && frame === before.endFrame ? before : undefined;
    },

    held: () => [...held.keys()].sort((a, b) => a - b),

    failure: (index) => failures.get(index),

    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    dispose() {
      disposed = true;
      held.clear();
      failures.clear();
      listeners.clear();
    },
  };
}

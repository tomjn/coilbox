import type { Direction } from "../replayTrack";

/**
 * Where the map view's time is and which way it is going (#3807).
 *
 * The view takes its time from one of these and never from a prop, so time can
 * move on every animation frame without React rendering anything. Whatever
 * owns the time calls {@link ReplayClock.set}: for now the replay page's
 * slider, and the timeline of #3808 when it exists.
 */
export interface ReplayClock {
  /** A frame of the track. It may fall between two whole frames. */
  readonly frame: number;
  readonly direction: Direction;
  /** Moves time. The direction stays as it was when none is given. */
  set(frame: number, direction?: Direction): void;
  /** Called when the frame or the direction changes. Returns the stop. */
  subscribe(listener: () => void): () => void;
}

export function createReplayClock(frame: number): ReplayClock {
  const listeners = new Set<() => void>();
  let at = frame;
  let way: Direction = 1;
  return {
    get frame() {
      return at;
    },
    get direction() {
      return way;
    },
    set(next, direction = way) {
      if (next === at && direction === way) return;
      at = next;
      way = direction;
      for (const listener of listeners) listener();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

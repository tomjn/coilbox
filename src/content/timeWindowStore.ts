import type { TimeWindow } from "./replayTimeWindow";

/**
 * The stretch of the match the replay map's layers add up (#1153), held once so
 * the timeline dock's Heat window lane and the map agree (#5309). The lane
 * writes it and the layers read it.
 *
 * `null` is the whole match. An end held at `Infinity` is the end of the match
 * whatever its length, so a reader whose axis is a little longer than the
 * dock's still reaches its own end. Nothing is stored between visits.
 */
export interface TimeWindowStore {
  getState(): TimeWindow | null;
  subscribe(listener: () => void): () => void;
  set(window: TimeWindow | null): void;
}

const same = (a: TimeWindow | null, b: TimeWindow | null) =>
  a === b ||
  (a !== null &&
    b !== null &&
    a.startSec === b.startSec &&
    a.endSec === b.endSec);

export function createTimeWindowStore(): TimeWindowStore {
  let state: TimeWindow | null = null;
  const listeners = new Set<() => void>();
  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    set(window) {
      if (same(state, window)) return;
      state = window;
      for (const l of listeners) l();
    },
  };
}

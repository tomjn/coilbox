import { useMemo, useSyncExternalStore } from "react";
import { type TimeWindow, toWindow } from "./replayTimeWindow";
import { useTimeWindowStore } from "./useSeriesEmphasis";

/**
 * The window the replay map is read through (#1153), as the timeline dock's
 * Heat window lane has set it (#5309). `null` is the whole match.
 *
 * It belongs to one replay for as long as the page is open. The store is made
 * with the page's other stores, which are keyed by replay, so another replay
 * starts on the whole match.
 */
export function useReplayTimeWindow(domainSec: number): TimeWindow | null {
  const store = useTimeWindowStore();
  const held = useSyncExternalStore(store.subscribe, store.getState);
  return useMemo(
    // The match can turn out shorter than the window was set on.
    () => (held ? toWindow(held.startSec, held.endSec, domainSec) : null),
    [held, domainSec],
  );
}

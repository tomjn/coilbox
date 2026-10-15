import { useCallback, useMemo, useState } from "react";
import { type TimeWindow, toWindow } from "./replayTimeWindow";

/**
 * The window the replay map is read through (#1153).
 *
 * It belongs to one replay for as long as the page is open. It is not stored,
 * and another replay starts on the whole match: the window is remembered with
 * the path it was set for and read only for that path, so the render right
 * after the path changes already shows the whole match. `null` is the whole
 * match.
 */
export function useReplayTimeWindow(
  replayPath: string,
  domainSec: number,
): [TimeWindow | null, (window: TimeWindow | null) => void] {
  const [held, setHeld] = useState<{
    path: string;
    window: TimeWindow | null;
  } | null>(null);
  const window = useMemo(() => {
    if (held?.path !== replayPath || !held.window) return null;
    // The match can turn out shorter than the window was set on.
    return toWindow(held.window.startSec, held.window.endSec, domainSec);
  }, [held, replayPath, domainSec]);
  const set = useCallback(
    (next: TimeWindow | null) => setHeld({ path: replayPath, window: next }),
    [replayPath],
  );
  return [window, set];
}

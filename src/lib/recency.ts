/**
 * Pick the single most-recent "open" (resumable) item from a list, or
 * `undefined` if none qualify. Shared by every per-screen "continue playing"
 * affordance (issue #374): conquest/warpath pick their most recently updated
 * active run, campaign picks the most recently touched incomplete mission,
 * skirmish picks the most recently used preset, and replays pick the most
 * recent unwatched one. Kept generic and pure so each caller supplies its own
 * notion of "open" and its own timestamp, and so the selection itself is
 * covered by a plain unit test.
 */
export function mostRecentOpen<T>(
  items: readonly T[],
  isOpen: (item: T) => boolean,
  timestampMs: (item: T) => number,
): T | undefined {
  let best: T | undefined;
  let bestTs = -Infinity;
  for (const item of items) {
    if (!isOpen(item)) continue;
    const ts = timestampMs(item);
    if (ts > bestTs) {
      best = item;
      bestTs = ts;
    }
  }
  return best;
}

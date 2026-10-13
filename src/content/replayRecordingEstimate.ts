import type { RecordingCost } from "./bindings";
import { sameGameFamily } from "./resolveContent";

/**
 * What the next recording will probably cost (#3788), from the recordings this
 * machine has already made of the same game.
 *
 * Only the same game is used. Games differ a lot in how much a frame costs,
 * so an estimate from another game would be a number with nothing behind it.
 * The figures pool the past recordings by total, so a long match counts for
 * more than a short one. Null when there is nothing to go by.
 */
export function estimateRecording(
  costs: readonly RecordingCost[],
  gameType: string,
  frames: number,
): { seconds: number; bytes: number; runs: number } | null {
  if (frames <= 0) return null;
  let pastFrames = 0;
  let pastMillis = 0;
  let pastBytes = 0;
  let runs = 0;
  for (const c of costs) {
    if (c.frames <= 0 || c.millis <= 0 || c.trackBytes <= 0) continue;
    if (!sameGameFamily(c.game, gameType)) continue;
    pastFrames += c.frames;
    pastMillis += c.millis;
    pastBytes += c.trackBytes;
    runs += 1;
  }
  if (runs === 0) return null;
  return {
    seconds: Math.round(((pastMillis / pastFrames) * frames) / 1000),
    bytes: Math.round((pastBytes / pastFrames) * frames),
    runs,
  };
}

/**
 * What storing the new track does to the disk budget. The budget is applied
 * after a track is stored: older tracks go, oldest first, until the total fits
 * (`removesOlder`). A track larger than the whole budget is kept and every
 * other track goes (`largerThanBudget`). The replay's own earlier track is
 * replaced, so `ownBytes` is not counted twice. Null when it fits, and when
 * there is no size estimate or no budget to compare it with.
 */
export function budgetEffect(facts: {
  budgetBytes: number | null;
  totalBytes: number;
  ownBytes: number;
  estimateBytes: number | null;
}): "removesOlder" | "largerThanBudget" | null {
  const { budgetBytes, totalBytes, ownBytes, estimateBytes } = facts;
  if (budgetBytes === null || estimateBytes === null) return null;
  if (estimateBytes > budgetBytes) return "largerThanBudget";
  if (totalBytes - ownBytes + estimateBytes > budgetBytes)
    return "removesOlder";
  return null;
}

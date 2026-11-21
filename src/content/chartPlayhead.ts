import type { MatchRange } from "./useMatchClock";

/**
 * A chart's time axis counts seconds from the start of the match. The match
 * clock counts frames, from the first frame of its range.
 */
export function frameToChartSec(range: MatchRange, frame: number): number {
  return (frame - range.firstFrame) / range.framesPerSecond;
}

/** The whole frame nearest a chart's time in seconds. */
export function chartSecToFrame(range: MatchRange, sec: number): number {
  return Math.round(range.firstFrame + sec * range.framesPerSecond);
}

/** How far the pointer must travel before a press on a chart is a drag. */
export const DRAG_THRESHOLD_PX = 4;

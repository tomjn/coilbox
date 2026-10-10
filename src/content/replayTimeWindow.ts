/**
 * A window over match time for the replay map's layers (#1153).
 *
 * A heatmap of a whole match answers "where did anything happen", and a
 * reader usually wants "where was the fight at minute 12". These are the pure
 * parts: a window in seconds, the frames it covers, and the filter that keeps
 * the points inside it. The filter takes a parallel array of frames, or a list
 * of objects that each have one, so a layer built from either shape calls the
 * same code. The control that edits the window is `ReplayTimeWindowControl`.
 */

import type { HeatPoints } from "@/lib/heatField";
import type { DemoInfo, DemoTrailer, Metric } from "./bindings";
import { FRAMES_PER_SECOND } from "./chatClock";
import {
  type ChartRow,
  type ChartSeries,
  defaultMetric,
  modeRows,
  secondsPerFrame,
  teamSeries,
} from "./matchStats";

/** A stretch of match time in whole seconds from the start of the game. */
export interface TimeWindow {
  startSec: number;
  endSec: number;
}

/**
 * The frames a window covers, both ends included. An end that is not a number
 * you can compare with a frame is infinite: the start of the match takes
 * everything before it, orders given before the game began among them, and the
 * end of the match takes everything after it.
 */
export interface FrameRange {
  from: number;
  to: number;
}

/** The range that keeps everything. */
export const WHOLE_MATCH: FrameRange = {
  from: Number.NEGATIVE_INFINITY,
  to: Number.POSITIVE_INFINITY,
};

/** Whether a range keeps every frame, so a caller can skip the copy. */
export function isWholeMatch(range: FrameRange): boolean {
  return range.from === WHOLE_MATCH.from && range.to === WHOLE_MATCH.to;
}

/**
 * A window as the frames it covers.
 *
 * `null` is the whole match. A window that starts at zero reaches back over
 * pregame frames, which are negative, the way the build order opening does when
 * a cut is set. A window that ends at the match's end reaches on past it, so an
 * order a frame after a whole second boundary is not lost to rounding.
 */
export function windowRange(
  window: TimeWindow | null,
  domainSec: number,
): FrameRange {
  if (!window) return WHOLE_MATCH;
  return {
    from:
      window.startSec <= 0
        ? WHOLE_MATCH.from
        : window.startSec * FRAMES_PER_SECOND,
    to:
      window.endSec >= domainSec
        ? WHOLE_MATCH.to
        : window.endSec * FRAMES_PER_SECOND,
  };
}

/** The window a pair of seconds describes, or null when it is the whole match.
 *  Clamped to the match and kept at least a second wide. */
export function toWindow(
  startSec: number,
  endSec: number,
  domainSec: number,
): TimeWindow | null {
  const start = Math.max(0, Math.min(Math.round(startSec), domainSec - 1));
  const end = Math.min(domainSec, Math.max(Math.round(endSec), start + 1));
  return start <= 0 && end >= domainSec
    ? null
    : { startSec: start, endSec: end };
}

/** The indexes of the frames inside a range, in order. */
export function frameIndexes(
  frames: ArrayLike<number>,
  range: FrameRange,
): Uint32Array {
  const kept = new Uint32Array(frames.length);
  let n = 0;
  for (let i = 0; i < frames.length; i++)
    if (frames[i] >= range.from && frames[i] <= range.to) kept[n++] = i;
  return kept.subarray(0, n);
}

/** How many frames are inside a range. */
export function countInRange(
  frames: ArrayLike<number>,
  range: FrameRange,
): number {
  let n = 0;
  for (let i = 0; i < frames.length; i++)
    if (frames[i] >= range.from && frames[i] <= range.to) n++;
  return n;
}

/** The items whose frame is inside a range. The same array when the range
 *  keeps everything, so a memo downstream does not rebuild for nothing. */
export function filterByFrame<T extends { frame: number }>(
  items: readonly T[],
  range: FrameRange,
): readonly T[] {
  if (isWholeMatch(range)) return items;
  return items.filter(
    (item) => item.frame >= range.from && item.frame <= range.to,
  );
}

/**
 * Points for a density field, kept to those whose frame is inside a range.
 * `frames` holds one frame per point, parallel to `points`. The same object
 * when the range keeps everything.
 */
export function windowPoints(
  points: HeatPoints,
  frames: ArrayLike<number>,
  range: FrameRange,
): HeatPoints {
  if (isWholeMatch(range)) return points;
  const kept = frameIndexes(frames, range);
  const positions = new Float32Array(kept.length * 2);
  const weights = points.weights ? new Float32Array(kept.length) : undefined;
  for (let i = 0; i < kept.length; i++) {
    const at = kept[i];
    positions[i * 2] = points.positions[at * 2];
    positions[i * 2 + 1] = points.positions[at * 2 + 1];
    if (weights && points.weights) weights[i] = points.weights[at];
  }
  return weights ? { positions, weights } : { positions };
}

/**
 * The window's presets, which are the issue's own choice of "the first five
 * minutes and the last five minutes". A product choice and not a measurement
 * of how matches go.
 */
export const PRESET_MINUTES = 5;

export interface WindowPreset {
  id: "first" | "last";
  label: string;
  window: TimeWindow;
}

/**
 * The presets that narrow a match of this length. A match of five minutes or
 * less has none, because each would be the whole match. Between five and ten
 * minutes the two overlap, which is what they are.
 */
export function windowPresets(domainSec: number): WindowPreset[] {
  const length = PRESET_MINUTES * 60;
  if (!(domainSec > length)) return [];
  const label = `${PRESET_MINUTES} minutes`;
  return [
    {
      id: "first",
      label: `First ${label}`,
      window: { startSec: 0, endSec: length },
    },
    {
      id: "last",
      label: `Last ${label}`,
      window: {
        startSec: Math.ceil(domainSec) - length,
        endSec: Math.ceil(domainSec),
      },
    },
  ];
}

/** One point of the silhouette behind the range. */
export interface ActivityPoint {
  timeSec: number;
  value: number;
}

/** What is drawn behind the range: one series for the whole match. */
export interface ActivitySeries {
  label: string;
  points: ActivityPoint[];
}

/**
 * The outline of a series as an SVG path in a box 100 wide and 100 tall, with
 * the match's start at the left edge and its end at the right, so it lines up
 * with a range over the same seconds. A point past the match's end is left
 * out. Null when there is nothing above zero to draw.
 */
export function activityPath(
  points: ActivityPoint[],
  domainSec: number,
): string | null {
  const inside = points.filter((p) => p.timeSec >= 0 && p.timeSec <= domainSec);
  const peak = Math.max(0, ...inside.map((p) => p.value));
  if (!(domainSec > 0) || peak <= 0) return null;
  const at = (p: ActivityPoint) =>
    `${((p.timeSec / domainSec) * 100).toFixed(2)},${(100 - (Math.max(0, p.value) / peak) * 100).toFixed(2)}`;
  const first = inside[0];
  const last = inside[inside.length - 1];
  const x = (p: ActivityPoint) => ((p.timeSec / domainSec) * 100).toFixed(2);
  return `M${x(first)},100 L${inside.map(at).join(" L")} L${x(last)},100 Z`;
}

/** Every team's value in each row, added up. A row where no team has a value
 *  is left out. */
export function sumRows(
  rows: ChartRow[],
  series: ChartSeries[],
): ActivityPoint[] {
  const points: ActivityPoint[] = [];
  for (const row of rows) {
    let total = 0;
    let any = false;
    for (const s of series) {
      const value = row[s.id];
      if (typeof value === "number") {
        total += value;
        any = true;
      }
    }
    if (any) points.push({ timeSec: row.timeSec, value: total });
  }
  return points;
}

/**
 * The series to draw behind the range, or null when there is nothing to draw.
 *
 * It is the metric the registry leads with, the one the match chart opens on,
 * as a rate and summed across teams, so the spikes are where the match was
 * busiest. The rate comes from the chart's own `modeRows`.
 */
export function activitySeries(
  trailer: DemoTrailer | null,
  info: DemoInfo,
  metrics: Metric[],
): ActivitySeries | null {
  const metric = defaultMetric(metrics);
  if (!trailer || !metric) return null;
  const series = teamSeries(trailer, info);
  if (series.length === 0) return null;
  const rows = modeRows(
    series,
    metric.key,
    secondsPerFrame(trailer),
    "perMinute",
  );
  const points = sumRows(rows, series);
  return points.length > 0
    ? { label: `${metric.label} per minute`, points }
    : null;
}

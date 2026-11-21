/**
 * How much of the replay page's window the timeline dock may take, and which of
 * its rows fit in that (#5356).
 */

/** The most of the window's height the dock takes: 30%. A design choice. A
 *  window of 940 pixels gives the dock 282 pixels, which is more than the 231
 *  that all its rows need, and a window of 600 gives it 180. */
export const DOCK_MAX_SHARE = 0.3;

/** The dock's cap as a CSS length, which is the same share the rows are fitted
 *  to. `vh` is the window's height. */
export const DOCK_MAX_HEIGHT = `${DOCK_MAX_SHARE * 100}vh`;

/** A lane the dock can fold away, in the order it is kept: the first is the
 *  last to go. */
export type DockLane = "kills" | "chat" | "players" | "metric" | "heat";

/** The order a lane is kept in. Kills come first because a match is told by who
 *  died, and the Heat window comes last because it only steers the map. */
export const DOCK_LANE_ORDER: readonly DockLane[] = [
  "kills",
  "chat",
  "players",
  "metric",
  "heat",
];

/**
 * The heights the dock's rows have in CSS pixels. They repeat the classes in
 * `ReplayTimelineDock.tsx` (`h-5`, `h-12`, `h-8`, `h-4`, `py-2`, `gap-1.5` and
 * the top border). The whole dock measured 231 pixels with every lane.
 */
export const DOCK_ROW_PX = {
  /** The padding and the top border, and the gap between the two blocks. */
  frame: 2 * 8 + 1 + 6,
  /** The height of the Open in engine button, which is the tallest in the row. */
  transport: 32,
  scrubber: 20,
  axis: 16,
  kills: 20,
  chat: 20,
  players: 20,
  metric: 48,
  heat: 32,
} as const satisfies Record<string, number>;

/** The height of the dock with these lanes. */
export function dockHeight(lanes: readonly DockLane[]): number {
  const { frame, transport, scrubber, axis } = DOCK_ROW_PX;
  return (
    frame +
    transport +
    scrubber +
    axis +
    lanes.reduce((sum, lane) => sum + DOCK_ROW_PX[lane], 0)
  );
}

/**
 * The lanes that fit in the dock's share of a window, out of those the replay
 * has. Lanes go from the end of `DOCK_LANE_ORDER`, and none comes back ahead of
 * one that went before it. The transport row, the scrubber and the axis stay
 * however short the window is.
 */
export function fittingLanes(
  windowHeight: number,
  present: readonly DockLane[],
): DockLane[] {
  const budget = DOCK_MAX_SHARE * windowHeight;
  const kept: DockLane[] = [];
  for (const lane of DOCK_LANE_ORDER) {
    if (!present.includes(lane)) continue;
    if (dockHeight([...kept, lane]) > budget) break;
    kept.push(lane);
  }
  return kept;
}

/**
 * Marks on the timeline's bar (#3808), and the time kept in the page's address.
 * Arithmetic on plain values.
 */

export type MarkLane = "kills" | "chat" | "left";

/** An event on the bar, at a frame of the track. */
export interface PlacedMark {
  lane: MarkLane;
  frame: number;
}

/** The marks of one lane that share a column of the bar. */
export interface MarkGroup {
  lane: MarkLane;
  column: number;
  /** The earliest frame in the group, which is where a click seeks to. */
  frame: number;
  count: number;
}

/**
 * Cuts the bar into `columns` and puts the marks of each lane that fall in one
 * column into one group. A match with thousands of kills then draws at most one
 * mark per column per lane, however many events there are. An event outside the
 * track has no place on the bar and is left out. Groups come back in the order
 * of the lanes they first appear in, and by column within a lane.
 */
export function groupMarks(
  marks: readonly PlacedMark[],
  range: { first: number; last: number },
  columns: number,
): MarkGroup[] {
  if (columns <= 0) return [];
  const length = range.last - range.first;
  const groups = new Map<string, MarkGroup>();
  for (const { lane, frame } of marks) {
    if (frame < range.first || frame > range.last) continue;
    const column =
      length <= 0
        ? 0
        : Math.min(
            columns - 1,
            Math.floor(((frame - range.first) / length) * columns),
          );
    const key = `${lane}/${column}`;
    const held = groups.get(key);
    if (held) {
      held.count++;
      if (frame < held.frame) held.frame = frame;
    } else {
      groups.set(key, { lane, column, frame, count: 1 });
    }
  }
  return [...groups.values()].sort(
    (a, b) => a.column - b.column || a.frame - b.frame,
  );
}

/** The frame of the next mark after `from`, or the previous one before it, or
 *  null when there is none. */
export function stepToMark(
  groups: readonly MarkGroup[],
  from: number,
  direction: 1 | -1,
): number | null {
  let found: number | null = null;
  for (const { frame } of groups) {
    if (direction === 1 ? frame > from : frame < from) {
      if (found === null || (direction === 1 ? frame < found : frame > found)) {
        found = frame;
      }
    }
  }
  return found;
}

/** The frame an address names, held inside the track, or null when it names
 *  none. */
export function urlFrame(
  value: string | null,
  range: { first: number; last: number },
): number | null {
  if (value === null || !/^-?\d+$/.test(value.trim())) return null;
  const frame = Number(value);
  return Math.min(range.last, Math.max(range.first, frame));
}

/** A frame as the address holds it: a whole number. */
export function toFrameParam(frame: number): string {
  return String(Math.round(frame));
}

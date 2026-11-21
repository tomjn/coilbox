/**
 * Marks on the replay page's timeline dock (#3808, #5306), and the time kept in
 * the page's address. Arithmetic on plain values.
 */

export type MarkLane = "kills" | "chat" | "players";

/** An event on the axis, at a frame of the match. */
export interface PlacedMark {
  lane: MarkLane;
  /** Before the first frame is held to the first, as chat sent before the match
   *  started is, and after the last is held to the last. */
  frame: number;
  /** What the event was, in words, when it is worth saying alone. */
  text?: string;
  /** What sort of event it is within its lane, where the lane tells them apart.
   *  A chat line's is who it was sent to. */
  kind?: string;
}

/** The marks of one lane that share a column of the bar. */
export interface MarkGroup {
  lane: MarkLane;
  column: number;
  /** The earliest frame in the group, held inside the axis, which is where a
   *  click seeks to. */
  frame: number;
  count: number;
  /** The words of the earliest event in the group. */
  text?: string;
  /** The kind every event in the group has, or undefined when they differ. */
  kind?: string;
  /** Whether the earliest event was before the axis starts. */
  before: boolean;
}

/**
 * Cuts the axis into `columns` and puts the marks of each lane that fall in one
 * column into one group. A match with thousands of kills then draws at most one
 * mark per column per lane, however many events there are. An event outside the
 * axis is held to its nearer end, so chat sent before the match started sits at
 * the start. Groups come back by column, and by frame within a column.
 */
export function groupMarks(
  marks: readonly PlacedMark[],
  range: { first: number; last: number },
  columns: number,
): MarkGroup[] {
  if (columns <= 0) return [];
  const length = range.last - range.first;
  const groups = new Map<string, MarkGroup>();
  // The frame each group's earliest event was recorded at, before it was held.
  const earliest = new Map<string, number>();
  for (const { lane, frame: recorded, text, kind } of marks) {
    const frame = Math.min(range.last, Math.max(range.first, recorded));
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
      if (held.kind !== kind) held.kind = undefined;
      if (recorded < (earliest.get(key) ?? recorded)) {
        earliest.set(key, recorded);
        held.frame = frame;
        held.text = text;
        held.before = recorded < range.first;
      }
    } else {
      groups.set(key, {
        lane,
        column,
        frame,
        count: 1,
        text,
        kind,
        before: recorded < range.first,
      });
      earliest.set(key, recorded);
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

import type { ChatLine } from "./bindings";
import { FRAMES_PER_SECOND, PREGAME_FRAME } from "./chatClock";

/** What a mark is, which decides the row it sits in. */
export type MarkKind =
  | "everyone"
  | "allies"
  | "spectators"
  | "whisper"
  | "system";

/** The rows, top to bottom. */
export const MARK_KINDS: readonly MarkKind[] = [
  "everyone",
  "allies",
  "spectators",
  "whisper",
  "system",
];

export interface TimelineMark {
  /** The line's position in the chat log, so a mark can point back at it. */
  index: number;
  kind: MarkKind;
  /** Whole seconds of match time, or null for a line sent before the game. */
  second: number | null;
  line: ChatLine;
}

/** A system line is a system line. A player line with no destination went to everyone. */
export function markKind(line: ChatLine): MarkKind {
  if (line.system) return "system";
  switch (line.dest?.kind) {
    case "allies":
      return "allies";
    case "spectators":
      return "spectators";
    case "player":
      return "whisper";
    default:
      return "everyone";
  }
}

/** One mark per line, in log order, with match time from the frame. */
export function toMarks(lines: ChatLine[]): TimelineMark[] {
  return lines.map((line, index) => ({
    index,
    kind: markKind(line),
    second:
      line.frame <= PREGAME_FRAME
        ? null
        : Math.floor(line.frame / FRAMES_PER_SECOND),
    line,
  }));
}

/**
 * The axis length in seconds. The match's own length, stretched if a line falls
 * after it. When the stream broke, the axis stops at the last line read.
 */
export function timelineDomain(
  marks: TimelineMark[],
  durationSec: number,
  incomplete: boolean,
): number {
  let last = 0;
  for (const m of marks)
    if (m.second !== null && m.second > last) last = m.second;
  const known =
    Number.isFinite(durationSec) && durationSec > 0 ? durationSec : 0;
  if (incomplete && last > 0) return last;
  return Math.max(known, last);
}

/** The marks of one row that share a slot on the axis. */
export interface TimelineBin {
  kind: MarkKind;
  /** The column on the axis, or "pregame" for the slot before it. */
  slot: "pregame" | number;
  marks: TimelineMark[];
}

/** Marks grouped by row and by column, so a crowd is one mark with a count. */
export function binMarks(
  marks: TimelineMark[],
  totalSec: number,
  binCount: number,
): TimelineBin[] {
  const bins = new Map<string, TimelineBin>();
  for (const m of marks) {
    const slot: TimelineBin["slot"] =
      m.second === null
        ? "pregame"
        : totalSec <= 0
          ? 0
          : Math.min(
              binCount - 1,
              Math.floor((m.second / totalSec) * binCount),
            );
    const key = `${m.kind}/${slot}`;
    const held = bins.get(key);
    if (held) held.marks.push(m);
    else bins.set(key, { kind: m.kind, slot, marks: [m] });
  }
  return [...bins.values()];
}

const TICK_STEPS = [60, 120, 300, 600, 900, 1200, 1800, 3600, 7200];
/** Most ticks the axis labels. */
const MAX_TICKS = 6;

/** Tick positions in seconds, from zero, at a round step. */
export function axisTicks(totalSec: number): number[] {
  if (totalSec <= 0) return [0];
  const step =
    TICK_STEPS.find((s) => totalSec / s <= MAX_TICKS) ??
    TICK_STEPS[TICK_STEPS.length - 1];
  const ticks: number[] = [];
  for (let t = 0; t <= totalSec; t += step) ticks.push(t);
  return ticks;
}

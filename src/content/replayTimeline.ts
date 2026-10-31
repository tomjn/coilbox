import { t } from "@lingui/core/macro";
import { formatList } from "../lib/format";
import type { ChatLine, ReplayPlayer, TimelineEvent } from "./bindings";
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
 * The engine team of each seated player, by the `[playerN]` number a chat line
 * carries. Spectators and players the file gives no number or team are left
 * out, as is the server (255), so their lines have no team. A name is never
 * matched: two players can share one.
 */
export function playerTeams(players: ReplayPlayer[]): Map<number, number> {
  const out = new Map<number, number>();
  for (const p of players) {
    if (p.spectator || p.player === undefined || p.team === undefined) continue;
    out.set(p.player, p.team);
  }
  return out;
}

/** The teams behind some marks, ascending. Empty when none of them has a team. */
export function markTeams(
  marks: TimelineMark[],
  teamOf: ReadonlyMap<number, number>,
): number[] {
  const teams = new Set<number>();
  for (const m of marks) {
    if (m.line.system) continue;
    const team = teamOf.get(m.line.player);
    if (team !== undefined) teams.add(team);
  }
  return [...teams].sort((a, b) => a - b);
}

/**
 * The axis length in seconds. The match's own length, stretched if a line falls
 * after it. When the stream broke, the axis stops at the last line read.
 */
export function timelineDomain(
  marks: { second: number | null }[],
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

/** What the binning needs of a mark, so chat marks and event marks share it. */
interface Placed {
  kind: string;
  second: number | null;
}

/** The marks of one row that share a slot on the axis. */
export interface TimelineBin<M extends Placed = TimelineMark> {
  kind: M["kind"];
  /** The column on the axis, or "pregame" for the slot before it. */
  slot: "pregame" | number;
  marks: M[];
}

/** Marks grouped by row and by column, so a crowd is one mark with a count. */
export function binMarks<M extends Placed>(
  marks: M[],
  totalSec: number,
  binCount: number,
): TimelineBin<M>[] {
  const bins = new Map<string, TimelineBin<M>>();
  for (const m of marks) {
    const slot: TimelineBin<M>["slot"] =
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

/**
 * Where the match statistics chart draws its time axis, in viewport pixels, and
 * the match time its right edge stands for. Null means the page has no chart.
 */
export interface ChartAxis {
  left: number;
  right: number;
  endSec: number;
}

/** The value axis and the room right of the plot, in pixels, which the chart draws to. */
export function plotInsets(endLabels: boolean): {
  left: number;
  right: number;
} {
  return { left: 52, right: endLabels ? 88 : 8 };
}

/** The axis a chart column at this position draws, whichever view is showing. */
export function chartAxis(
  column: { left: number; right: number },
  endLabels: boolean,
  endSec: number,
): ChartAxis {
  const insets = plotInsets(endLabels);
  return {
    left: column.left + insets.left,
    right: column.right - insets.right,
    endSec,
  };
}

/** The timeline's row label column and its pregame column, in pixels. */
const LABEL_COLUMN = 88;
const PREGAME_COLUMN = 56;

/** How the timeline's grid places its strip under a chart's axis. */
export interface StripLayout {
  columns: string;
  paddingRight: number;
  /** No room left of the axis for labels, so each sits on a line above its strip. */
  labelsAbove: boolean;
}

/** The grid that puts the strip's zero and end under the chart's, from the grid's own box. */
export function stripLayout(
  axis: ChartAxis,
  box: { left: number; right: number },
  hasPregame: boolean,
): StripLayout {
  const left = Math.max(0, axis.left - box.left);
  const paddingRight = Math.max(0, box.right - axis.right);
  const strip = "minmax(0,1fr)";
  const labelsAbove = left < LABEL_COLUMN + (hasPregame ? PREGAME_COLUMN : 0);
  if (labelsAbove)
    return { columns: `${left}px ${strip}`, paddingRight, labelsAbove };
  const columns = hasPregame
    ? `${left - PREGAME_COLUMN}px ${PREGAME_COLUMN}px ${strip}`
    : `${left}px ${strip}`;
  return { columns, paddingRight, labelsAbove };
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

/** What a timeline event is, which decides its row. */
export type EventKind =
  | "joined"
  | "paused"
  | "resigned"
  | "giveAway"
  | "left"
  | "teamDied"
  | "other";

/** The event rows, top to bottom, under the chat rows. */
export const EVENT_KINDS: readonly EventKind[] = [
  "joined",
  "paused",
  "resigned",
  "giveAway",
  "left",
  "teamDied",
  "other",
];

/** One event on the axis. */
export interface EventMark {
  kind: EventKind;
  /** Whole seconds of match time, or null for an event before the game. */
  second: number | null;
  event: TimelineEvent;
}

const EVENT_KIND_OF: Record<TimelineEvent["type"], EventKind> = {
  joined: "joined",
  paused: "paused",
  resigned: "resigned",
  giveAway: "giveAway",
  playerLeft: "left",
  teamDied: "teamDied",
  other: "other",
};

/** One mark per event, in the order the replay recorded them. */
export function toEventMarks(events: TimelineEvent[]): EventMark[] {
  return events.map((event) => ({
    kind: EVENT_KIND_OF[event.type],
    second:
      event.frame <= PREGAME_FRAME
        ? null
        : Math.floor(event.frame / FRAMES_PER_SECOND),
    event,
  }));
}

/** "A", "A and B", "A, B and C" in the app language. */
function nameList(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return formatList(names, "conjunction");
}

const SERVER = 255;

function eventName(e: TimelineEvent): string {
  if (e.playerName) return e.playerName;
  if (e.player === SERVER) return t`The server`;
  const slot = e.player;
  return t`Player ${slot}`;
}

/** What happened, in plain words, from the typed event and nothing the engine said. */
export function describeEvent(e: TimelineEvent): string {
  const who = eventName(e);
  switch (e.type) {
    case "resigned":
      return t`${who} resigned`;
    case "teamDied": {
      if (e.players.length === 0) return t`An army was eliminated`;
      const names = nameList(e.players);
      return t`${names}'s army was eliminated`;
    }
    case "playerLeft":
      switch (e.reason.kind) {
        case "lostConnection":
          return t`${who} lost connection`;
        case "left":
          return t`${who} left the game`;
        case "kicked":
          return t`${who} was kicked`;
        default: {
          const code = e.reason.code;
          return t`${who} left the game (reason code ${code})`;
        }
      }
    case "paused":
      return e.paused ? t`${who} paused the game` : t`${who} unpaused the game`;
    case "joined":
      return e.spectator
        ? t`${who} joined as a spectator`
        : t`${who} joined the game`;
    case "giveAway":
      return t`${who} gave away all the units of an army`;
    case "other": {
      const action = e.action;
      return t`${who} sent an army action this app does not name (code ${action})`;
    }
  }
}

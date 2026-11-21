import { t } from "@lingui/core/macro";
import { formatList } from "../lib/format";
import type { ChatLine, TimelineEvent } from "./bindings";

/** What a mark is, which decides the row it sits in. */
export type MarkKind =
  | "everyone"
  | "allies"
  | "spectators"
  | "whisper"
  | "system";

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

/** The value axis and the room right of the plot, in pixels, which the chart draws to. */
export function plotInsets(endLabels: boolean): {
  left: number;
  right: number;
} {
  return { left: 52, right: endLabels ? 88 : 8 };
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

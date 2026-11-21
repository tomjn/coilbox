/**
 * The events and chat list on the replay page (#5320): chat lines, player
 * events and the analysis's logged events as one list in time order.
 *
 * Kept free of React so the merge, the filters and the marked row can be tested
 * without a screen.
 */

import { t } from "@lingui/core/macro";
import { formatDuration } from "@/lib/format";
import type {
  ChatDest,
  ChatLine,
  ReplayPlayer,
  TimelineEvent,
} from "./bindings";
import { PREGAME_FRAME } from "./chatClock";
import {
  ALL_KINDS,
  ALL_PLAYERS,
  eventDetails,
  kindLabel,
  type LogEvent,
  matchesPlayer,
  NEUTRAL_PLAYER,
  type PlayerOption,
  playerOptions,
  teamLabel,
} from "./replayAnalysisEvents";
import { describeEvent } from "./replayTimeline";

/** The player number the server speaks as. */
const SERVER = 255;

/** The logged event a kill row is made from. */
export const KILL_KIND = "unit_destroyed";

/** One row of the list, from the source it came from. */
export type EventRow =
  | {
      source: "chat";
      frame: number;
      line: ChatLine;
      /** The engine team of whoever sent it, when a seated player did. */
      team: number | undefined;
    }
  | {
      source: "player";
      frame: number;
      event: TimelineEvent;
      /** The engine team of the player it concerns. */
      team: number | undefined;
    }
  | { source: "log"; frame: number; event: LogEvent };

/** The groups the filters pick from. A logged event that is not a kill is
 *  `other`, and only the All filter shows it. */
export type RowGroup = "chat" | "players" | "kills" | "other";

/** `highlights` is chat, kills and player events together. */
export type RowFilter = "highlights" | "all" | "chat" | "kills" | "players";

export function rowGroup(row: EventRow): RowGroup {
  if (row.source === "chat") return "chat";
  if (row.source === "player") return "players";
  return row.event.kind === KILL_KIND ? "kills" : "other";
}

/**
 * The engine team of each seated player, by the `[playerN]` number a chat line
 * carries. Spectators and players the file gives no number or team are left
 * out, as is the server (255), so their lines have no team. A name is never
 * matched: two players can share one.
 */
export function playerTeams(
  players: readonly ReplayPlayer[],
): Map<number, number> {
  const out = new Map<number, number>();
  for (const p of players) {
    if (p.spectator || p.player === undefined || p.team === undefined) continue;
    out.set(p.player, p.team);
  }
  return out;
}

const RANK: Record<EventRow["source"], number> = {
  chat: 0,
  player: 1,
  log: 2,
};

/** A logged event's frame, or negative infinity for one that has none. */
function logFrame(event: LogEvent): number {
  return typeof event.frame === "number" && Number.isFinite(event.frame)
    ? event.frame
    : Number.NEGATIVE_INFINITY;
}

/**
 * The three sources as one list in time order. Events in one frame keep their
 * source's own order, with chat first, then players, then the log. A player
 * action this app does not name has nothing to say and is left out, as it is
 * from the timeline dock.
 */
export function mergeRows(
  chat: readonly ChatLine[],
  playerEvents: readonly TimelineEvent[],
  logged: readonly LogEvent[],
  teamOf: ReadonlyMap<number, number>,
): EventRow[] {
  const rows: EventRow[] = [];
  for (const line of chat) {
    rows.push({
      source: "chat",
      frame: line.frame,
      line,
      team: line.system ? undefined : teamOf.get(line.player),
    });
  }
  for (const event of playerEvents) {
    if (event.type === "other") continue;
    rows.push({
      source: "player",
      frame: event.frame,
      event,
      team: teamOf.get(event.player),
    });
  }
  for (const event of logged) {
    rows.push({ source: "log", frame: logFrame(event), event });
  }
  // Array.prototype.sort is stable, so equal rows keep the order they came in.
  return rows.sort(
    (a, b) => a.frame - b.frame || RANK[a.source] - RANK[b.source],
  );
}

/** What a reader has chosen to narrow the list by. */
export interface RowSelection {
  filter: RowFilter;
  /** A logged kind, or `ALL_KINDS`. */
  kind: string;
  /** `team:N`, `NEUTRAL_PLAYER` or `ALL_PLAYERS`. */
  player: string;
}

function inFilter(row: EventRow, filter: RowFilter): boolean {
  const group = rowGroup(row);
  switch (filter) {
    case "all":
      return true;
    case "highlights":
      return group !== "other";
    case "chat":
      return group === "chat";
    case "kills":
      return group === "kills";
    case "players":
      return group === "players";
  }
}

function rowMatchesPlayer(
  row: EventRow,
  player: string,
  labels: ReadonlyMap<number, string>,
): boolean {
  if (row.source === "log") return matchesPlayer(row.event, player, labels);
  // A line or an action from nobody seated is of no player's.
  return row.team !== undefined && player === `team:${row.team}`;
}

/**
 * The players to filter by: everyone who controls a team, in team order, then
 * the neutral label when a logged event belongs to a team nobody controls.
 */
export function playerChoices(
  labels: ReadonlyMap<number, string>,
  logged: readonly LogEvent[],
): PlayerOption[] {
  const options = [...labels.keys()]
    .sort((a, b) => a - b)
    .map((team) => ({
      value: `team:${team}`,
      label: labels.get(team) as string,
    }));
  const neutral = playerOptions(logged, labels).find(
    (o) => o.value === NEUTRAL_PLAYER,
  );
  return neutral ? [...options, neutral] : options;
}

/** The rows the selection leaves, still in time order. */
export function selectRows(
  rows: readonly EventRow[],
  selection: RowSelection,
  labels: ReadonlyMap<number, string>,
): EventRow[] {
  const { filter, kind, player } = selection;
  return rows.filter(
    (row) =>
      inFilter(row, filter) &&
      (kind === ALL_KINDS ||
        (row.source === "log" && row.event.kind === kind)) &&
      (player === ALL_PLAYERS || rowMatchesPlayer(row, player, labels)),
  );
}

/**
 * The index of the row at or just before `frame`: the last one that has
 * happened by then. -1 when none has. `rows` must be in time order.
 */
export function markedIndex(rows: readonly EventRow[], frame: number): number {
  let low = 0;
  let high = rows.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if ((rows[mid]?.frame ?? 0) <= frame) low = mid + 1;
    else high = mid;
  }
  return low - 1;
}

/**
 * A row's time on the scrubber's clock: minutes and seconds into the match. A
 * line sent before the match started is labelled, and a logged event with no
 * frame has no time.
 */
export function rowTime(
  frame: number,
  range: { firstFrame: number; framesPerSecond: number },
): string {
  if (!Number.isFinite(frame)) return "";
  if (frame <= PREGAME_FRAME) return t`Pre-game`;
  return formatDuration(
    Math.floor(Math.max(0, frame - range.firstFrame) / range.framesPerSecond),
  );
}

/** The name a row's kind column shows. */
export function rowKindLabel(row: EventRow): string {
  switch (rowGroup(row)) {
    case "chat":
      return t`Chat`;
    case "players":
      return t`Player`;
    case "kills":
      return t`Kill`;
    case "other":
      return row.source === "log" ? kindLabel(row.event.kind) : "";
  }
}

/** Each sent name by player number, for naming who a chat line was to. */
export function chatNames(messages: readonly ChatLine[]): Map<number, string> {
  const names = new Map<number, string>();
  for (const m of messages) {
    if (m.playerName) names.set(m.player, m.playerName);
  }
  return names;
}

function senderName(line: ChatLine): string {
  if (line.playerName) return line.playerName;
  if (line.player === SERVER) return t`Server`;
  const player = line.player;
  return t`Player ${player}`;
}

/** "to everyone" is the default and left off. Anything narrower is labelled. */
function destLabel(
  dest: ChatDest | undefined,
  names: ReadonlyMap<number, string>,
): string | null {
  if (!dest || dest.kind === "everyone") return null;
  if (dest.kind === "allies") return t`to allies`;
  if (dest.kind === "spectators") return t`to spectators`;
  const target = names.get(dest.player) ?? t`Player ${dest.player}`;
  return t`to ${target}`;
}

/** A chat line as one sentence: who, to whom when not everyone, and what. */
export function describeChat(
  line: ChatLine,
  names: ReadonlyMap<number, string>,
): string {
  if (line.system) return `* ${line.text}`;
  const sender = senderName(line);
  const dest = destLabel(line.dest, names);
  return `${sender}${dest ? ` ${dest}` : ""}: ${line.text}`;
}

/**
 * A logged event as one sentence. A kill names the unit that died, the unit
 * that killed it and the player who owned the killer, as "Thud destroyed by
 * Lifter (Player)". Anything else names its unit and the player who owns it,
 * then the rest of its fields.
 *
 * `unitName` answers for a unit definition id, which is a number of the
 * analysis run's engine.
 */
export function describeLogEvent(
  event: LogEvent,
  unitName: (def: number) => string,
  labels: ReadonlyMap<number, string>,
): string {
  const num = (name: string) =>
    typeof event[name] === "number" ? (event[name] as number) : undefined;
  const def = num("def");
  const team = num("team");

  if (event.kind === KILL_KIND) {
    const victim = def === undefined ? t`A unit` : unitName(def);
    const killerDef = num("attackerDef");
    const killer = killerDef === undefined ? undefined : unitName(killerDef);
    const attackerTeam = num("attackerTeam");
    const owner =
      attackerTeam === undefined ? undefined : teamLabel(attackerTeam, labels);
    if (killer && owner) return t`${victim} destroyed by ${killer} (${owner})`;
    if (killer) return t`${victim} destroyed by ${killer}`;
    if (owner) return t`${victim} destroyed by ${owner}`;
    return t`${victim} destroyed`;
  }

  const owner = team === undefined ? undefined : teamLabel(team, labels);
  const subject =
    def === undefined
      ? undefined
      : owner
        ? `${unitName(def)} (${owner})`
        : unitName(def);
  const details = eventDetails(event, labels).map((d) => `${d.name} ${d.text}`);
  return [subject, ...details].filter(Boolean).join(", ");
}

/** The kind column and the sentence for one row. */
export function describeRow(
  row: EventRow,
  context: {
    names: ReadonlyMap<number, string>;
    unitName: (def: number) => string;
    labels: ReadonlyMap<number, string>;
  },
): string {
  switch (row.source) {
    case "chat":
      return describeChat(row.line, context.names);
    case "player":
      return describeEvent(row.event);
    case "log":
      return describeLogEvent(row.event, context.unitName, context.labels);
  }
}

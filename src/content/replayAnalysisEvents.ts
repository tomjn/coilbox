/**
 * Looking at an analysed replay's events (#1179).
 *
 * The logger adds kinds and fields over time, so nothing here lists them. A
 * kind is whatever the data holds, and a field is shown under its own name
 * unless this file knows how to say it better.
 */

import type {
  DemoInfo,
  ReplayEventCounts,
  StoredReplayAnalysis,
} from "./bindings";
import { slug, startedAt } from "./matchStatsCsv";

/** One stored event as the logger wrote it. Anything beyond `kind` is optional. */
export type LogEvent = { kind: string } & Record<string, unknown>;

/** Every kind, in the order the first one is met. */
export const ALL_KINDS = "*";
export const ALL_PLAYERS = "all";
export const NEUTRAL_PLAYER = "neutral";

/** What an event whose team no player controls is listed under. */
export const NEUTRAL_LABEL = "Neutral";

function snakeCase(name: string): string {
  return name.replace(/([A-Z])/g, "_$1").toLowerCase();
}

/** `unit_created` as `Unit created`. */
export function kindLabel(kind: string): string {
  const spaced = kind.replace(/_/g, " ").trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/**
 * The kinds a log holds, from the provenance's counts. `unknown` counts lines
 * of kinds this build has no name for, so it names nothing.
 */
export function kindsFromCounts(counts: ReplayEventCounts): string[] {
  return Object.entries(counts)
    .filter(([name, n]) => name !== "unknown" && typeof n === "number" && n > 0)
    .map(([name]) => snakeCase(name));
}

/**
 * The kinds to offer: those the counts name, then any the events hold that the
 * counts could not name, in the order they first appear.
 */
export function eventKinds(
  counts: ReplayEventCounts,
  events: readonly LogEvent[],
): string[] {
  const kinds = new Set(kindsFromCounts(counts));
  for (const event of events) {
    if (typeof event.kind === "string" && event.kind) kinds.add(event.kind);
  }
  return [...kinds];
}

/**
 * Who controls each engine team, as a label. A shared team lists everyone on
 * it, and a skirmish AI is named for the AI. Spectators control nothing.
 */
export function playerLabels(
  info: Pick<DemoInfo, "players" | "ais">,
): Map<number, string> {
  const names = new Map<number, string[]>();
  const add = (team: number | undefined, name: string) => {
    if (team === undefined) return;
    names.set(team, [...(names.get(team) ?? []), name]);
  };
  for (const p of info.players) if (!p.spectator) add(p.team, p.name);
  for (const ai of info.ais) add(ai.team, ai.name);
  return new Map([...names].map(([team, list]) => [team, list.join(" and ")]));
}

function numberField(event: LogEvent, name: string): number | undefined {
  const v = event[name];
  return typeof v === "number" ? v : undefined;
}

/** The label for a team id: its players, or the neutral label. */
export function teamLabel(
  team: number | undefined,
  labels: ReadonlyMap<number, string>,
): string {
  if (team === undefined) return "";
  return labels.get(team) ?? NEUTRAL_LABEL;
}

export interface PlayerOption {
  value: string;
  label: string;
}

/**
 * The players to filter by: each one with an event on either side of it, in
 * team order, then the neutral label if an event belongs to a team no player
 * controls.
 */
export function playerOptions(
  events: readonly LogEvent[],
  labels: ReadonlyMap<number, string>,
): PlayerOption[] {
  const teams = new Set<number>();
  for (const event of events) {
    for (const name of ["team", "attackerTeam"]) {
      const team = numberField(event, name);
      if (team !== undefined) teams.add(team);
    }
  }
  const known = [...teams].filter((t) => labels.has(t)).sort((a, b) => a - b);
  const options = known.map((t) => ({
    value: `team:${t}`,
    label: labels.get(t) as string,
  }));
  if ([...teams].some((t) => !labels.has(t))) {
    options.push({ value: NEUTRAL_PLAYER, label: NEUTRAL_LABEL });
  }
  return options;
}

function matchesPlayer(
  event: LogEvent,
  player: string,
  labels: ReadonlyMap<number, string>,
): boolean {
  const matches = (team: number | undefined) => {
    if (team === undefined) return false;
    return player === NEUTRAL_PLAYER
      ? !labels.has(team)
      : player === `team:${team}`;
  };
  // A player's filter includes the units they destroyed, so it answers "what
  // happened to this player and what did they do". The Player column still
  // names the owner of the unit, and the details name the attacker.
  return (
    matches(numberField(event, "team")) ||
    matches(numberField(event, "attackerTeam"))
  );
}

/** Events of one kind and/or one player. `ALL_KINDS` and `ALL_PLAYERS` keep all. */
export function filterEvents(
  events: readonly LogEvent[],
  filter: { kind: string; player: string },
  labels: ReadonlyMap<number, string>,
): LogEvent[] {
  return events.filter(
    (e) =>
      (filter.kind === ALL_KINDS || e.kind === filter.kind) &&
      (filter.player === ALL_PLAYERS ||
        matchesPlayer(e, filter.player, labels)),
  );
}

/** The first `shown` rows, and how many are left behind. */
export function pageOf<T>(
  rows: readonly T[],
  shown: number,
): { rows: T[]; left: number } {
  return {
    rows: rows.slice(0, shown),
    left: Math.max(0, rows.length - shown),
  };
}

/** Fields the table gives a column of their own. */
const COLUMN_FIELDS = new Set(["kind", "frame", "team", "def"]);

/** The longest a single field is shown. The download holds all of it. */
const FIELD_LIMIT = 200;

function fieldText(value: unknown): string {
  const text =
    typeof value === "string"
      ? value
      : (JSON.stringify(value) ?? String(value));
  return text.length > FIELD_LIMIT ? `${text.slice(0, FIELD_LIMIT)}…` : text;
}

/**
 * The rest of an event as `name value` pairs. A position reads as one value in
 * world units, an attacker's team as the player's label, and anything else as
 * its own name and value, so a field a later logger adds still shows.
 */
export function eventDetails(
  event: LogEvent,
  labels: ReadonlyMap<number, string>,
): { name: string; text: string }[] {
  const out: { name: string; text: string }[] = [];
  const hasPosition = ["x", "y", "z"].every(
    (k) => typeof event[k] === "number",
  );
  if (hasPosition) {
    out.push({ name: "at", text: `${event.x}, ${event.y}, ${event.z}` });
  }
  for (const [name, value] of Object.entries(event)) {
    if (COLUMN_FIELDS.has(name) || value === undefined || value === null) {
      continue;
    }
    if (hasPosition && (name === "x" || name === "y" || name === "z")) continue;
    if (name === "attackerTeam" && typeof value === "number") {
      out.push({ name: "attacker", text: teamLabel(value, labels) });
      continue;
    }
    out.push({ name, text: fieldText(value) });
  }
  return out;
}

/**
 * The whole log as JSON lines, provenance first. The store hands back parsed
 * lines, so this is each one written again as a compact object, which holds
 * the same data as the stored file but not necessarily the same bytes. The
 * provenance leaves out `state` and `sizeBytes`, which the store works out and
 * the file does not hold.
 */
export function eventsDownloadText(
  analysis: StoredReplayAnalysis,
  events: readonly LogEvent[],
): string {
  const { state: _state, sizeBytes: _size, ...provenance } = analysis;
  return `${[provenance, ...events].map((l) => JSON.stringify(l)).join("\n")}\n`;
}

/** A default file name from the map, the date and the game id. */
export function eventsFileName(info: DemoInfo, gameId: string): string {
  const date = startedAt(info).slice(0, 10);
  const parts = [slug(info.mapName), date, slug(gameId)].filter(Boolean);
  return `${parts.length > 0 ? parts.join("-") : "match"}-events.jsonl`;
}

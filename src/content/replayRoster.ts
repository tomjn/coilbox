import type {
  DemoInfo,
  DemoTrailer,
  Metric,
  ReplayAi,
  ReplayPlayer,
} from "./bindings";
import {
  compareFigures,
  libraryMetrics,
  type SortDirection,
} from "./replayMatchFigures";

/**
 * The roster on replay detail as data: which rows it has, what each row's
 * figures are, and how they sort (#1143).
 *
 * A row is a team, not a seat. The chart draws one line per team and the metric
 * totals are per team, so a team that two players share is one row with both
 * players in it. That shows its total once, gives it one checkbox, and gives
 * the chart one thing to point at. A bot holds a team like a person does, and
 * a seat the file gives no team is a row of its own.
 *
 * Nothing here names a metric. The columns are the ones the registry flags
 * `roster`, so a metric flagged in Rust gets a column with no change here.
 */

/** One seat in the roster. A `[playerN]` and an `[aiN]` both hold a team. */
export type Seat =
  | { kind: "player"; player: ReplayPlayer }
  | { kind: "ai"; ai: ReplayAi };

export interface RosterRow {
  /** Unique within the roster, stable for a replay. */
  key: string;
  /** The ally side, or -1 where the file gives none. */
  allyTeam: number;
  /** The engine team, absent for a seat the file gives none. */
  team?: number;
  seats: Seat[];
}

export interface Roster {
  rows: RosterRow[];
  /** The ally sides present, ascending. */
  sides: number[];
  spectators: ReplayPlayer[];
}

/** Sides ascending, and inside a side the teams in the order the file lists them: people first, then bots. */
export function buildRoster(info: DemoInfo): Roster {
  const byRow = new Map<string, RosterRow>();
  const spectators: ReplayPlayer[] = [];
  let loose = 0;
  const push = (seat: Seat, allyTeam: number | undefined, team?: number) => {
    const ally = allyTeam ?? -1;
    // A seat with no team can't be told from another, so each stands alone.
    const key = team === undefined ? `s${ally}-${loose++}` : `t${team}`;
    const held = byRow.get(key);
    if (held) held.seats.push(seat);
    else byRow.set(key, { key, allyTeam: ally, team, seats: [seat] });
  };
  for (const p of info.players) {
    if (p.spectator) spectators.push(p);
    else push({ kind: "player", player: p }, p.allyTeam, p.team);
  }
  for (const a of info.ais ?? [])
    push({ kind: "ai", ai: a }, a.allyTeam, a.team);
  const rows = [...byRow.values()].sort((a, b) => a.allyTeam - b.allyTeam);
  return {
    rows,
    sides: [...new Set(rows.map((r) => r.allyTeam))],
    spectators,
  };
}

/** The metrics the roster has a column for. */
export function rosterMetrics(metrics: Metric[]): Metric[] {
  return libraryMetrics(metrics);
}

/**
 * Each measured team's final figure per metric: the last sample, since every
 * field is a running total. A team with no samples is not in the map, so its
 * cells are empty and not zero.
 */
export function teamFinals(
  trailer: DemoTrailer,
  metrics: Metric[],
): Map<number, Record<string, number>> {
  const finals = new Map<number, Record<string, number>>();
  for (const t of trailer.teams) {
    const last = t.samples.at(-1);
    if (!last) continue;
    const figures: Record<string, number> = {};
    for (const m of metrics) {
      const v = last[m.key];
      if (typeof v === "number") figures[m.key] = v;
    }
    finals.set(t.team, figures);
  }
  return finals;
}

/**
 * A row's actions per minute: its best player's. The decoder works out each
 * player's figure and leaves it off when the match recorded none, so a row with
 * no figure to read has none. Almost every row has one player. A team two share
 * is sorted by whoever was busier, and the row still shows each player's own.
 */
export function rowApm(row: RosterRow): number | undefined {
  const figures = row.seats.flatMap((s) =>
    s.kind === "player" && s.player.apm !== undefined ? [s.player.apm] : [],
  );
  return figures.length > 0 ? Math.max(...figures) : undefined;
}

/** A column the roster sorts by. */
export type RosterColumn = { kind: "apm" } | { kind: "metric"; key: string };

export interface RosterSort {
  column: RosterColumn;
  dir: SortDirection;
}

export function sameColumn(a: RosterColumn, b: RosterColumn): boolean {
  return a.kind === "apm"
    ? b.kind === "apm"
    : b.kind === "metric" && a.key === b.key;
}

/**
 * What pressing a column's header does: a new column sorts biggest first, the
 * same column again flips to smallest first, and a third press goes back to the
 * grouped order. Biggest first is the one that answers "who did the most".
 */
export function nextSort(
  current: RosterSort | null,
  column: RosterColumn,
): RosterSort | null {
  if (!current || !sameColumn(current.column, column))
    return { column, dir: "desc" };
  return current.dir === "desc" ? { column, dir: "asc" } : null;
}

export function ariaSort(
  sort: RosterSort | null,
  column: RosterColumn,
): "ascending" | "descending" | "none" {
  if (!sort || !sameColumn(sort.column, column)) return "none";
  return sort.dir === "asc" ? "ascending" : "descending";
}

/** One row's value in a column, or undefined where it has none. */
export function cellValue(
  row: RosterRow,
  column: RosterColumn,
  finals: Map<number, Record<string, number>>,
): number | undefined {
  if (column.kind === "apm") return rowApm(row);
  return row.team === undefined
    ? undefined
    : finals.get(row.team)?.[column.key];
}

/**
 * The rows in sort order, or as given when there is no sort. Rows with no value
 * go last whichever way it runs, and rows that tie keep their grouped order.
 */
export function sortRows(
  rows: RosterRow[],
  sort: RosterSort | null,
  finals: Map<number, Record<string, number>>,
): RosterRow[] {
  if (!sort) return rows;
  return [...rows].sort((a, b) =>
    compareFigures(
      cellValue(a, sort.column, finals),
      cellValue(b, sort.column, finals),
      sort.dir,
    ),
  );
}

/**
 * The number a start script's `skill` leads with, for the badge. Lobbies decorate
 * it (`[25.0]`, `(30.5)`, `[µ=25.0, σ=8.3]`), and the first number in it is the
 * rating, the rule the decoder uses for the replay list. Undefined when there is
 * none. Nothing is worked out from it: the badge shows this number and the
 * tooltip shows the file's own text.
 */
export function parseRating(skill: string | undefined): number | undefined {
  const found = skill?.match(/-?\d*\.?\d+/);
  if (!found) return undefined;
  const n = Number(found[0]);
  return Number.isFinite(n) ? n : undefined;
}

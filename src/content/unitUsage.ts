/**
 * Which units a player orders, added up over the replays they are in (#1167).
 *
 * Rust reduces each replay to what every seat ordered of every unit definition
 * id (`demo/unit_orders.rs`). This folds one player's share of those into rows
 * by unit. Everything is an order given and never a unit built: the replay does
 * not say whether an order was carried out, and a queue removal takes nothing
 * off.
 *
 * An id only means a unit against the list of the build the match was played
 * on (#1176), so each replay is named against its own list or not at all. A
 * replay with no list it can be trusted against is left out whole and counted,
 * and builds are never mixed. Rows from different builds of one game meet on
 * the unit's key, which is what the game's files call it.
 */

import type {
  GameItem,
  ReplayUnitOrders,
  StoredUnitDef,
  UnitDatasetEntry,
} from "./bindings";
import { pickUnitSource } from "./replayBuildOrders";
import { type SplitBucket, splitBucket } from "./replayOpening";
import { storedToUnit } from "./replayUnitDefs";
import { normalizeGameIdentity, stripVersionSuffix } from "./resolveContent";
import type { PlayerGame } from "./stats";
import { classifyUnit, type UnitCategory } from "./unitCategory";

/** The kept unit lists by digest, in the shape the classifier reads. */
export function storedLists(
  sets: Record<string, StoredUnitDef[]>,
): Map<string, UnitDatasetEntry[]> {
  return new Map(
    Object.entries(sets).map(([digest, defs]) => [
      digest,
      defs.map(storedToUnit),
    ]),
  );
}

/** Where a replay's build order ids are named from. */
export type StreamNaming =
  /** A list to read the ids against. `engine` is true for the engine's own
   *  list, which is the numbering the match used and needs no check. */
  | { kind: "named"; units: UnitDatasetEntry[]; engine: boolean }
  /** An installed game under the replay's exact name, to be read through
   *  unitsync. */
  | { kind: "installed"; archive: string }
  /** No list was kept and that build is not installed. Another version's list
   *  could name the wrong unit, so the replay is not named at all. */
  | { kind: "none" };

/**
 * Pick where one replay's build order ids are named from, by the replay page's
 * own order of trust (`pickUnitSource`). The page falls back to another
 * installed version with a warning. A sum over many replays has nowhere to put
 * that warning, so it does not.
 */
export function streamNaming(
  replay: Pick<ReplayUnitOrders, "gameType" | "streamList">,
  lists: ReadonlyMap<string, UnitDatasetEntry[]>,
  games: GameItem[],
): StreamNaming {
  const link = replay.streamList;
  const units = link ? lists.get(link.digest) : undefined;
  const source = pickUnitSource(
    replay.gameType,
    games,
    link && units ? { link, units } : null,
  );
  if (source.kind === "stored") {
    return {
      kind: "named",
      units: source.list.units,
      engine: source.list.link.origin === "engine",
    };
  }
  if (source.kind === "installed") {
    return { kind: "installed", archive: source.game.primaryArchive.name };
  }
  return { kind: "none" };
}

/**
 * How many of a replay's build orders do not fit a unit list, over every seat.
 * The same check as `orderFit` in `replayUnitDefs.ts`, on totals: a placed
 * order should name a unit that does not move, a factory order one that does,
 * and no id should be past the end of the list.
 */
export function totalsMisfits(
  replay: Pick<ReplayUnitOrders, "seats">,
  units: readonly UnitDatasetEntry[],
): number {
  let misfits = 0;
  for (const seat of replay.seats) {
    for (const d of seat.defs) {
      const unit = units[d.def - 1];
      if (!unit) misfits += d.placed + d.queued;
      else misfits += unit.mobile ? d.placed : d.queued;
    }
  }
  return misfits;
}

/** What one counted replay is read against. */
export interface ReplayLists {
  /** The list that names the replay's build orders, or why there is none.
   *  `waiting` is an installed game whose units have not been read yet. */
  stream:
    | { kind: "named"; units: UnitDatasetEntry[]; engine: boolean }
    | { kind: "waiting" }
    | { kind: "none" };
  /** The engine's list for the replay's analysis events, or null. */
  events: UnitDatasetEntry[] | null;
}

/**
 * What one replay is read against, given what has been read so far.
 *
 * `datasets` holds each installed game's units by archive name once its read
 * has ended: the units, or null for a read that failed or came back empty. An
 * archive not in it yet is still being read. `games` is null until the scan of
 * installed games has answered, and until then only a kept engine list can
 * name a replay, because every other choice depends on what is installed.
 */
export function replayLists(
  replay: Pick<ReplayUnitOrders, "gameType" | "streamList" | "eventsList">,
  lists: ReadonlyMap<string, UnitDatasetEntry[]>,
  games: GameItem[] | null,
  datasets: ReadonlyMap<string, UnitDatasetEntry[] | null>,
): ReplayLists {
  const events = replay.eventsList
    ? (lists.get(replay.eventsList.digest) ?? null)
    : null;
  const naming = streamNaming(replay, lists, games ?? []);
  if (naming.kind === "named") {
    return games || naming.engine
      ? { stream: naming, events }
      : { stream: { kind: "waiting" }, events };
  }
  if (!games) return { stream: { kind: "waiting" }, events };
  if (naming.kind === "none") return { stream: naming, events };
  if (!datasets.has(naming.archive)) {
    return { stream: { kind: "waiting" }, events };
  }
  const units = datasets.get(naming.archive);
  return {
    stream: units ? { kind: "named", units, engine: false } : { kind: "none" },
    events,
  };
}

/** What a unit's finished and died figures are drawn from. */
export interface AnalysedUnit {
  /** Analysed replays the player ordered the unit in. */
  replays: number;
  /** Units ordered in those replays. */
  ordered: number;
  /** Units of this kind the player's team finished in those replays. */
  finished: number;
  /** Finished units of this kind the team lost in those replays. */
  died: number;
}

/** One unit a player ordered. */
export interface UnitUsageRow {
  /** The game's family and the unit's key. */
  key: string;
  /** What the game's files call the unit. */
  unitKey: string;
  /** What a player calls it, from the newest replay it was ordered in. */
  name: string;
  /** The game, with its version taken off. */
  game: string;
  /** From the newest replay it was ordered in. */
  category: UnitCategory;
  /** Replays it was ordered in. */
  matches: number;
  /** Those with a recorded result. */
  decided: number;
  /** Those the player won. */
  won: number;
  /** Orders given for it. */
  orders: number;
  /** Units those orders asked for. */
  units: number;
  /** Units times the metal cost in each replay's own list. */
  metal: number;
  /** Units ordered from a list that gives the unit no metal cost. They add
   *  nothing to `metal`. */
  unpriced: number;
  /** Null where no analysed replay has the player ordering this unit. */
  analysed: AnalysedUnit | null;
}

export interface UnitUsage {
  rows: UnitUsageRow[];
  /** Metal ordered by kind of unit. */
  split: Record<SplitBucket, number>;
  /** Units ordered with no metal cost, which are in no kind's metal. */
  unpriced: number;
  /** The player's games in the replay set. */
  games: number;
  /** Games whose orders are in `rows`. */
  counted: number;
  /** Counted games in which the player gave no build order. */
  noOrders: number;
  /** Counted games whose stream stopped early, so later orders are missing. */
  incomplete: number;
  /** Games not read yet. */
  unread: number;
  /** Games waiting on an installed game's unit list. */
  waiting: number;
  /** Games whose replay would not read. */
  failed: number;
  /** Games with no unit list for their build, and the player's orders in them. */
  noList: { games: number; orders: number };
  /** Games whose own orders contradict their unit list, and the player's
   *  orders in them. */
  misfit: { games: number; orders: number };
  /** Orders in counted games whose id the engine's list does not reach. */
  unnamedOrders: number;
  /** Counted games with an analysis whose events can be named. */
  analysed: number;
  /** Counted games with an analysis and no engine list to name its events. */
  analysedUnnamed: number;
  /** Counted games with an analysis whose record holds no team for the
   *  player, so the events cannot be tied to them. */
  analysedNoTeam: number;
}

function metalCost(unit: UnitDatasetEntry): number | null {
  const value = unit.stats?.metalCost;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

const EMPTY_SPLIT = (): Record<SplitBucket, number> => ({
  economy: 0,
  defence: 0,
  offence: 0,
  other: 0,
  unclassified: 0,
});

/**
 * Fold one player's build orders over their games.
 *
 * `games` is the player's games as the dossier counts them (`gamesFor` over
 * genuine matches, oldest first), so the replay set and the wins are the
 * dossier's own. `replays` is what Rust answered, by path, and `failed` the
 * paths it could not read. `listsFor` says what each replay is read against.
 *
 * A replay is left out whole, and counted, when it has no list or when any
 * order in it, from any seat, does not fit the list: a list the replay's own
 * orders contradict is not the one the match was played on, so the orders that
 * do fit may be named wrong too. The engine's own list is not checked, and an
 * id past its end is one order left out.
 *
 * Finished and died are the player's team's, from a replay's stored analysis,
 * and are counted for a unit only in replays where the player ordered it, so
 * they sit beside what was ordered in the same replays. Two players who share
 * a team share its units, so both get the team's figures.
 */
export function foldUnitUsage(
  games: readonly PlayerGame[],
  playerName: string,
  replays: ReadonlyMap<string, ReplayUnitOrders>,
  failed: ReadonlySet<string>,
  listsFor: (replay: ReplayUnitOrders) => ReplayLists,
): UnitUsage {
  const rows = new Map<string, UnitUsageRow>();
  const out: UnitUsage = {
    rows: [],
    split: EMPTY_SPLIT(),
    unpriced: 0,
    games: games.length,
    counted: 0,
    noOrders: 0,
    incomplete: 0,
    unread: 0,
    waiting: 0,
    failed: 0,
    noList: { games: 0, orders: 0 },
    misfit: { games: 0, orders: 0 },
    unnamedOrders: 0,
    analysed: 0,
    analysedUnnamed: 0,
    analysedNoTeam: 0,
  };

  for (const game of games) {
    const replay = replays.get(game.record.path);
    if (!replay) {
      if (failed.has(game.record.path)) out.failed++;
      else out.unread++;
      continue;
    }
    // A skirmish AI's orders arrive from the player hosting it. They are the
    // AI's, not the player's.
    const mine = replay.seats
      .filter((s) => s.aiTeam === undefined && s.name === playerName)
      .flatMap((s) => s.defs);
    const myOrders = mine.reduce((n, d) => n + d.placed + d.queued, 0);

    const lists = listsFor(replay);
    if (lists.stream.kind === "waiting") {
      out.waiting++;
      continue;
    }
    if (lists.stream.kind === "none") {
      out.noList.games++;
      out.noList.orders += myOrders;
      continue;
    }
    const { units, engine } = lists.stream;
    if (!engine && totalsMisfits(replay, units) > 0) {
      out.misfit.games++;
      out.misfit.orders += myOrders;
      continue;
    }

    out.counted++;
    if (replay.incomplete) out.incomplete++;
    if (myOrders === 0) out.noOrders++;

    const me = game.record.players.find(
      (p) => !p.spectator && p.name === playerName,
    );
    const teamEvents =
      me?.team === undefined
        ? undefined
        : replay.events?.find((t) => t.team === me.team);
    let events: Map<string, { finished: number; died: number }> | null = null;
    if (replay.events && !lists.events) out.analysedUnnamed++;
    else if (replay.events && me?.team === undefined) out.analysedNoTeam++;
    else if (replay.events && lists.events) {
      out.analysed++;
      events = new Map();
      for (const d of teamEvents?.defs ?? []) {
        const unit = lists.events[d.def - 1];
        if (!unit) continue;
        const sum = events.get(unit.name) ?? { finished: 0, died: 0 };
        sum.finished += d.finished;
        sum.died += d.died;
        events.set(unit.name, sum);
      }
    }

    const family = stripVersionSuffix(replay.gameType);
    const familyKey = normalizeGameIdentity(family);
    const seen = new Set<UnitUsageRow>();
    for (const d of mine) {
      const unit = units[d.def - 1];
      if (!unit) {
        out.unnamedOrders += d.placed + d.queued;
        continue;
      }
      const key = `${familyKey}\n${unit.name}`;
      let row = rows.get(key);
      if (!row) {
        row = {
          key,
          unitKey: unit.name,
          name: unit.name,
          game: family,
          category: "unclassified",
          matches: 0,
          decided: 0,
          won: 0,
          orders: 0,
          units: 0,
          metal: 0,
          unpriced: 0,
          analysed: null,
        };
        rows.set(key, row);
      }
      // Games come oldest first, so the newest replay's wording stands.
      row.name = unit.fullName || unit.name;
      row.game = family;
      row.category = classifyUnit(unit);
      row.orders += d.placed + d.queued;
      row.units += d.units;
      const cost = metalCost(unit);
      if (cost === null) {
        row.unpriced += d.units;
        out.unpriced += d.units;
      } else {
        row.metal += cost * d.units;
        out.split[splitBucket(row.category)] += cost * d.units;
      }
      if (events) {
        row.analysed ??= { replays: 0, ordered: 0, finished: 0, died: 0 };
        row.analysed.ordered += d.units;
      }
      seen.add(row);
    }
    for (const row of seen) {
      row.matches++;
      if (game.won !== undefined) row.decided++;
      if (game.won === true) row.won++;
      if (events && row.analysed) {
        const sum = events.get(row.unitKey);
        row.analysed.replays++;
        row.analysed.finished += sum?.finished ?? 0;
        row.analysed.died += sum?.died ?? 0;
      }
    }
  }

  out.rows = [...rows.values()];
  return out;
}

/** A column the table sorts by. */
export type UsageColumn =
  | "name"
  | "category"
  | "matches"
  | "units"
  | "metal"
  | "won"
  | "finished"
  | "died";

export interface UsageSort {
  column: UsageColumn;
  dir: "asc" | "desc";
}

/** Metal first, largest at the top. */
export const DEFAULT_USAGE_SORT: UsageSort = { column: "metal", dir: "desc" };

/** A header click: a new column sorts largest first, the same one flips. */
export function nextUsageSort(
  current: UsageSort,
  column: UsageColumn,
): UsageSort {
  if (current.column !== column) {
    const text = column === "name" || column === "category";
    return { column, dir: text ? "asc" : "desc" };
  }
  return { column, dir: current.dir === "desc" ? "asc" : "desc" };
}

function sortValue(row: UnitUsageRow, column: UsageColumn): number | string {
  switch (column) {
    case "name":
      return row.name.toLowerCase();
    case "category":
      return row.category;
    case "finished":
      return row.analysed?.finished ?? -1;
    case "died":
      return row.analysed?.died ?? -1;
    default:
      return row[column];
  }
}

/**
 * The rows in the order a sort asks for. Ties fall back to metal, then to the
 * name, so the order never depends on the order the replays were read in. A
 * row with no finished or died figure sorts below every row that has one.
 */
export function sortUsageRows(
  rows: readonly UnitUsageRow[],
  sort: UsageSort,
): UnitUsageRow[] {
  const sign = sort.dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const x = sortValue(a, sort.column);
    const y = sortValue(b, sort.column);
    const primary =
      typeof x === "string" && typeof y === "string"
        ? x.localeCompare(y)
        : (x as number) - (y as number);
    return (
      primary * sign ||
      b.metal - a.metal ||
      a.name.localeCompare(b.name) ||
      a.key.localeCompare(b.key)
    );
  });
}

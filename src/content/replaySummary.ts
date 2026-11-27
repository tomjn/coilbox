import type {
  DemoBuildOrders,
  DemoInfo,
  DemoTrailer,
  Side,
  UnitDatasetEntry,
} from "./bindings";
import { hubFaction, hubPickUnitIds } from "./hubPlayedFactions";
import { resolveBuildUnit } from "./replayBuildOrders";
import { classifyUnit } from "./unitCategory";

/**
 * The summary the hub takes beside a replay (issue #5493), in the shape
 * `hub-php/docs/replay-uploads.md` in coilbox-hub sets out. The hub checks it
 * against the file (coilbox-hub #663), so every part comes from the reads the
 * replay page already shows: the header and start script in `DemoInfo`, the
 * trailer the statistics read, the build orders the Builds tab reads, the
 * units `useReplayUnits` names them with, and the game's sides.
 */
export interface ReplaySummary {
  v: 1;
  engine: string;
  game: string;
  map: string;
  started_at: number;
  duration: number;
  players: {
    name: string;
    team: number;
    ally_team: number;
    faction: string | null;
  }[];
  spectators: string[];
  winners: number[];
  totals: ({ team: number } & Record<string, number>)[];
  start_positions: { team: number; x: number; z: number }[];
  build_orders: {
    team: number;
    orders: { frame: number; unit_def_id: number }[];
  }[];
  units: {
    unit_def_id: number;
    name: string;
    display_name: string | null;
    metal: number;
    energy: number;
    build_time: number | null;
    category: string | null;
  }[];
}

/** Why a summary could not be made, for the page to word. */
export type SummaryProblem =
  /** The recording stops before the game over, which the hub refuses. */
  | { kind: "unfinished" }
  /** The walk of the stream stopped early, so build orders are missing. */
  | { kind: "incompleteOrders" }
  /** A player has no team in the start script. */
  | { kind: "noTeam"; name: string }
  /** No unit list says what this id is, with a cost. */
  | { kind: "unknownUnit"; unitDefId: number };

/** The hub's name for a sample field, in snake case. */
const snakeCase = (field: string) =>
  field.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);

const number = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

/**
 * Build the summary, or say why it cannot be built.
 *
 * `info` is the replay as decoded, whose sides are the start script's.
 * `units` is the list `useReplayUnits` answers, in id order, and only a list
 * that says what each unit costs will do. A unit's `name` is the one the
 * replay's own unit list gives, when it has one, because that is what the hub
 * checks it against. `sides` is the game's side data, which names the faction a
 * picked start unit belongs to.
 */
export function buildReplaySummary(
  info: DemoInfo,
  trailer: DemoTrailer,
  orders: DemoBuildOrders,
  units: readonly UnitDatasetEntry[],
  sides: readonly Side[],
): { summary: ReplaySummary } | { problem: SummaryProblem } {
  if (!info.winnersKnown || info.durationSec <= 0) {
    return { problem: { kind: "unfinished" } };
  }
  if (orders.incomplete) return { problem: { kind: "incompleteOrders" } };

  const players: ReplaySummary["players"] = [];
  const spectators: string[] = [];
  for (const player of info.players) {
    if (player.spectator) {
      spectators.push(player.name);
      continue;
    }
    if (player.team === undefined || player.allyTeam === undefined) {
      return { problem: { kind: "noTeam", name: player.name } };
    }
    players.push({
      name: player.name,
      team: player.team,
      ally_team: player.allyTeam,
      faction: hubFaction(player, units, sides),
    });
  }

  const totals = trailer.teams.flatMap((series) => {
    const last = series.samples.at(-1);
    if (!last) return [];
    const entry: { team: number } & Record<string, number> = {
      team: series.team,
    };
    // Every figure but the frame, which the hub reads by the same names.
    for (const [field, value] of Object.entries(last)) {
      if (field !== "frame") entry[snakeCase(field)] = value;
    }
    return [entry];
  });

  const byTeam = new Map<number, { frame: number; unit_def_id: number }[]>();
  for (const order of orders.orders) {
    if (order.team === undefined) continue;
    const list = byTeam.get(order.team) ?? [];
    list.push({ frame: order.frame, unit_def_id: order.unitDefId });
    byTeam.set(order.team, list);
  }
  const buildOrders = [...byTeam]
    .sort(([a], [b]) => a - b)
    .map(([team, list]) => ({ team, orders: list }));

  const built = new Set(
    buildOrders.flatMap((t) => t.orders.map((o) => o.unit_def_id)),
  );
  // A picked start unit is listed too, for the hub to name it by.
  const used = [...new Set([...built, ...hubPickUnitIds(info.players)])].sort(
    (a, b) => a - b,
  );
  const listed: ReplaySummary["units"] = [];
  for (const id of used) {
    const unit = resolveBuildUnit(id, units);
    const metal = number(unit?.stats?.metalCost);
    const energy = number(unit?.stats?.energyCost);
    if (!unit || metal === null || energy === null) {
      // The hub does not check a picked unit it is given no name for.
      if (!built.has(id)) continue;
      return { problem: { kind: "unknownUnit", unitDefId: id } };
    }
    listed.push({
      unit_def_id: id,
      // The replay's own list is what the hub checks a name against.
      name: orders.unitNames?.[id - 1] ?? unit.name,
      display_name: unit.fullName || null,
      metal,
      energy,
      build_time: number(unit.stats?.buildTime),
      category: classifyUnit(unit),
    });
  }

  return {
    summary: {
      v: 1,
      engine: info.engineVersion,
      game: info.gameType,
      map: info.mapName,
      started_at: Math.floor(info.startTimeMs / 1000),
      duration: info.durationSec,
      players,
      spectators,
      winners: trailer.winningAllyTeams,
      totals,
      start_positions: (info.startPositions ?? []).map((p) => ({
        team: p.team,
        x: p.x,
        z: p.z,
      })),
      build_orders: buildOrders,
      units: listed,
    },
  };
}

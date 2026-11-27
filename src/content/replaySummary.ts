import type {
  DemoBuildOrders,
  DemoInfo,
  DemoTrailer,
  ReplayPlayer,
  TeamStatSample,
  UnitDatasetEntry,
} from "./bindings";
import { resolveBuildUnit } from "./replayBuildOrders";
import { classifyUnit } from "./unitCategory";

/**
 * The summary the hub takes beside a replay (issue #5493), in the shape
 * `hub-php/docs/replay-uploads.md` in coilbox-hub sets out. The hub checks it
 * against the file (coilbox-hub #663), so every part comes from the reads the
 * replay page already shows: the header and start script in `DemoInfo`, the
 * trailer the statistics read, the build orders the Builds tab reads, and the
 * units `useReplayUnits` names them with.
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

/** The hub's names for the trailer's totals, by `TeamStatSample` field. */
const TOTALS: [keyof TeamStatSample, string][] = [
  ["metalUsed", "metal_used"],
  ["energyUsed", "energy_used"],
  ["metalProduced", "metal_produced"],
  ["energyProduced", "energy_produced"],
  ["metalExcess", "metal_excess"],
  ["energyExcess", "energy_excess"],
  ["metalReceived", "metal_received"],
  ["energyReceived", "energy_received"],
  ["metalSent", "metal_sent"],
  ["energySent", "energy_sent"],
  ["damageDealt", "damage_dealt"],
  ["damageReceived", "damage_received"],
  ["unitsProduced", "units_produced"],
  ["unitsDied", "units_died"],
  ["unitsReceived", "units_received"],
  ["unitsSent", "units_sent"],
  ["unitsCaptured", "units_captured"],
  ["unitsOutCaptured", "units_out_captured"],
  ["unitsKilled", "units_killed"],
];

/**
 * The faction a player played, as the summary sends it.
 *
 * For now the team's `side` in the start script. The hub expects the faction
 * of the player's last pick that counts, and falls back to the side only when
 * there is none, so a replay where somebody picked another faction in game is
 * refused until #5504 replaces this body with that rule.
 */
export function summaryFaction(
  _info: DemoInfo,
  player: ReplayPlayer,
): string | null {
  return player.side ?? null;
}

const number = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

/**
 * Build the summary, or say why it cannot be built.
 *
 * `units` is the list `useReplayUnits` answers, in id order, and only a list
 * that says what each unit costs will do. A unit's `name` is the one the
 * replay's own unit list gives, when it has one, because that is what the hub
 * checks it against.
 */
export function buildReplaySummary(
  info: DemoInfo,
  trailer: DemoTrailer,
  orders: DemoBuildOrders,
  units: readonly UnitDatasetEntry[],
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
      faction: summaryFaction(info, player),
    });
  }

  const totals = trailer.teams.flatMap((series) => {
    const last = series.samples.at(-1);
    if (!last) return [];
    const entry: { team: number } & Record<string, number> = {
      team: series.team,
    };
    for (const [field, key] of TOTALS) entry[key] = last[field];
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

  const used = [
    ...new Set(buildOrders.flatMap((t) => t.orders.map((o) => o.unit_def_id))),
  ].sort((a, b) => a - b);
  const listed: ReplaySummary["units"] = [];
  for (const id of used) {
    const unit = resolveBuildUnit(id, units as UnitDatasetEntry[]);
    const metal = number(unit?.stats?.metalCost);
    const energy = number(unit?.stats?.energyCost);
    if (!unit || metal === null || energy === null) {
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

/**
 * Match awards worked out from an analysed replay (#5492).
 *
 * The kills come from the logger's events, what a unit cost and what it was for
 * from the match's unit list, and each team's totals from the `game_over` line,
 * which an analysis is only kept when it agrees with the replay's own trailer.
 *
 * Awards go to engine teams. Every amount is in metal: no exchange rate between
 * metal and energy is agreed across games, so the two are never added.
 */

import type { UnitDatasetEntry } from "./bindings";
import { FRAMES_PER_SECOND } from "./chatClock";
import type { LogEvent } from "./replayAnalysisEvents";
import { resolveBuildUnit } from "./replayBuildOrders";
import { classifyUnit } from "./unitCategory";

/** The event kinds the awards are worked out from. */
export const AWARD_KINDS = [
  "game_start",
  "unit_created",
  "unit_finished",
  "unit_given",
  "unit_destroyed",
  "game_over",
];

export type AwardId =
  | "economyKilled"
  | "fightingKilled"
  | "efficiency"
  | "produced"
  | "damageTaken"
  | "noKill"
  | "everything";

export interface AwardPlace {
  /** 1 is first. Teams with the same score share a place. */
  place: number;
  team: number;
  /** Metal, a ratio, damage or seconds, by award. A recorded award's is the
   *  game's own figure. Null for winning them all. */
  score: number | null;
}

export interface Award {
  id: AwardId;
  /** Never empty: an award nobody earned is not listed. */
  places: AwardPlace[];
}

export interface AnalysedAwards {
  awards: Award[];
  /** Finished enemy units destroyed that the unit list gives no metal cost. */
  unpriced: number;
}

/** Where the shown awards came from. */
export type AwardSource = "recorded" | "analysis";

/**
 * The one place that picks which awards a replay shows. Awards a game recorded
 * in its replay win over ones worked out here, and the two are never mixed.
 */
export function pickAwards(sources: {
  recorded: Award[] | null;
  analysed: Award[] | null;
}): { source: AwardSource; awards: Award[] } | null {
  if (sources.recorded?.length) {
    return { source: "recorded", awards: sources.recorded };
  }
  if (sources.analysed?.length) {
    return { source: "analysis", awards: sources.analysed };
  }
  return null;
}

/** How many places the three kill awards give. */
const PODIUM = 3;

const num = (v: unknown): number | undefined =>
  typeof v === "number" && Number.isFinite(v) ? v : undefined;

/** The order two events on one frame are read in. The events arrive grouped by
 *  kind, and a unit has to exist before it can be given away or destroyed. */
const rank = (kind: string) => AWARD_KINDS.indexOf(kind);

/** The teams with a score above nothing, best first, down to `places`. */
function ranked(
  scores: ReadonlyMap<number, number>,
  places: number,
): AwardPlace[] {
  const earned = [...scores].filter(([, score]) => score > 0);
  earned.sort(([a, x], [b, y]) => y - x || a - b);
  return earned
    .map(([team, score]) => ({
      place: 1 + earned.filter(([, other]) => other > score).length,
      team,
      score,
    }))
    .filter((p) => p.place <= places);
}

interface Watch {
  /** The frame of the team's last kill, or the start of the game. */
  since: number;
  /** The longest stretch with no kill so far. */
  longest: number;
  /** Units the team holds now. */
  held: number;
  /** The frame it last lost every unit, or null while it has one. */
  emptied: number | null;
}

/**
 * The awards of one analysed match.
 *
 * `allyTeams` says which side each team that played was on. A team that is not
 * in it, such as Gaia, wins nothing and destroying its units is not a kill.
 * `units` is the match's unit list in id order, or null when it cannot be read,
 * which leaves out the three awards that need a cost.
 *
 * A log with no `game_over` line gives nothing.
 */
export function matchAwards(
  events: readonly LogEvent[],
  units: UnitDatasetEntry[] | null,
  allyTeams: ReadonlyMap<number, number>,
): AnalysedAwards {
  const over = events.find((e) => e.kind === "game_over");
  const endFrame = num(over?.frame);
  if (!over || endFrame === undefined) return { awards: [], unpriced: 0 };
  const startFrame =
    num(events.find((e) => e.kind === "game_start")?.frame) ?? 0;

  const economy = new Map<number, number>();
  const fighting = new Map<number, number>();
  const killed = new Map<number, number>();
  const bump = (map: Map<number, number>, team: number, by: number) =>
    map.set(team, (map.get(team) ?? 0) + by);

  const watches = new Map<number, Watch>();
  const watch = (team: number) => {
    let found = watches.get(team);
    if (!found) {
      found = { since: startFrame, longest: 0, held: 0, emptied: null };
      watches.set(team, found);
    }
    return found;
  };

  const owner = new Map<number, number>();
  const finished = new Set<number>();
  const release = (unit: number, frame: number) => {
    const team = owner.get(unit);
    if (team === undefined) return;
    owner.delete(unit);
    const held = watch(team);
    held.held--;
    if (held.held === 0) held.emptied = frame;
  };
  const hold = (unit: number, team: number, frame: number) => {
    if (owner.get(unit) === team) return;
    release(unit, frame);
    owner.set(unit, team);
    const held = watch(team);
    held.held++;
    held.emptied = null;
  };

  let unpriced = 0;
  const ordered = [...events].sort(
    (a, b) =>
      (num(a.frame) ?? 0) - (num(b.frame) ?? 0) || rank(a.kind) - rank(b.kind),
  );
  for (const event of ordered) {
    const frame = num(event.frame);
    const id = num(event.unit);
    const team = num(event.team);
    if (frame === undefined || id === undefined || team === undefined) {
      continue;
    }
    if (event.kind === "unit_created") {
      finished.delete(id);
      hold(id, team, frame);
    } else if (event.kind === "unit_finished") {
      finished.add(id);
      hold(id, team, frame);
    } else if (event.kind === "unit_given") {
      hold(id, team, frame);
    } else if (event.kind === "unit_destroyed") {
      const wasFinished = finished.delete(id);
      release(id, frame);

      const by = num(event.attackerTeam);
      const side = allyTeams.get(team);
      const bySide = by === undefined ? undefined : allyTeams.get(by);
      if (by === undefined || side === undefined || bySide === undefined) {
        continue;
      }
      if (side === bySide) continue;

      // A shot that lands after a team is knocked out ends no wait.
      const killer = watch(by);
      if (killer.emptied === null) {
        killer.longest = Math.max(killer.longest, frame - killer.since);
        killer.since = frame;
      }

      // A unit still being built has not cost its price yet.
      if (!units || !wasFinished) continue;
      const def = num(event.def);
      const unit = def === undefined ? undefined : resolveBuildUnit(def, units);
      const cost = num(
        (unit?.stats as Record<string, unknown> | undefined)?.metalCost,
      );
      if (!unit || cost === undefined) {
        unpriced++;
        continue;
      }
      bump(killed, by, cost);
      const category = classifyUnit(unit);
      if (category === "economy" && !unit.mobile) bump(economy, by, cost);
      if (category === "offence" || category === "defence") {
        bump(fighting, by, cost);
      }
    }
  }

  const produced = new Map<number, number>();
  const taken = new Map<number, number>();
  const efficiency = new Map<number, number>();
  const totals = Array.isArray(over.teams) ? (over.teams as unknown[]) : [];
  for (const entry of totals) {
    const total = entry as Record<string, unknown>;
    const team = num(total.team);
    if (team === undefined || !allyTeams.has(team)) continue;
    produced.set(team, num(total.metalProduced) ?? 0);
    taken.set(team, num(total.damageReceived) ?? 0);
    const spent = num(total.metalUsed) ?? 0;
    if (spent > 0) efficiency.set(team, (killed.get(team) ?? 0) / spent);
  }

  // A team that lost every unit stops waiting for a kill on that frame, or the
  // first team knocked out of a match would win by sitting out the rest of it.
  const quiet = new Map<number, number>();
  for (const [team, w] of watches) {
    if (!allyTeams.has(team)) continue;
    const end = w.emptied ?? endFrame;
    quiet.set(team, Math.max(w.longest, end - w.since) / FRAMES_PER_SECOND);
  }

  const every: Award[] = [
    { id: "economyKilled", places: ranked(economy, PODIUM) },
    { id: "fightingKilled", places: ranked(fighting, PODIUM) },
    { id: "efficiency", places: ranked(efficiency, PODIUM) },
    { id: "produced", places: ranked(produced, 1) },
    { id: "damageTaken", places: ranked(taken, 1) },
    { id: "noKill", places: ranked(quiet, 1) },
  ];
  const awards = every.filter((a) => a.places.length > 0);

  // Winning everything takes first place alone in all six.
  const firsts = every.map((a) => a.places.filter((p) => p.place === 1));
  const sweeper = firsts[0][0]?.team;
  if (
    sweeper !== undefined &&
    firsts.every((f) => f.length === 1 && f[0].team === sweeper)
  ) {
    awards.push({
      id: "everything",
      places: [{ place: 1, team: sweeper, score: null }],
    });
  }
  return { awards, unpriced };
}

/**
 * What each player's living units were worth over a match, by kind of unit
 * (#1174).
 *
 * Nothing is sampled by the logger for this. A unit joins a player's living
 * set when it is finished and leaves it when it is destroyed or changes hands,
 * and the log holds all four events, so the value at any moment is a running
 * sum over them. What a unit costs and what it is for come from the installed
 * game through `classifyUnit`, the one classifier the app has, so the kinds
 * here are the kinds every other view uses and get better without a new
 * analysis.
 *
 * Metal and energy are kept apart: no exchange rate between them is agreed
 * across games.
 */

import type { UnitDatasetEntry } from "./bindings";
import { FRAMES_PER_SECOND } from "./chatClock";
import type { LogEvent } from "./replayAnalysisEvents";
import { resolveBuildUnit } from "./replayBuildOrders";
import {
  type CostShare,
  SPLIT_BUCKETS,
  type SplitBucket,
  splitBucket,
} from "./replayOpening";
import { classifyUnit } from "./unitCategory";

/** The event kinds the sum is built from. */
export const LIVING_VALUE_KINDS = [
  "unit_finished",
  "unit_destroyed",
  "unit_given",
];

/** The first logger that records a unit changing hands. Before it, a unit
 *  given away or captured stays with its first owner for good. */
export const GIVEN_LOGGER_VERSION = 2;

export type ValueResource = keyof CostShare;

/** One moment: each kind's living cost for one team. */
export type ValueSample = Record<SplitBucket, CostShare>;

export interface LivingValue {
  /** The time of each sample, in seconds from the start of the game. */
  seconds: number[];
  /** team -> one sample per entry of `seconds`. */
  teams: Map<number, ValueSample[]>;
  /** Finished units no cost could be found for, which add nothing. */
  unpriced: number;
  /** Finished units in all, so `unpriced` can be read against something. */
  finished: number;
}

const num = (v: unknown): number | undefined =>
  typeof v === "number" && Number.isFinite(v) ? v : undefined;

function stat(unit: UnitDatasetEntry, key: string): number | null {
  const value = (unit.stats as Record<string, unknown> | undefined)?.[key];
  return typeof value === "number" && value >= 0 ? value : null;
}

interface Living {
  team: number;
  bucket: SplitBucket;
  cost: CostShare;
}

const emptySample = (): ValueSample =>
  Object.fromEntries(
    SPLIT_BUCKETS.map((b) => [b, { metal: 0, energy: 0 }]),
  ) as ValueSample;

/**
 * Each team's living value every `periodSec` seconds, from the first sample at
 * zero to the last whole period before `endFrame`.
 *
 * A unit counts from the frame it is finished: one still being built is not
 * worth its cost yet. It stops counting on the frame it is destroyed, and moves
 * to its new team on the frame it is given or captured. A sample holds what
 * was alive at the end of its frame.
 */
export function livingValue(
  events: readonly LogEvent[],
  units: UnitDatasetEntry[],
  periodSec: number,
  endFrame: number,
): LivingValue {
  const out: LivingValue = {
    seconds: [],
    teams: new Map(),
    unpriced: 0,
    finished: 0,
  };
  if (!(periodSec > 0)) return out;

  const alive = new Map<number, Living>();
  const now = new Map<number, ValueSample>();
  const sampleOf = (team: number) => {
    let sample = now.get(team);
    if (!sample) {
      sample = emptySample();
      now.set(team, sample);
      // A team first seen part way through was worth nothing before then.
      out.teams.set(
        team,
        out.seconds.map(() => emptySample()),
      );
    }
    return sample;
  };
  const add = (unit: Living, sign: 1 | -1) => {
    const share = sampleOf(unit.team)[unit.bucket];
    share.metal += sign * unit.cost.metal;
    share.energy += sign * unit.cost.energy;
  };
  const snapshot = (second: number) => {
    out.seconds.push(second);
    for (const [team, sample] of now)
      out.teams.get(team)?.push(structuredClone(sample));
  };

  const periodFrames = periodSec * FRAMES_PER_SECOND;
  let next = 0;
  const ordered = [...events].sort(
    (a, b) => (num(a.frame) ?? 0) - (num(b.frame) ?? 0),
  );
  for (const event of ordered) {
    const frame = num(event.frame);
    const id = num(event.unit);
    if (frame === undefined || id === undefined) continue;
    while (next < frame && next <= endFrame) {
      snapshot(next / FRAMES_PER_SECOND);
      next += periodFrames;
    }
    if (event.kind === "unit_finished") {
      const team = num(event.team);
      const def = num(event.def);
      if (team === undefined || alive.has(id)) continue;
      out.finished++;
      const unit = def === undefined ? undefined : resolveBuildUnit(def, units);
      const metal = unit ? stat(unit, "metalCost") : null;
      const energy = unit ? stat(unit, "energyCost") : null;
      if (!unit || (metal === null && energy === null)) {
        out.unpriced++;
        continue;
      }
      const living = {
        team,
        bucket: splitBucket(classifyUnit(unit)),
        cost: { metal: metal ?? 0, energy: energy ?? 0 },
      };
      alive.set(id, living);
      add(living, 1);
    } else if (event.kind === "unit_destroyed") {
      const living = alive.get(id);
      if (!living) continue;
      add(living, -1);
      alive.delete(id);
    } else if (event.kind === "unit_given") {
      const living = alive.get(id);
      const team = num(event.team);
      if (!living || team === undefined) continue;
      add(living, -1);
      living.team = team;
      add(living, 1);
    }
  }
  while (next <= endFrame) {
    snapshot(next / FRAMES_PER_SECOND);
    next += periodFrames;
  }
  return out;
}

/** One row of a stacked chart: a time, and each kind's value at it. */
export type ValueRow = { timeSec: number } & Record<SplitBucket, number>;

/** The rows for some teams added together, in one resource. */
export function valueRows(
  value: LivingValue,
  teams: readonly number[],
  resource: ValueResource,
): ValueRow[] {
  return value.seconds.map((timeSec, i) => {
    const row = { timeSec } as ValueRow;
    for (const bucket of SPLIT_BUCKETS) {
      let total = 0;
      for (const team of teams)
        total += value.teams.get(team)?.[i]?.[bucket][resource] ?? 0;
      // Sums of costs drift by a float's last digits as units come and go.
      row[bucket] = Math.max(0, Math.round(total * 100) / 100);
    }
    return row;
  });
}

/** The tallest stack any of `rows` reaches, so every panel shares one scale. */
export function peakOf(rows: readonly ValueRow[]): number {
  let peak = 0;
  for (const row of rows) {
    let total = 0;
    for (const bucket of SPLIT_BUCKETS) total += row[bucket];
    if (total > peak) peak = total;
  }
  return peak;
}

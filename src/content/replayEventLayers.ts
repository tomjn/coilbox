/**
 * The replay map's layers drawn from an analysed replay's event log (#1160):
 * where units died, and where buildings were finished. The two about starting
 * units are in `replayStartUnits.ts`.
 *
 * Arithmetic on plain values, so the placing and the wording can be tested with
 * numbers. These are events from playing the match back, which is a different
 * source from the orders the other layers draw: an order is what a player asked
 * for, and an event is what the simulation did. Positions are in engine world
 * units, placed on the map by `mapFraction` and `buildHeatField` exactly as the
 * order layers are.
 */

import type { HeatPoints } from "@/lib/heatField";
import type { StoredReplayAnalysis, UnitDatasetEntry } from "./bindings";
import type { LogEvent } from "./replayAnalysisEvents";
import { resolveBuildUnit } from "./replayBuildOrders";
import { type BuildMark, type MapWorld, mapFraction } from "./replayMapLayers";
import { classifyUnit } from "./unitCategory";

/** The event kinds each layer reads. The command is asked for these and no more. */
export const DEATH_KINDS = ["unit_destroyed"];
export const FINISHED_KINDS = ["unit_finished"];

/** An event with a place and a time, which is what a layer needs of it. */
export interface PlacedEvent {
  frame: number;
  team: number | undefined;
  /** The unit definition id as the analysis run's engine numbered them. */
  def: number | undefined;
  x: number;
  z: number;
  /** Whether the log names what destroyed the unit. Only a death has one. */
  attacked: boolean;
}

const num = (v: unknown): number | undefined =>
  typeof v === "number" && Number.isFinite(v) ? v : undefined;

/** The events of one kind that carry a frame and a position. */
export function placedEvents(
  events: readonly LogEvent[],
  kind: string,
): PlacedEvent[] {
  const out: PlacedEvent[] = [];
  for (const event of events) {
    if (event.kind !== kind) continue;
    const frame = num(event.frame);
    const x = num(event.x);
    const z = num(event.z);
    if (frame === undefined || x === undefined || z === undefined) continue;
    out.push({
      frame,
      team: num(event.team),
      def: num(event.def),
      x,
      z,
      attacked:
        num(event.attackerTeam) !== undefined ||
        num(event.attacker) !== undefined,
    });
  }
  return out;
}

/** What a unit costs in metal, or undefined when the dataset does not say. */
export function metalCost(unit: UnitDatasetEntry | undefined) {
  const cost = unit?.stats?.metalCost;
  return typeof cost === "number" && cost >= 0 ? cost : undefined;
}

/** How many deaths are of a unit whose cost the installed game states. */
export function costedDeaths(
  deaths: readonly PlacedEvent[],
  units: UnitDatasetEntry[] | null,
): number {
  if (!units) return 0;
  let n = 0;
  for (const d of deaths) {
    if (
      d.def !== undefined &&
      metalCost(resolveBuildUnit(d.def, units)) !== undefined
    )
      n++;
  }
  return n;
}

/**
 * Deaths as points for a density field, with each death's frame in a parallel
 * array for the time window.
 *
 * Unweighted, each death counts one: where units died. With `units` and
 * `weighted` each counts its metal cost: where value was lost. A unit the
 * installed game cannot cost counts nothing in that mode.
 */
export function deathPoints(
  deaths: readonly PlacedEvent[],
  weight: UnitDatasetEntry[] | null,
): { points: HeatPoints; frames: Float64Array } {
  const positions = new Float32Array(deaths.length * 2);
  const frames = new Float64Array(deaths.length);
  const weights = weight ? new Float32Array(deaths.length) : undefined;
  deaths.forEach((d, i) => {
    positions[i * 2] = d.x;
    positions[i * 2 + 1] = d.z;
    frames[i] = d.frame;
    if (weights)
      weights[i] =
        (d.def === undefined
          ? undefined
          : metalCost(resolveBuildUnit(d.def, weight))) ?? 0;
  });
  return { points: weights ? { positions, weights } : { positions }, frames };
}

/** A finished building ready to draw, with the frame the window reads. */
export interface FinishedMark extends BuildMark {
  frame: number;
}

export interface FinishedBuildings {
  marks: FinishedMark[];
  /** Finished units that move. They leave a factory and are not drawn. */
  mobile: number;
  /** Finished units the installed game has no definition for. */
  unknown: number;
  /** Finished buildings that stand off the map and are not drawn. */
  offMap: number;
}

/**
 * The finished units that are buildings, as marks in the order layer's shapes.
 *
 * A finished mobile unit has a position where it left its factory, which says
 * nothing a building order can be compared with, so it is counted and left out.
 * Without the game's units nothing can be told apart and no mark is made.
 */
export function finishedBuildings(
  finished: readonly PlacedEvent[],
  world: MapWorld,
  units: UnitDatasetEntry[] | null,
): FinishedBuildings {
  const out: FinishedBuildings = {
    marks: [],
    mobile: 0,
    unknown: 0,
    offMap: 0,
  };
  if (!units) return out;
  for (const f of finished) {
    const unit =
      f.def === undefined ? undefined : resolveBuildUnit(f.def, units);
    if (!unit) {
      out.unknown++;
      continue;
    }
    if (unit.mobile) {
      out.mobile++;
      continue;
    }
    const at = mapFraction(f, world);
    if (!at) {
      out.offMap++;
      continue;
    }
    out.marks.push({
      ...at,
      frame: f.frame,
      team: f.team,
      category: classifyUnit(unit),
    });
  }
  return out;
}

/** What the replay's analysis lets the event layers do. */
export type EventState =
  | {
      kind: "ready";
      outdated: boolean;
      gameId: string;
      analysedAtMs: number;
      /** Which logger recorded the events, for a layer a later one made possible. */
      loggerVersion: number;
    }
  | { kind: "notAnalysed"; canAnalyse: boolean }
  | { kind: "diverged" }
  | { kind: "remix" };

export function eventState(
  info: { remixed?: boolean; gameId?: string },
  stored: StoredReplayAnalysis | undefined,
  runHidden: boolean,
): EventState {
  if (info.remixed) return { kind: "remix" };
  if (!info.gameId || !stored)
    return { kind: "notAnalysed", canAnalyse: !runHidden && !!info.gameId };
  if (stored.state === "diverged") return { kind: "diverged" };
  return {
    kind: "ready",
    outdated: stored.state === "outdated",
    gameId: info.gameId,
    analysedAtMs: stored.analysedAtMs,
    loggerVersion: stored.loggerVersion,
  };
}

/** The layers' names, which the notices use. */
export const EVENT_LAYER_NAMES =
  "Deaths, Buildings finished and the two starting unit layers";

/**
 * Why the event layers cannot be switched on, or null when they can. The
 * analysis wording is the analysis section's own.
 */
export function eventBlock(state: EventState): string | null {
  switch (state.kind) {
    case "ready":
      return null;
    case "remix":
      return `${EVENT_LAYER_NAMES} draw events from an analysis, and a remix has no analysis of its own. Analyse the original match.`;
    case "diverged":
      return `${EVENT_LAYER_NAMES} draw events from an analysis. The playback did not reproduce the recorded match, so what it recorded was thrown away and there is nothing to draw.`;
    case "notAnalysed":
      return state.canAnalyse
        ? `${EVENT_LAYER_NAMES} draw events from an analysis, and this replay has not been analysed.`
        : `${EVENT_LAYER_NAMES} draw events from an analysis, and this replay has not been analysed. This copy of coilbox cannot analyse replays.`;
  }
}

/** The one line the events table uses about an older logger. */
export const OUTDATED_NOTE =
  "This analysis was recorded by an older logger and may lack newer kinds of event.";

/** The subject of the window's readout, from which layers are on. */
export function windowSubject(
  ordersOn: boolean,
  eventsOn: boolean,
): "orders" | "events" | "both" {
  return ordersOn && eventsOn ? "both" : eventsOn ? "events" : "orders";
}

const plural = (n: number, one: string, many: string) =>
  `${n.toLocaleString()} ${n === 1 ? one : many}`;

/** The legend of a deaths field: what is counted and what the peak holds. */
export function deathLegend(
  field: { peakWithinRadius?: number; radius: number },
  weighted: boolean,
  inWindow: boolean,
): { label: string; peak: string } {
  const peak = Math.round(field.peakWithinRadius ?? 0);
  const where = `within ${Math.round(field.radius).toLocaleString()} elmos of one spot${inWindow ? " in this window" : ""}`;
  return weighted
    ? {
        label: "Where metal was lost",
        peak: `${peak.toLocaleString()} metal of units lost ${where}`,
      }
    : {
        label: "Where units died",
        peak: `${plural(peak, "death", "deaths")} ${where}`,
      };
}

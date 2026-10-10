/**
 * The replay map's damage layer (#1175): where damage landed, and where it
 * came from.
 *
 * The logger does not write a line for each hit, because one unit under fire is
 * hit many times a second. It adds damage up in the engine and writes, for each
 * stretch of the match and each pair of teams, how much fell in each cell of
 * the heat grid. So there are no points here, only cells, and a field is made
 * from them with `buildHeatFieldFromCounts`.
 *
 * Arithmetic on plain values, so the sums and the wording can be tested with
 * numbers.
 */

import { heatGridSize } from "@/lib/heatField";
import type { LogEvent } from "./replayAnalysisEvents";
import type { MapWorld } from "./replayMapLayers";
import { type FrameRange, isWholeMatch } from "./replayTimeWindow";

/** The event kinds the layer reads. The header says which grid the cells are on. */
export const DAMAGE_KINDS = ["header", "damage"];

/** The first logger that records damage. */
export const DAMAGE_LOGGER_VERSION = 4;

/** Which end of a hit is drawn: where the unit hit stood, or the attacker. */
export type DamageMode = "at" | "origin";

/** One stretch of damage by one team to another, as cells and amounts. */
export interface DamageLine {
  /** The stretch's first frame. */
  frame: number;
  /** The attacker's team. Undefined for damage nothing dealt, such as water. */
  team: number | undefined;
  target: number;
  /** A cell and then the damage in it, where the units hit stood. */
  at: number[];
  /** The same for where the attackers stood. Empty with no attacker. */
  origin: number[];
  /** Damage to a unit that stood off the map, which is in no cell. */
  off: number;
}

export interface DamageLog {
  /** The grid the logger added damage up on, or null when the log names none. */
  grid: { width: number; height: number } | null;
  /** How many frames one line adds up. 0 when the log does not say. */
  frames: number;
  lines: DamageLine[];
}

const num = (v: unknown): number | undefined =>
  typeof v === "number" && Number.isFinite(v) ? v : undefined;

const cells = (v: unknown): number[] =>
  Array.isArray(v) && v.length % 2 === 0 && v.every((n) => num(n) !== undefined)
    ? (v as number[])
    : [];

/** The damage lines of a log, with the grid its header names. */
export function damageLog(events: readonly LogEvent[]): DamageLog {
  const out: DamageLog = { grid: null, frames: 0, lines: [] };
  for (const event of events) {
    if (event.kind === "header") {
      const width = num(event.gridWidth);
      const height = num(event.gridHeight);
      if (width && height) out.grid = { width, height };
      out.frames = num(event.damageFrames) ?? 0;
      continue;
    }
    if (event.kind !== "damage") continue;
    const frame = num(event.frame);
    const target = num(event.target);
    if (frame === undefined || target === undefined) continue;
    out.lines.push({
      frame,
      team: num(event.team),
      target,
      at: cells(event.at),
      origin: cells(event.origin),
      off: num(event.off) ?? 0,
    });
  }
  return out;
}

/**
 * Whether the logger's grid is the one this map's heat field uses. They are
 * made by the same arithmetic from the same map, so they differ only when the
 * map coilbox has installed is another size from the one the match was played
 * on, and then a cell number would point at the wrong place.
 */
export function gridFits(log: DamageLog, world: MapWorld): boolean {
  if (!log.grid) return false;
  const { width, height } = heatGridSize(world.worldWidth, world.worldHeight);
  return log.grid.width === width && log.grid.height === height;
}

/** The lines whose stretch begins inside a window. */
export function damageInRange(
  lines: readonly DamageLine[],
  range: FrameRange,
): readonly DamageLine[] {
  if (isWholeMatch(range)) return lines;
  return lines.filter((l) => l.frame >= range.from && l.frame <= range.to);
}

export interface DamageGrid {
  /** Damage in each cell, row by row from the north west corner. */
  binned: Float32Array;
  /** All the damage in the cells. */
  total: number;
}

/**
 * Damage added up over some lines, on a grid of `size` cells.
 *
 * `at` is where it landed, and counts every line. `origin` is where it came
 * from, and counts only what an attacker dealt, since the rest came from
 * nowhere. A cell number past the grid is left out.
 */
export function damageGrid(
  lines: readonly DamageLine[],
  size: { width: number; height: number },
  mode: DamageMode,
): DamageGrid {
  const binned = new Float32Array(size.width * size.height);
  let total = 0;
  for (const line of lines) {
    const list = mode === "at" ? line.at : line.origin;
    for (let i = 0; i + 1 < list.length; i += 2) {
      const cell = list[i];
      const amount = list[i + 1];
      if (!Number.isInteger(cell) || cell < 0 || cell >= binned.length)
        continue;
      if (!(amount > 0)) continue;
      binned[cell] += amount;
      total += amount;
    }
  }
  return { binned, total };
}

/** What some lines hold that a picture of them leaves out. */
export interface DamageTotals {
  /** Everything that landed, on the map or off it. */
  landed: number;
  /** The part of it no attacker dealt. */
  unattacked: number;
  /** The part a team did to its own units. */
  own: number;
  /** The part that landed on a unit standing off the map. */
  offMap: number;
}

export function damageTotals(lines: readonly DamageLine[]): DamageTotals {
  const out: DamageTotals = { landed: 0, unattacked: 0, own: 0, offMap: 0 };
  for (const line of lines) {
    let sum = line.off;
    for (let i = 1; i < line.at.length; i += 2) sum += line.at[i];
    out.landed += sum;
    out.offMap += line.off;
    if (line.team === undefined) out.unattacked += sum;
    else if (line.team === line.target) out.own += sum;
  }
  return out;
}

/** The legend of a damage field: what is drawn and what the peak holds. */
export function damageLegend(
  field: { peakWithinRadius?: number; radius: number },
  mode: DamageMode,
  inWindow: boolean,
): { label: string; peak: string } {
  const peak = Math.round(field.peakWithinRadius ?? 0).toLocaleString();
  const where = `within ${Math.round(field.radius).toLocaleString()} elmos of one spot${inWindow ? " in this window" : ""}`;
  return mode === "at"
    ? {
        label: "Where damage landed",
        peak: `${peak} damage landed ${where}`,
      }
    : {
        label: "Where damage came from",
        peak: `${peak} damage was dealt from ${where}`,
      };
}

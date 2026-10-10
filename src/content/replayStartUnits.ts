/**
 * The replay map's two layers about the units each team started with (#1160):
 * where they went, and where they ended.
 *
 * These are starting units and not commanders. The engine has no idea of a
 * commander, so the logger flags the one thing it can say for any game: a unit
 * created for a team, by no builder, on the frame that team's first unit was
 * created. In most games that is the commander, and the interface still says
 * "starting unit", because that is what was recorded.
 *
 * Arithmetic on plain values, so the tracks and the wording can be tested with
 * numbers.
 */

import type { LogEvent } from "./replayAnalysisEvents";
import {
  type MapFraction,
  type MapWorld,
  mapFraction,
} from "./replayMapLayers";
import { type FrameRange, isWholeMatch } from "./replayTimeWindow";

/** The event kinds the two layers read. The command is asked for these and no more. */
export const START_UNIT_KINDS = [
  "unit_created",
  "unit_destroyed",
  "unit_given",
  "start_unit_position",
];

/** The first logger that flags starting units and writes their positions. */
export const START_UNIT_LOGGER_VERSION = 2;

/**
 * The weapon id the engine reports for a unit a Lua script destroyed: minus
 * `CSolidObject::DAMAGE_KILLED_LUA`, which is 21 in the engine's
 * `rts/Sim/Objects/SolidObject.h`. A game that swaps a unit for its upgrade
 * destroys the old one this way.
 */
export const KILLED_BY_SCRIPT_WEAPON = -21;

export interface TrackPoint {
  frame: number;
  x: number;
  z: number;
}

/** How a starting unit's track stopped. */
export interface TrackEnd extends TrackPoint {
  /**
   * `destroyed` for a death, and `removed` for a unit the game's own script
   * took away with no attacker, which is what an upgrade looks like in the log.
   */
  cause: "destroyed" | "removed";
  /** The team whose unit destroyed it, when the log names one. */
  attackerTeam?: number;
}

/** One starting unit: whose it was, where it was over time and how it ended. */
export interface StartUnitTrack {
  unit: number;
  /** The team that started with it, which is whose colour it is drawn in. */
  team: number;
  /** Whether it was given to or captured by another team at any point. */
  changedTeam: boolean;
  /** Its positions in frame order, the first being where it was created. */
  points: TrackPoint[];
  /** Null for a unit still alive when the match ended. */
  end: TrackEnd | null;
}

const num = (v: unknown): number | undefined =>
  typeof v === "number" && Number.isFinite(v) ? v : undefined;

function point(event: LogEvent): TrackPoint | undefined {
  const frame = num(event.frame);
  const x = num(event.x);
  const z = num(event.z);
  return frame === undefined || x === undefined || z === undefined
    ? undefined
    : { frame, x, z };
}

/**
 * Every starting unit in a log, in the order they were created.
 *
 * A track is the unit's created line, then each position the logger wrote for
 * it, then its destroyed line. The logger leaves a position out when the unit
 * has not moved, so two points far apart in time are a unit that stood still
 * and then walked, never a gap in the record.
 */
export function startUnitTracks(events: readonly LogEvent[]): StartUnitTrack[] {
  const tracks = new Map<number, StartUnitTrack>();
  for (const event of events) {
    const unit = num(event.unit);
    if (unit === undefined) continue;
    const at = point(event);
    if (event.kind === "unit_created") {
      const team = num(event.team);
      if (event.startUnit !== true || team === undefined || !at) continue;
      tracks.set(unit, {
        unit,
        team,
        changedTeam: false,
        points: [at],
        end: null,
      });
      continue;
    }
    const track = tracks.get(unit);
    // Unit ids are reused, so a line after a track's end is another unit's.
    if (!track || track.end || !at) continue;
    if (event.kind === "start_unit_position") {
      track.points.push(at);
    } else if (event.kind === "unit_given") {
      track.changedTeam = true;
      track.points.push(at);
    } else if (event.kind === "unit_destroyed") {
      const attackerTeam = num(event.attackerTeam);
      const attacked =
        attackerTeam !== undefined || num(event.attacker) !== undefined;
      track.points.push(at);
      track.end = {
        ...at,
        cause:
          !attacked && num(event.weapon) === KILLED_BY_SCRIPT_WEAPON
            ? "removed"
            : "destroyed",
        ...(attackerTeam === undefined ? {} : { attackerTeam }),
      };
    }
  }
  for (const track of tracks.values())
    track.points.sort((a, b) => a.frame - b.frame);
  return [...tracks.values()];
}

/**
 * The part of a track inside a time window.
 *
 * A unit that was already alive when the window opens starts at the last
 * position written before it, which is where it still was: the logger writes a
 * position only when one changes. A unit created after the window, or ended
 * before it, has no points.
 */
export function trackInRange(
  track: StartUnitTrack,
  range: FrameRange,
): TrackPoint[] {
  if (isWholeMatch(range)) return track.points;
  const first = track.points[0];
  if (!first || first.frame > range.to) return [];
  if (track.end && track.end.frame < range.from) return [];
  const out: TrackPoint[] = [];
  let before: TrackPoint | undefined;
  for (const p of track.points) {
    if (p.frame < range.from) before = p;
    else if (p.frame <= range.to) out.push(p);
  }
  return before ? [before, ...out] : out;
}

/** A track's points placed on the 2D map. One that is off the map is dropped. */
export function placeTrack(
  points: readonly TrackPoint[],
  world: MapWorld,
): MapFraction[] {
  const out: MapFraction[] = [];
  for (const p of points) {
    const at = mapFraction(p, world);
    if (at) out.push(at);
  }
  return out;
}

/** How far a track goes, in elmos, from one position to the next. */
export function trackLength(points: readonly TrackPoint[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++)
    total += Math.hypot(
      points[i].x - points[i - 1].x,
      points[i].z - points[i - 1].z,
    );
  return total;
}

/** A starting unit's end, ready to draw and to say. */
export interface StartUnitEnd extends TrackEnd {
  unit: number;
  team: number;
}

/** The ends of the tracks that have one, in the order they happened. */
export function startUnitEnds(
  tracks: readonly StartUnitTrack[],
): StartUnitEnd[] {
  const out: StartUnitEnd[] = [];
  for (const track of tracks)
    if (track.end)
      out.push({ ...track.end, unit: track.unit, team: track.team });
  return out.sort((a, b) => a.frame - b.frame);
}

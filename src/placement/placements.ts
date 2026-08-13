/**
 * The individual units a document puts on the ground, as the scene draws them.
 *
 * A document holds several shapes that all end up as a model standing
 * somewhere: an actor is one unit at one point, a group is a bag of counts at
 * one point, and a base is a blueprint's buildings offset from an origin. The
 * scene does not care which it came from, only where a unit stands, which way it
 * faces and whose it is, so the difference is resolved once, by whoever flattens
 * the document, and everything downstream works on one list of these.
 *
 * Arithmetic only, so it can be tested without a GPU. The three.js half lives in
 * `unitsLayer.ts`.
 */

import { type Ground, standsOn, unitSlopes } from "@/blueprint/buildable";
import {
  buildingFootprints,
  type FootprintMark,
  footprintMarks,
} from "@/blueprint/footprint";
import type { UnknownBuilding } from "@/blueprint/units";
import type { Participant, Rgb } from "@/play/config";
import type { Facing, Point } from "@/scenario/model";

/** One unit to draw, and the document entry it came from. */
export interface Placement {
  /**
   * Identifies the drawn object. Unique across the whole document, and stable
   * as long as the entry keeps its id and its members keep their order, so a
   * pick can be turned straight back into the thing that was clicked.
   */
  key: string;
  kind: "actor" | "group" | "base";
  /** The id of the actor, group or base this unit belongs to. */
  id: string;
  /** Which unit within a group or base. Always 0 for an actor. */
  index: number;
  /** Unit def name, as the document holds it. */
  def: string;
  /** A `setup.participants` id. */
  team: string;
  /** Where it stands, in elmos from the map's north-west corner. For a base's
   *  building that is where the engine will stand it, which is not always the
   *  point its layout names. */
  pos: Point;
  /**
   * The point the layout names, for a base's building the grid moved. The same
   * as `pos` for everything else, and left out there.
   *
   * Kept because an edit shifts this point rather than the drawn one, so
   * anything working out where a drag will land has to start from it or it
   * answers a different question (issue #1512).
   */
  named?: Point;
  facing: Facing;
}

/** The key format, in one place, so a picker can build a key to look up by. */
export function placementKey(
  kind: Placement["kind"],
  id: string,
  index = 0,
): string {
  return kind === "actor" ? `actor:${id}` : `${kind}:${id}#${index}`;
}

/** Which document entry a drawn object belongs to. */
export interface PlacementRef {
  kind: Placement["kind"];
  id: string;
  index: number;
}

/**
 * The entry a placement key names, or `null` if it names nothing.
 *
 * The inverse of {@link placementKey}. Ids are UUIDs, so the separators cannot
 * appear inside one, but the index is still read off the end rather than by
 * splitting blindly.
 */
export function parsePlacementKey(key: string): PlacementRef | null {
  const colon = key.indexOf(":");
  if (colon < 0) return null;
  const kind = key.slice(0, colon);
  const rest = key.slice(colon + 1);
  if (kind === "actor") return rest ? { kind, id: rest, index: 0 } : null;
  if (kind !== "group" && kind !== "base") return null;
  const hash = rest.lastIndexOf("#");
  if (hash <= 0) return null;
  const index = Number(rest.slice(hash + 1));
  if (!Number.isInteger(index) || index < 0) return null;
  return { kind, id: rest.slice(0, hash), index };
}

/**
 * Every drawn object that moves when this one is dragged.
 *
 * One key for an actor or a base's building, the whole formation for a group's
 * unit, so the scene shows the group moving as a block while the pointer is
 * down.
 */
export function dragKeys(placements: Placement[], key: string): string[] {
  const ref = parsePlacementKey(key);
  if (!ref) return [];
  if (ref.kind !== "group")
    return placements.some((p) => p.key === key) ? [key] : [];
  return placements
    .filter((p) => p.kind === "group" && p.id === ref.id)
    .map((p) => p.key);
}

/** What the check needs to know about a game's units: how much ground each one
 *  stands on, and how steep that ground may be. */
export type BuildingUnit = {
  name: string;
  footprintX?: number;
  footprintZ?: number;
  maxSlope?: number;
  floatOnWater?: boolean;
};

/**
 * The ground every building in the document stands on, which of them are
 * fighting over it, and which of them the ground itself will not take.
 *
 * Only a base's buildings: an actor or a group's units are mobile, they are not
 * put through the engine's build grid, and two of them standing on the same spot
 * walk apart the moment the game starts. A building that cannot be built is a
 * different thing entirely, which is why only these are checked.
 */
export function baseFootprints(
  placements: Placement[],
  units: BuildingUnit[],
  /** The map's ground, when there is a map and it can be read finely enough.
   *  Without one no building gets a verdict, and each one says so. */
  ground: Ground | null = null,
  /** Whether `units` is the game's dataset read rather than an empty list
   *  standing in for one not read yet, as {@link unitSlopes} takes it. */
  checked = units.length > 0,
): FootprintMark[] {
  const slopeOf = unitSlopes(units, checked);
  return footprintMarks(
    placements.filter((placement) => placement.kind === "base"),
    buildingFootprints(units),
    (mark) => standsOn(mark, ground, slopeOf(mark.def)),
  );
}

/**
 * Which of one base's buildings name a unit this game has not got (issue
 * #1445).
 *
 * The import worked this out and said so, and then the layout was taken and the
 * answer was thrown away. Read off the marks instead, so it is true of a layout
 * typed or edited into that state as well as of an imported one, and so it stays
 * true as the game under it changes.
 *
 * Empty before the game's units have been read, because a def nothing has looked
 * up is not a def the game has not got.
 */
export function absentIn(
  placements: Placement[],
  marks: FootprintMark[],
  baseId: string,
): UnknownBuilding[] {
  const absent = new Set(
    marks.filter((mark) => mark.standing === "no-def").map((mark) => mark.key),
  );
  return placements
    .filter(
      (placement) =>
        placement.kind === "base" &&
        placement.id === baseId &&
        absent.has(placement.key),
    )
    .map((placement) => ({ index: placement.index, def: placement.def }));
}

/**
 * Which of one base's buildings nothing has judged, grouped by why (issue
 * #1491).
 *
 * Grouped rather than listed, because the reasons are different problems with
 * different fixes and "unknown" on its own is nothing anybody can act on. Two
 * of the three are true of every building at once, so a panel says them about
 * the layout rather than naming buildings. The third is per building.
 */
export interface Unjudged {
  /** No ground to ask about: the map's heights would not read. */
  noGround: number[];
  /** The game's units have not been read. */
  noUnits: number[];
  /** This game's entry for the def says nothing about slope. */
  noSlope: number[];
}

export function unjudgedIn(
  placements: Placement[],
  marks: FootprintMark[],
  baseId: string,
): Unjudged {
  const why = new Map(marks.map((mark) => [mark.key, mark.standing]));
  const out: Unjudged = { noGround: [], noUnits: [], noSlope: [] };
  for (const placement of placements) {
    if (placement.kind !== "base" || placement.id !== baseId) continue;
    const standing = why.get(placement.key);
    if (standing === "no-ground") out.noGround.push(placement.index);
    if (standing === "no-units") out.noUnits.push(placement.index);
    if (standing === "no-slope") out.noSlope.push(placement.index);
  }
  return out;
}

/** Which of one base's buildings the ground will not take, by their place in
 *  the base, so a panel can name them the way it names the overlapping ones. */
export function unstableIn(
  placements: Placement[],
  marks: FootprintMark[],
  baseId: string,
): number[] {
  const refused = new Set(
    marks.filter((mark) => mark.standing === "slope").map((mark) => mark.key),
  );
  return placements
    .filter(
      (placement) =>
        placement.kind === "base" &&
        placement.id === baseId &&
        refused.has(placement.key),
    )
    .map((placement) => placement.index);
}

/** Which of one base's buildings want ground another building is standing on,
 *  by their place in the base, so a panel can name them. */
export function overlappingIn(
  placements: Placement[],
  marks: FootprintMark[],
  baseId: string,
): number[] {
  const fighting = new Set(
    marks.filter((mark) => mark.overlapping).map((mark) => mark.key),
  );
  return placements
    .filter(
      (placement) =>
        placement.kind === "base" &&
        placement.id === baseId &&
        fighting.has(placement.key),
    )
    .map((placement) => placement.index);
}

/**
 * The engine facing as a rotation about the scene's up axis, in radians.
 *
 * A unit model is built with its front along +z, and the engine's facing 0 is
 * south, which is also +z, so facing 0 is no rotation at all. Each step turns a
 * quarter turn the way three.js rotates +z toward +x, which is east, the
 * engine's facing 1.
 */
export function facingToYaw(facing: Facing): number {
  return (facing * Math.PI) / 2;
}

/** What a unit belonging to nobody is drawn in: a neutral grey. */
export const UNOWNED_COLOR: Rgb = [0.62, 0.65, 0.7];

/**
 * The colour a team's units are drawn in, as the launcher's 0..1 float RGB.
 *
 * Taken straight off the participant, which is the same value the launcher
 * writes into the start script, so what is drawn is what will be played. A team
 * id that no longer names a participant, which a document keeps after its setup
 * is changed, falls back to grey rather than disappearing.
 */
export function teamColor(participants: Participant[], team: string): Rgb {
  return participants.find((p) => p.id === team)?.color ?? UNOWNED_COLOR;
}

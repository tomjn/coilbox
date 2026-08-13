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

import {
  buildingFootprints,
  type FootprintMark,
  footprintMarks,
} from "@/blueprint/footprint";
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

/**
 * The ground every building in the document stands on, and which of them are
 * fighting over it.
 *
 * Only a base's buildings: an actor or a group's units are mobile, they are not
 * put through the engine's build grid, and two of them standing on the same spot
 * walk apart the moment the game starts. A building that cannot be built is a
 * different thing entirely, which is why only these are checked.
 */
export function baseFootprints(
  placements: Placement[],
  units: { name: string; footprintX?: number; footprintZ?: number }[],
): FootprintMark[] {
  return footprintMarks(
    placements.filter((placement) => placement.kind === "base"),
    buildingFootprints(units),
  );
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

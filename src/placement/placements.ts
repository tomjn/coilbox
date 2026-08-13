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

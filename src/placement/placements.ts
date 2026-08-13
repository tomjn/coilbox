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

import { type Ground, standsOn, unitLimits } from "@/blueprint/buildable";
import {
  buildingFootprints,
  type FootprintMark,
  footprintMarks,
  type Standing,
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
 *  stands on, how steep that ground may be, and how much water may be over
 *  it. */
export type BuildingUnit = {
  name: string;
  footprintX?: number;
  footprintZ?: number;
  maxSlope?: number;
  floatOnWater?: boolean;
  minWaterDepth?: number;
  maxWaterDepth?: number;
  waterline?: number;
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
   *  standing in for one not read yet, as {@link unitLimits} takes it. */
  checked = units.length > 0,
): FootprintMark[] {
  const limitsOf = unitLimits(units, checked);
  return footprintMarks(
    placements.filter((placement) => placement.kind === "base"),
    buildingFootprints(units),
    (mark) => standsOn(mark, ground, limitsOf(mark.def)),
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
 * Why nothing on the surface has a verdict, when nothing has (issue #1496).
 *
 * The two whole-scene reasons, as a fact about the surface rather than about one
 * base. `null` once anything on it has been checked, because from then on the
 * dashed squares mean something: they stand next to plain ones, and the
 * difference between them is the news.
 */
export type SceneUnchecked = "no-units" | "no-ground" | null;

/**
 * Which of those two is true of everything drawn, or null.
 *
 * Nothing has been checked when no building came back `"fine"`, `"slope"`,
 * `"too-deep"` or `"too-shallow"`, which are the only answers the ground gives. A building with its
 * own answer, a floater or a def this game has not got, is looked past rather
 * than counted: it has not been checked against the ground either, but it is
 * not waiting on anything and it is already marked as what it is.
 *
 * The read still in flight wins where both are true, because it is the one that
 * will clear itself and the one an author must not act on.
 */
export function sceneUnchecked(marks: FootprintMark[]): SceneUnchecked {
  let reason: SceneUnchecked = null;
  for (const mark of marks) {
    if (
      mark.standing === "fine" ||
      mark.standing === "slope" ||
      mark.standing === "too-deep" ||
      mark.standing === "too-shallow"
    ) {
      return null;
    }
    if (mark.standing === "no-units") reason = "no-units";
    else if (mark.standing === "no-ground" && reason === null) {
      reason = "no-ground";
    }
  }
  return reason;
}

/**
 * The map's own floor, when the depth refusals on this surface are the map
 * having no sea at all (issue #1536).
 *
 * A layout of naval buildings on a landlocked map is refused wherever it is put,
 * so twenty cyan squares and twenty sentences say one thing twenty times, and
 * none of them says the thing an author can act on: the layout is on the wrong
 * map rather than in the wrong place.
 *
 * The map's own floor answers it. Where the lowest ground on the map is at or
 * above the water's surface there is no water anywhere on it, and the engine's
 * depth test refuses every building that wants some. That is one fact about the
 * surface, said once by whoever draws it, in place of the per base sentence.
 *
 * The floor rather than a yes, because the sentence names it, and null rather
 * than a no. A floor of exactly 0 is a map with no water on it like any other.
 *
 * Null until something has actually been refused for want of water. A landlocked
 * map with a land layout on it is simply a map, and a note appearing with no
 * mark under it is a note nobody can tie to anything. A building with too much
 * water over it is not asking for water this map has not got, so it is not this
 * note's business either (issue #1552).
 *
 * Null for the build grid too, which declares no water because its floor sits at
 * 0 and is not a sea. Nothing there is refused for depth, so nothing there needs
 * explaining.
 */
export function sceneWaterless(
  marks: FootprintMark[],
  ground: Ground | null,
): number | null {
  if (!ground?.hasWater || ground.minHeight < 0) return null;
  return marks.some((mark) => mark.standing === "too-shallow")
    ? ground.minHeight
    : null;
}

/** Which of one base's buildings got one particular verdict, by their place in
 *  the base, so a panel can name them the way it names the overlapping ones. */
function standingIn(
  placements: Placement[],
  marks: FootprintMark[],
  baseId: string,
  standing: Standing,
): number[] {
  const refused = new Set(
    marks.filter((mark) => mark.standing === standing).map((mark) => mark.key),
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

/**
 * Which of one base's buildings this game gives no slope to check against, so
 * nothing can say whether the ground will take them (issues #1491, #1529).
 *
 * The one reason a building has no verdict that is about that building. The
 * other two, a map whose heights would not read and a game whose units have not
 * been read, are true of everything drawn at once, and are said about the
 * surface by {@link sceneUnchecked} rather than named building by building.
 */
export function noSlopeIn(
  placements: Placement[],
  marks: FootprintMark[],
  baseId: string,
): number[] {
  return standingIn(placements, marks, baseId, "no-slope");
}

/** Which of one base's buildings stand on ground too steep for them. */
export function unstableIn(
  placements: Placement[],
  marks: FootprintMark[],
  baseId: string,
): number[] {
  return standingIn(placements, marks, baseId, "slope");
}

/**
 * Which of one base's buildings have more water over them than they allow: a
 * land building in the sea (issues #1459, #1552).
 *
 * Apart from {@link tooShallowIn} because the two are opposite problems with
 * opposite fixes. One list for both said the same thing about a shipyard on the
 * shore and one over a trench, and moving either of them the way that sentence
 * suggested would make it worse.
 */
export function tooDeepIn(
  placements: Placement[],
  marks: FootprintMark[],
  baseId: string,
): number[] {
  return standingIn(placements, marks, baseId, "too-deep");
}

/** Which of one base's buildings want more water than there is under them: a
 *  naval building out of the sea, or in a shallows (issues #1459, #1552). */
export function tooShallowIn(
  placements: Placement[],
  marks: FootprintMark[],
  baseId: string,
): number[] {
  return standingIn(placements, marks, baseId, "too-shallow");
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

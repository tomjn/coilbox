/**
 * Standing a layout on a real map to see what the terrain would refuse (issue
 * #1457).
 *
 * The terrain check is the engine's own rule and it already exists: `standsOn`
 * in `@/blueprint/buildable`, over a layout, a map's ground and an origin. The
 * scenario editor runs it because a base there is already on a map. A blueprint
 * in the library is not on one, by design (issue #1416): it is a shape rather
 * than a place, it is not made for one map, and map reading is the slowest thing
 * in coilbox.
 *
 * So this is the opt-in half. A map is chosen, a spot on it is chosen, and the
 * same check answers the same question about that pair. Nothing here is loaded
 * until somebody asks for it, and the editor next to it still needs no map.
 *
 * Arithmetic on plain values, so all of it is tested. The surface is
 * `BlueprintOnMap.tsx`.
 */

import type { Footprint, FootprintMark, Standing } from "@/blueprint/footprint";
import type { BlueprintBuilding } from "@/blueprint/model";
import type { Point } from "@/scenario/model";
import { clampToMap } from "./pointer";
import {
  type NudgeOffer,
  nudgeToFit,
  type PreviewBuilding,
  previewCount,
  previewMovable,
} from "./preview";

/**
 * Which map to offer first, or `""` for none.
 *
 * A layout records the map it was drawn on, and that is the obvious default: it
 * is the terrain the shape was made to fit, and the one an author is most likely
 * to want to see it on again.
 *
 * Only when the machine actually has it. A layout from somebody else names maps
 * this one may never have had, and reading a map that is not installed is the
 * slowest possible way to find that out. An empty list is the scan still
 * running rather than a machine with no maps on it, and either way nothing is
 * chosen: the first thing an author sees must not be a map being read that they
 * did not pick.
 */
export function checkMapFor(
  designedFor: string | undefined,
  installed: readonly { name: string }[],
): string {
  if (!designedFor) return "";
  return installed.some((map) => map.name === designedFor) ? designedFor : "";
}

/**
 * Where the layout stands, which is the middle of the map until somebody moves
 * it.
 *
 * The middle because it is the one spot every map has, and because a layout
 * arriving in a corner reads as a mistake. Held on the map, because a drag
 * carries the layout by whatever the pointer did: the engine clamps anything
 * standing past an edge back onto it, so a spot off the map is a verdict about
 * ground the layout would not be on.
 */
export function checkSpot(
  spot: Point | null,
  worldWidth: number,
  worldHeight: number,
): Point {
  const at = spot ?? { x: worldWidth / 2, z: worldHeight / 2 };
  return clampToMap(at, worldWidth, worldHeight);
}

/** Where the layout is standing, in the map's own coordinates, so a spot worth
 *  keeping can be written down and typed into a mission. */
export function spotSentence(spot: Point): string {
  return `Standing at ${Math.round(spot.x)}, ${Math.round(spot.z)}.`;
}

/**
 * Every building of the layout as it would stand with the layout at `at`.
 *
 * A layout is a shape said from its own middle, so a spot and the offsets are
 * the whole of where its buildings go. The same arithmetic the document does
 * when the spot is written, which is what lets a drag draw the base it is about
 * to land (issue #1558) and a search ask about the base as it stands.
 *
 * Nothing here snaps: `footprintMarks` puts every building on the engine's grid
 * afterwards, and it is the only thing that should, because it is what the
 * document itself is drawn through.
 */
export function spotLayout(
  buildings: readonly BlueprintBuilding[],
  at: Point,
): PreviewBuilding[] {
  return buildings.map((building) => ({
    def: building.def,
    facing: building.facing,
    pos: { x: at.x + building.offset.x, z: at.z + building.offset.z },
  }));
}

/**
 * Where on this map the whole layout would stand, when where it is standing
 * will not do (issue #1559).
 *
 * The check says which buildings the terrain refuses. It does not say where on
 * that map the whole thing would stand, and this is the surface an author is
 * hunting for a spot on rather than drawing a shape on, so it is the surface
 * the offer is worth most on.
 *
 * The search is {@link nudgeToFit}, which is the one the scenario editor
 * already offers under a key press, asked about the layout as it stands rather
 * than about one under a pointer. It is an offer and never a rule: a ruined
 * base half in a cliff is a real thing an author might mean, so nothing moves
 * until somebody asks.
 *
 * Nothing to offer unless something is wrong that a different spot could put
 * right. A layout the ground takes is the answer the author came for, and a
 * unit this game has not got is refused wherever it goes.
 *
 * Nothing stands on this map but the layout itself, so the search has no
 * occupied ground to keep off: what it is avoiding is the terrain, and the
 * layout's own buildings avoiding each other.
 */
export function spotNudge(
  layout: readonly PreviewBuilding[],
  /** The marks the surface is drawing for the layout where it stands. */
  marks: readonly FootprintMark[],
  footprintOf: (def: string) => Footprint,
  standingOf?: (mark: Omit<FootprintMark, "standing">) => Standing,
): NudgeOffer {
  if (!previewMovable(previewCount(marks))) return null;
  const found = nudgeToFit(layout, footprintOf, [], standingOf);
  if (!found) return "nowhere";
  // Where it already is, which is no offer at all: something there is refused
  // and the search has found nothing better to say than "here".
  return found.squares.x === 0 && found.squares.z === 0 ? null : found;
}

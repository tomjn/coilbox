/**
 * Turning a whole selection as one shape (issue #2353).
 *
 * The plain turn gives every selected thing a quarter turn where it stands, so
 * six actors in a line all spin and the line stays a line. This is the other
 * meaning of the word: the selection swings about a common point, so a base
 * selected and turned comes out facing the other way with its buildings still
 * arranged around each other. Two operations rather than one with a mood, and
 * two keys, because both are worth having.
 *
 * # Why this does not creep
 *
 * Turning a building writes its facing and nothing else on purpose. Re-snapping
 * a turned building to the build grid walked it a square per full circle,
 * because the engine breaks the tie the same way at every facing (issue #1523),
 * and swinging a selection has to write a new position for every building in
 * it. That is the reason this was left unbuilt when the multi-selection landed.
 *
 * It creeps only if the new position is measured off the grid the old one
 * landed on. Nothing here measures. A quarter turn about a point is addition
 * and subtraction on whole elmos ({@link turnedAbout}), four of them are the
 * point itself again, and no result is put back on the build grid on the way
 * down: the stored position is turned, and the engine goes on deciding which
 * square that point stands on at every facing exactly as it did before. Four
 * presses of the key leave the document byte for byte where it started, which
 * is the test this file exists to pass.
 *
 * # Why the pivot is a thing rather than the middle
 *
 * The obvious pivot is the middle of the selection's bounding box, and it is
 * the one thing that cannot be used. The middle of a box of whole elmos lands
 * on a half elmo half the time, a turn about a half elmo puts every position on
 * a half elmo, and a document stores whole ones. Rounding that away is a fixed
 * nudge in one direction, and a fixed nudge is not undone by turning back: four
 * quarter turns come home two elmos from where they set off. Rounding the pivot
 * instead rather than the result moves the pivot itself, because the middle of
 * the box moves when the box turns about a point that is not its middle, so the
 * next press finds a different pivot again. Both are the creep of issue #1523
 * wearing a different hat.
 *
 * What survives a turn is a pivot the turn cannot move, which is the position
 * of one of the selected things: turn a thing about itself and it is where it
 * was. So the pivot is the selected thing nearest the middle of the selection,
 * and the selection swings about that. Nearest the middle rather than the
 * primary, because a marquee's primary is whichever unit the drawn list
 * happened to end on, and turning a base about a corner building of it flings
 * the base off its site. The choice is stable for the same reason the pivot is:
 * a turn is a rigid motion, so it changes no distance between any two things in
 * the selection, so the thing nearest the middle before the turn is the thing
 * nearest the middle after it.
 *
 * # What the grid still does
 *
 * The stored points turn exactly. Where the engine then stands each building is
 * its own question, and a building whose footprint has one odd side and one
 * even one stands on x and z grids half a build square out of step, so a pivot
 * of that shape is a point the turned positions cannot all land on. The grid
 * then does the same thing to every building in the cluster, because what it
 * does depends on the pivot rather than on the building, so the base arrives
 * whole and up to half a build square from where its stored points say. It is
 * carried, never bent, and four turns still put every building back on the
 * square it started on. Both are pinned in `rigidTurn.test.ts`.
 *
 * Arithmetic on plain values, so all of it is tested without a GPU.
 */

import type { FootprintMark } from "@/blueprint/footprint";
import type { Point, Scenario } from "../../model";
import { turnedAbout } from "./editing";
import {
  type LayoutEditFor,
  moveOnMap,
  positionOn,
  turnOnMap,
} from "./mapKeyboard";
import {
  countSelection,
  type MapSelection,
  manyBuildTrouble,
  movedKeys,
} from "./selection";
import { parseZoneKey, turnZone } from "./zones";

/** How far apart two points are, squared, which is all a comparison needs and
 *  keeps the sums exact on the whole elmos a document stores. */
function gap(from: Point, to: Point): number {
  return (from.x - to.x) ** 2 + (from.z - to.z) ** 2;
}

/**
 * The point a selection turns about: the position of the selected thing nearest
 * the middle of them all, or null when nothing selected has a position.
 *
 * Ties go to whichever was selected first, which is stable across a turn
 * because the turn changes neither the selection nor any distance in it.
 */
export function turnPivot(
  scenario: Scenario,
  selection: MapSelection,
): Point | null {
  const spots = movedKeys(selection)
    .map((key) => positionOn(scenario, key))
    .filter((pos): pos is Point => pos !== null);
  if (spots.length === 0) return null;
  const middle = {
    x:
      (Math.min(...spots.map((p) => p.x)) +
        Math.max(...spots.map((p) => p.x))) /
      2,
    z:
      (Math.min(...spots.map((p) => p.z)) +
        Math.max(...spots.map((p) => p.z))) /
      2,
  };
  return spots.reduce((best, spot) =>
    gap(spot, middle) < gap(best, middle) ? spot : best,
  );
}

/**
 * The document with everything selected swung `steps` quarter turns about the
 * selection's own pivot, as one edit.
 *
 * Everything with a position moves, and everything with a facing turns as well.
 * A group and a point on a path have a position and no facing, so they are
 * carried round without turning: a group's units all face south whatever is
 * done to them, and a point is a point. Leaving them where they were would be
 * the worse answer, because a path drawn round a base that no longer goes round
 * it points at nothing.
 *
 * One thing selected turns about itself, which is the plain turn again for
 * anything with a facing, and is how a zone gets turned at all.
 */
export function turnSelectionAround(
  scenario: Scenario,
  selection: MapSelection,
  steps: number,
  layoutEdit: LayoutEditFor,
): Scenario {
  const pivot = turnPivot(scenario, selection);
  if (!pivot) return scenario;
  return movedKeys(selection).reduce((doc, key) => {
    if (parseZoneKey(key)) return turnZone(doc, key, pivot, steps);
    const was = positionOn(doc, key);
    if (!was) return doc;
    const to = turnedAbout(was, pivot, steps);
    // No `snap`: a building's stored point is turned and written as it lands,
    // never measured off the square the engine is drawing it on, which is what
    // made a turned building creep (issue #1523).
    const moved = moveOnMap(
      doc,
      key,
      { x: to.x - was.x, z: to.z - was.z },
      undefined,
      layoutEdit,
    );
    return turnOnMap(moved, key, steps, layoutEdit);
  }, scenario);
}

/**
 * What a turn of the whole selection did.
 *
 * It says what turned and what only moved, because a rigid turn moves things
 * that have no facing and an author who cannot see the map has no other way of
 * learning that the zone went round with the base. The buildability tally comes
 * last, the same way `movedManyWords` ends (issue #2315).
 *
 * A zone counts as having turned, because a quarter turn swaps a box's width
 * and its height. What is carried round without turning is a group, whose units
 * all face south whatever is done to them, and a point on a path.
 */
export function turnedAroundWords(
  selection: MapSelection,
  marks: readonly FootprintMark[],
): string {
  const count = countSelection(selection);
  if (count.total === 0) return "Nothing selected.";
  const turns = count.actors + count.buildings + count.zones;
  const rest = count.groups + count.points;
  const trouble = manyBuildTrouble(selection, marks);
  if (turns === 0) {
    return `Swung ${count.total} round together. Neither a group nor a path point has a facing to turn.${trouble}`;
  }
  if (rest === 0) return `Turned ${count.total} round together.${trouble}`;
  const with_ = turns === 1 ? "it" : "them";
  return `Turned ${turns} of ${count.total} round together. The other ${rest} moved with ${with_} without turning.${trouble}`;
}

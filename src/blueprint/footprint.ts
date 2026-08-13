/**
 * How much ground a building stands on, and where the engine will let it stand.
 *
 * A building does not go where it is dropped. The engine puts every one of them
 * on a grid of build squares, so two of them either fit side by side or one of
 * them cannot be built at all. Without this an editor draws a layout that looks
 * fine and cannot be built, which is what issue #1311 is about.
 *
 * All of it is the engine's own arithmetic, from `CGameHelper::Pos2BuildPos` and
 * `BuildInfo::GetXSize`, and it has two details that are easy to get wrong:
 *
 * - A footprint's sides swap on an odd facing. East and west turn a building a
 *   quarter turn, so a 5 by 4 stands on 4 by 5 of the map.
 * - A footprint spanning an odd number of squares centres in the middle of a
 *   square, and one spanning an even number centres on the corner where four of
 *   them meet. That is per axis, so a 5 by 4 does both at once.
 *
 * Arithmetic on plain values with nothing three.js in it, so all of it is
 * tested. It lives with the blueprint model rather than with the scenario editor
 * because a layout's footprints are a property of the layout, wherever it is
 * being drawn.
 */

import type { Facing, Point } from "../scenario/model";

/**
 * `Game.footprintScale`: how many heightmap squares one footprint square covers
 * on a side. The engine's `SPRING_FOOTPRINT_SCALE`, because a footprint is
 * written in the coarser units the original Total Annihilation used.
 */
export const FOOTPRINT_SCALE = 2;

/** `Game.squareSize`: one heightmap square, in elmos. */
export const SQUARE_SIZE = 8;

/** One build square in elmos, which is what a footprint of 1 covers. */
export const BUILD_SQUARE = FOOTPRINT_SCALE * SQUARE_SIZE;

/** How much ground a unit stands on, in build squares. */
export interface Footprint {
  x: number;
  z: number;
}

/** What a unit that declares no footprint stands on. The engine floors a
 *  footprint at one square, so nothing ever stands on less. */
export const ONE_SQUARE: Footprint = { x: 1, z: 1 };

/** A patch of ground in elmos, as the map measures it. */
export interface Rect {
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
}

/** One footprint field as a number of squares, flooring at one the way the
 *  engine does, so a def with nothing to say still stands on ground. */
function squares(value: number | undefined): number {
  return value !== undefined && Number.isFinite(value) && value >= 1
    ? Math.floor(value)
    : 1;
}

/** What a unit dataset entry says the unit stands on. */
export function unitFootprint(
  unit: { footprintX?: number; footprintZ?: number } | undefined,
): Footprint {
  return { x: squares(unit?.footprintX), z: squares(unit?.footprintZ) };
}

/**
 * What each of a game's units declares it stands on, and nothing for a def that
 * game has not got (issue #1463).
 *
 * Case-insensitive, because a document holds whatever its author typed and the
 * dataset is lowercased. The undefined is the whole point: drawing an unknown
 * def wants a square to draw, and recording one wants the truth, and one square
 * is only the right answer to the first. Whoever records a footprint reads this,
 * whoever draws one reads {@link buildingFootprints}.
 */
export function declaredFootprints(
  units: { name: string; footprintX?: number; footprintZ?: number }[],
): (def: string) => Footprint | undefined {
  const byName = new Map<string, Footprint>();
  for (const unit of units) {
    byName.set(unit.name.toLowerCase(), unitFootprint(unit));
  }
  return (def) => byName.get(def.toLowerCase());
}

/**
 * A lookup from unit def name to footprint, for the units of one game.
 *
 * A def the game has not got stands on one square rather than nothing, so an
 * unread dataset draws squares of the right shape in the wrong size instead of
 * drawing nothing at all. That fallback is for drawing only: see
 * {@link declaredFootprints}.
 */
export function buildingFootprints(
  units: { name: string; footprintX?: number; footprintZ?: number }[],
): (def: string) => Footprint {
  const declared = declaredFootprints(units);
  return (def) => declared(def) ?? ONE_SQUARE;
}

/**
 * The footprint as it lies on the map once the building is turned.
 *
 * Facings 1 and 3 are east and west, which is the building on its side, so its
 * sides swap. This is `BuildInfo::GetXSize` and it is what makes both the snap
 * below and the ground a building covers depend on which way it points.
 */
export function facedFootprint(
  footprint: Footprint,
  facing: Facing,
): Footprint {
  return facing % 2 === 0
    ? { x: footprint.x, z: footprint.z }
    : { x: footprint.z, z: footprint.x };
}

/** One axis of `Pos2BuildPos`: an odd span centres in the middle of a build
 *  square, an even span on the corner between two of them. */
function snapAxis(value: number, span: number): number {
  return span % 2 === 1
    ? Math.floor(value / BUILD_SQUARE) * BUILD_SQUARE + SQUARE_SIZE
    : Math.floor((value + SQUARE_SIZE) / BUILD_SQUARE) * BUILD_SQUARE;
}

/**
 * Where a building put down at `pos` will actually stand.
 *
 * The engine's `Pos2BuildPos` without the ground height, which the editor takes
 * off the heightmap instead. Each axis is snapped by the side of the footprint
 * that faces it, so a rectangle turned a quarter turn snaps differently.
 */
export function snapToBuildGrid(
  pos: Point,
  footprint: Footprint,
  facing: Facing,
): Point {
  const faced = facedFootprint(footprint, facing);
  return { x: snapAxis(pos.x, faced.x), z: snapAxis(pos.z, faced.z) };
}

/** Where the engine will stand one def, dropped at a point facing a way. What
 *  an editor needs to know to put a building where it can be built. */
export type SnapBuilding = (pos: Point, def: string, facing: Facing) => Point;

/** {@link snapToBuildGrid} for the units of one game, so a caller with a def
 *  name and a point needs to know nothing about footprints. */
export function buildGridSnap(
  units: { name: string; footprintX?: number; footprintZ?: number }[],
): SnapBuilding {
  const footprintOf = buildingFootprints(units);
  return (pos, def, facing) => snapToBuildGrid(pos, footprintOf(def), facing);
}

/** The ground a building centred on `pos` stands on. */
export function footprintRect(
  pos: Point,
  footprint: Footprint,
  facing: Facing,
): Rect {
  const faced = facedFootprint(footprint, facing);
  const halfX = (faced.x * BUILD_SQUARE) / 2;
  const halfZ = (faced.z * BUILD_SQUARE) / 2;
  return {
    minX: pos.x - halfX,
    minZ: pos.z - halfZ,
    maxX: pos.x + halfX,
    maxZ: pos.z + halfZ,
  };
}

/** Whether two buildings want the same ground. Two that share an edge do not:
 *  buildings are meant to stand next to each other. */
export function rectsOverlap(a: Rect, b: Rect): boolean {
  return (
    a.minX < b.maxX && b.minX < a.maxX && a.minZ < b.maxZ && b.minZ < a.maxZ
  );
}

/**
 * What can be said about the ground under one building (issue #1315), and where
 * an absent verdict came from (issue #1491).
 *
 * Three of these are answers about the ground. The rest are reasons there is no
 * answer, and they are kept apart because they are different problems with
 * different fixes: a person can wait for a game's units to be read, and can do
 * nothing at all about a map whose heights will not read.
 *
 * One flat `"unknown"` is what let the check rot. It said the same nothing
 * whether the ground had been read or not, so a check that had been refusing
 * every map it was given for months looked exactly like a check that was
 * passing everything (issue #1483).
 *
 * Whoever answers is `./buildable.ts`, and the type lives here because it is a
 * fact about a mark.
 */
export type Standing =
  | "fine"
  /** The ground under it moves further than the def tolerates. */
  | "slope"
  /** The water over the ground under it is outside the band the def declares:
   *  a land building in the sea, or a naval yard on dry land (issue #1459). */
  | "depth"
  /** There is no ground to ask: no map, or a heightmap that would not read. */
  | "no-ground"
  /** The game's units have not been read, so nothing knows what this def is. */
  | "no-units"
  /** They have been read, and this game has not got this unit (issue #1445). */
  | "no-def"
  /** This game's entry for the def says nothing about slope. */
  | "no-slope"
  /** A floater rests on the water, so the ground under it decides nothing. */
  | "floats";

/**
 * Whether nothing has judged this building, which is not the same as its being
 * fine.
 *
 * A floater is not in here: the ground under it decides nothing, so there is no
 * answer missing. Neither is a def the game has not got, which is a definite
 * absence rather than a gap in what the check knows, and is drawn as its own
 * kind of refusal (issue #1445).
 */
export function unjudged(standing: Standing): boolean {
  return (
    standing === "no-ground" ||
    standing === "no-units" ||
    standing === "no-slope"
  );
}

/** One building as the map should draw it. */
export interface FootprintMark {
  /** Whatever the caller identifies the building by, handed straight back. */
  key: string;
  def: string;
  /** Where the engine will stand it, which is not always where it was put. */
  pos: Point;
  facing: Facing;
  /** The footprint as declared, before the facing is applied. */
  footprint: Footprint;
  /** The ground it stands on, facing and all. */
  rect: Rect;
  /** Whether some other building wants ground this one is standing on. */
  overlapping: boolean;
  /** Whether the ground itself will take it. */
  standing: Standing;
}

/**
 * Every building of a layout as the map should draw it, with the ones fighting
 * over ground marked.
 *
 * Positions are snapped first, because that is where the buildings will be: a
 * layout written by hand or imported from elsewhere can name positions the
 * engine will move, and two of those can collide after the move even though the
 * numbers in the file do not. Both buildings of a pair are marked, because
 * neither of them is the one at fault.
 *
 * `standingOf` says whether the ground will take each building, once it is known
 * where the building will stand. Left out where there is nobody to ask, and then
 * every mark says `"no-ground"`, which the map draws as a building with no
 * verdict rather than as one that is fine.
 */
export function footprintMarks(
  buildings: { key: string; def: string; pos: Point; facing: Facing }[],
  footprintOf: (def: string) => Footprint,
  standingOf?: (mark: Omit<FootprintMark, "standing">) => Standing,
): FootprintMark[] {
  const marks = buildings.map((building) => {
    const footprint = footprintOf(building.def);
    const pos = snapToBuildGrid(building.pos, footprint, building.facing);
    const mark = {
      key: building.key,
      def: building.def,
      pos,
      facing: building.facing,
      footprint,
      rect: footprintRect(pos, footprint, building.facing),
      overlapping: false,
    };
    return { ...mark, standing: standingOf?.(mark) ?? "no-ground" };
  });

  for (let i = 0; i < marks.length; i++) {
    for (let j = i + 1; j < marks.length; j++) {
      if (!rectsOverlap(marks[i].rect, marks[j].rect)) continue;
      marks[i].overlapping = true;
      marks[j].overlapping = true;
    }
  }
  return marks;
}

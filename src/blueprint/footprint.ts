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
 * A lookup from unit def name to footprint, for the units of one game.
 *
 * Case-insensitive, because a document holds whatever its author typed and the
 * dataset is lowercased. A def the game has not got stands on one square rather
 * than nothing, so an unread dataset draws squares of the right shape in the
 * wrong size instead of drawing nothing at all.
 */
export function buildingFootprints(
  units: { name: string; footprintX?: number; footprintZ?: number }[],
): (def: string) => Footprint {
  const byName = new Map<string, Footprint>();
  for (const unit of units) {
    byName.set(unit.name.toLowerCase(), unitFootprint(unit));
  }
  return (def) => byName.get(def.toLowerCase()) ?? ONE_SQUARE;
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
 */
export function footprintMarks(
  buildings: { key: string; def: string; pos: Point; facing: Facing }[],
  footprintOf: (def: string) => Footprint,
): FootprintMark[] {
  const marks = buildings.map((building) => {
    const footprint = footprintOf(building.def);
    const pos = snapToBuildGrid(building.pos, footprint, building.facing);
    return {
      key: building.key,
      def: building.def,
      pos,
      facing: building.facing,
      footprint,
      rect: footprintRect(pos, footprint, building.facing),
      overlapping: false,
    };
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

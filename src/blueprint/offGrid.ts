/**
 * Where a layout says its buildings are, against where the engine will put them
 * (issue #1427).
 *
 * The editor draws a building on the point the engine will build it on, because
 * the point of drawing a layout is seeing what will happen. The document keeps
 * whatever numbers it came with, because opening somebody's file is not a reason
 * to rewrite it. Both of those are right, and together they mean a layout
 * written by hand, or made by a tool that measures differently, is drawn up to
 * half a build square from the position it holds and nothing says so.
 *
 * This is how it gets said, and how an author asks for it to be fixed. Nothing
 * here changes a document: {@link onBuildGrid} returns the buildings it would
 * write and the caller decides whether to.
 *
 * The snapping itself is `./footprint.ts` and is not repeated here. What is here
 * is the comparison, which is the part nothing was keeping.
 */

import type { Facing, Point } from "../scenario/model";
import { type Footprint, snapToBuildGrid } from "./footprint";
import type { BlueprintBuilding } from "./model";

/** One building the build grid disagrees with, by its place in the layout. */
export interface OffGridBuilding {
  index: number;
  def: string;
  /** The offset the layout holds. */
  from: Point;
  /** The offset it would need for the engine to build it where it is drawn. */
  to: Point;
}

/** A layout drawn on its own ground rather than placed on a map. */
const NO_ORIGIN: Point = { x: 0, z: 0 };

/**
 * Which of a layout's buildings the engine will not build where the layout says.
 *
 * `origin` is the point the layout is placed at, because a building snaps by
 * where it stands rather than by how far it is from its neighbours: the same
 * layout can be on the grid at one origin and off it at another. The offsets are
 * reported rather than the map positions, because the offsets are the numbers
 * the document holds and the ones an author reads out of it.
 *
 * `footprintOf` must come from the game's units. Called with a lookup that
 * answers one square for everything, every even footprint in the layout is
 * reported as off the grid, which would accuse a layout that is fine.
 */
export function offGridBuildings(
  buildings: readonly { def: string; offset: Point; facing: Facing }[],
  footprintOf: (def: string) => Footprint,
  origin: Point = NO_ORIGIN,
): OffGridBuilding[] {
  const out: OffGridBuilding[] = [];
  buildings.forEach((building, index) => {
    const at = {
      x: origin.x + building.offset.x,
      z: origin.z + building.offset.z,
    };
    const stands = snapToBuildGrid(
      at,
      footprintOf(building.def),
      building.facing,
    );
    if (stands.x === at.x && stands.z === at.z) return;
    out.push({
      index,
      def: building.def,
      from: building.offset,
      to: { x: stands.x - origin.x, z: stands.z - origin.z },
    });
  });
  return out;
}

/**
 * The layout's buildings with every position moved to where the engine will
 * build it, or null when the grid already agrees with all of them.
 *
 * Null rather than the same list, so a caller can hand its document straight
 * back and an offer nobody needed changes nothing. Only the positions move: what
 * a building is, which way it faces and what the file called it are untouched.
 */
export function onBuildGrid(
  buildings: readonly BlueprintBuilding[],
  footprintOf: (def: string) => Footprint,
  origin: Point = NO_ORIGIN,
): BlueprintBuilding[] | null {
  const off = offGridBuildings(buildings, footprintOf, origin);
  if (off.length === 0) return null;
  const moved = new Map(off.map((one) => [one.index, one.to]));
  return buildings.map((building, index) => {
    const to = moved.get(index);
    return to ? { ...building, offset: to } : building;
  });
}

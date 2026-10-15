/**
 * A crop of the replay's map round each player's start, with that player's
 * build orders drawn on it (#1177), so openings compare as pictures of a base.
 *
 * Arithmetic on plain values, so the placing can be tested with numbers. It
 * sits on `replayMapLayers.ts`: a start and a mark are already fractions of the
 * map there, and a crop is a window on those fractions. Positions are elmos
 * from the map's north-west corner, x east and z south.
 */

import { DEFAULT_RADIUS_FRACTION } from "@/lib/heatField";
import type { BuildOrder, DemoInfo, UnitDatasetEntry } from "./bindings";
import {
  type BuildMark,
  buildMarks,
  type MapFraction,
  type MapWorld,
  type StartDot,
} from "./replayMapLayers";

/**
 * How many of the heatmap's radii a crop is wide. The heat radius is
 * `DEFAULT_RADIUS_FRACTION` of the map's shorter side, and its own comment says
 * an opening's buildings merge into one patch per base at that grain. Eight
 * radii puts a base's patch in the middle of a view with room round it for
 * what spread out. A display choice with nothing measured behind it, so every
 * crop says how many elmos across it is, and counts the orders that fell
 * outside it.
 */
export const CROP_RADII = 8;

/**
 * The side of a crop in elmos. One value for the whole match, so the bases are
 * at one scale and "who spread" is a comparison of extent. It is a fraction of
 * the map's shorter side, so a square crop fits on any map and the picture has
 * the same grain on a small map and a large one.
 */
export function cropSide(world: MapWorld): number {
  return (
    Math.min(world.worldWidth, world.worldHeight) *
    DEFAULT_RADIUS_FRACTION *
    CROP_RADII
  );
}

/** A square of the map in elmos: its north-west corner and its side. */
export interface CropWindow {
  x0: number;
  z0: number;
  side: number;
}

/**
 * The square round a start. A start near an edge keeps the scale and moves the
 * square along until it is on the map, so no crop shows ground that is not
 * there. The start is then off centre, and `cropFraction` says where.
 */
export function cropWindow(
  start: { x: number; z: number },
  world: MapWorld,
): CropWindow | null {
  const side = cropSide(world);
  if (!(side > 0)) return null;
  const keep = (at: number, size: number) =>
    Math.min(Math.max(at - side / 2, 0), size - side);
  return {
    x0: keep(start.x, world.worldWidth),
    z0: keep(start.z, world.worldHeight),
    side,
  };
}

/**
 * Where a place on the map is inside a crop: 0 to 1 from the crop's left and
 * from its top, and outside 0 to 1 when the place is outside the crop. The
 * crop is square in elmos, so on a map that is not square it is not square in
 * map fractions, and each axis has its own span.
 */
export function cropFraction(
  at: MapFraction,
  crop: CropWindow,
  world: MapWorld,
): MapFraction {
  return {
    left:
      (at.left - crop.x0 / world.worldWidth) / (crop.side / world.worldWidth),
    top:
      (at.top - crop.z0 / world.worldHeight) / (crop.side / world.worldHeight),
  };
}

const inside = (at: MapFraction) =>
  at.left >= 0 && at.left <= 1 && at.top >= 0 && at.top <= 1;

/**
 * The minimap image placed so a crop shows through a box: as percentages of
 * that box, which is square. The image is the whole map stretched to its box,
 * so it is `1 / span` times the box on each axis, and moved up and left by the
 * crop's offset.
 */
export function cropImageBox(crop: CropWindow, world: MapWorld) {
  return {
    width: (world.worldWidth / crop.side) * 100,
    height: (world.worldHeight / crop.side) * 100,
    left: -(crop.x0 / crop.side) * 100,
    top: -(crop.z0 / crop.side) * 100,
  };
}

/** One order to place a building, positioned inside a crop. */
export interface CropMark extends MapFraction {
  category: BuildMark["category"];
}

/** One player's crop, ready to draw. */
export interface BaseCrop {
  /** The engine team, which is what the page's emphasis is keyed by. */
  team: number;
  /** The side the team is on, or undefined when the setup does not say. */
  allyTeam: number | undefined;
  names: string[];
  colour: string;
  isMe: boolean;
  /** What the team opened with, or null when that is not known. */
  opening: string | null;
  window: CropWindow;
  /** Where the start is inside the crop. */
  start: MapFraction;
  marks: CropMark[];
  /** Orders to place a building given by this team in the time window. */
  ordered: number;
  /** Of those, how many are not in the crop, including ones off the map. */
  outside: number;
}

/** The side each engine team is on. */
function allyTeams(info: DemoInfo): Map<number, number> {
  const out = new Map<number, number>();
  for (const seat of [...info.players, ...info.ais])
    if (seat.team !== undefined && seat.allyTeam !== undefined)
      out.set(seat.team, seat.allyTeam);
  return out;
}

/**
 * A crop for each start, in order of side and then team, so allies sit
 * together. `orders` are the ones inside the time window, and a crop shows the
 * ones its team gave. These are orders, not buildings: one that was cancelled
 * or never carried out is a mark like any other.
 */
export function baseCrops(
  dots: readonly StartDot[],
  orders: readonly BuildOrder[],
  world: MapWorld,
  units: UnitDatasetEntry[] | null,
  info: DemoInfo,
): BaseCrop[] {
  const sides = allyTeams(info);
  const byTeam = new Map<number, BuildOrder[]>();
  for (const order of orders) {
    if (order.team === undefined) continue;
    const held = byTeam.get(order.team);
    if (held) held.push(order);
    else byTeam.set(order.team, [order]);
  }
  const crops: BaseCrop[] = [];
  for (const dot of dots) {
    const window = cropWindow(dot, world);
    if (!window) continue;
    const own = buildMarks(byTeam.get(dot.team) ?? [], world, units);
    const marks: CropMark[] = [];
    let outside = own.offMap;
    for (const mark of own.marks) {
      const at = cropFraction(mark, window, world);
      if (inside(at)) marks.push({ ...at, category: mark.category });
      else outside++;
    }
    crops.push({
      team: dot.team,
      allyTeam: sides.get(dot.team),
      names: dot.names,
      colour: dot.colour,
      isMe: dot.isMe,
      opening: dot.opening,
      window,
      start: cropFraction(dot, window, world),
      marks,
      ordered: own.marks.length + own.offMap,
      outside,
    });
  }
  return crops.sort(
    (a, b) =>
      (a.allyTeam ?? Number.MAX_SAFE_INTEGER) -
        (b.allyTeam ?? Number.MAX_SAFE_INTEGER) || a.team - b.team,
  );
}

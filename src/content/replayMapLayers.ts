/**
 * What the replay page's map draws on top of the map itself (#1152): where
 * each player really started, where buildings were ordered, and how thickly.
 *
 * Arithmetic on plain values, so the placing can be tested with numbers. A
 * mirrored or offset layer looks as plausible as a right one, and
 * `replayMapLayers.test.ts` holds a real start position inside its start box.
 *
 * Every position is in engine world units (elmos) from the map's north-west
 * corner, x east and z south, as the replay records them. The 2D map is the
 * minimap picture stretched over its box, so a position is drawn at its
 * fraction of the map's size: x over the width from the left, z over the
 * height from the top. Start boxes are stored as the same fractions.
 */

import type { HeatPoints } from "@/lib/heatField";
import type {
  BuildOrder,
  DemoInfo,
  DemoTrailer,
  UnitDatasetEntry,
} from "./bindings";
import {
  allySeries,
  autoColorMode,
  type ChartColorMode,
  colorSeries,
  hasStatistics,
  seatsByTeam,
  seriesTeams,
  teamSeries,
} from "./matchStats";
import { resolveBuildUnit } from "./replayBuildOrders";
import { collapseOrders } from "./replayOpening";
import { classifyUnit, type UnitCategory } from "./unitCategory";

export interface MapWorld {
  worldWidth: number;
  worldHeight: number;
}

/** A place on the 2D map: 0 to 1 from the left and from the top. */
export interface MapFraction {
  left: number;
  top: number;
}

/**
 * Where a world position is on the 2D map, or null when it is off the map or
 * the map has no size. Off the map is dropped and not clamped: a mark pushed
 * to the border would claim something happened there.
 */
export function mapFraction(
  pos: { x: number; z: number },
  world: MapWorld,
): MapFraction | null {
  if (!(world.worldWidth > 0) || !(world.worldHeight > 0)) return null;
  const left = pos.x / world.worldWidth;
  const top = pos.z / world.worldHeight;
  if (!(left >= 0 && left <= 1 && top >= 0 && top <= 1)) return null;
  return { left, top };
}

/** The colour a team is drawn in when nothing says otherwise. */
export const NEUTRAL_TEAM_COLOUR = "rgb(148, 163, 184)";

/**
 * Each engine team's colour on the map, which is the colour of its line on the
 * match chart.
 *
 * With a trailer that has statistics this is `colorSeries`, the one place a
 * chart line gets its colour, asked the way the chart asks it. Without one
 * there is no chart, and a team takes the roster's swatch for its first seat,
 * which `swatch` is. No colours are chosen here.
 */
export function teamColours(
  info: DemoInfo,
  trailer: DemoTrailer | null,
  stored: ChartColorMode | null,
  theme: "dark" | "light",
  swatch: (rgb?: [number, number, number]) => string | undefined,
): Map<number, string> {
  const colours = new Map<number, string>();
  for (const [team, seats] of seatsByTeam(info))
    colours.set(team, swatch(seats[0]?.rgbColor) ?? NEUTRAL_TEAM_COLOUR);
  if (trailer && hasStatistics(trailer)) {
    const players = teamSeries(trailer, info);
    const sides = allySeries(trailer, info);
    const mode = stored ?? autoColorMode(players, sides, info, theme);
    for (const line of colorSeries(players, trailer, info, mode, theme)) {
      const [team] = seriesTeams(line, info);
      if (team !== undefined) colours.set(team, line.color);
    }
  }
  return colours;
}

/** One team's real start position, ready to draw. */
export interface StartDot extends MapFraction {
  /** The engine team, which is what the page's emphasis is keyed by. */
  team: number;
  x: number;
  z: number;
  /** Who controls the team: a player, several sharing it, or an AI. */
  names: string[];
  colour: string;
  /** Whether this is the library's own player. */
  isMe: boolean;
  /** What the team ordered first, or null when that is not known. */
  opening: string | null;
}

/**
 * The start positions a replay recorded, as dots.
 *
 * A team with no recorded position has no dot, since 0,0,0 is a real corner
 * and not a missing value. A position off the map has none either.
 */
export function startDots(
  info: DemoInfo,
  world: MapWorld,
  colours: ReadonlyMap<number, string>,
  meTeam: number | undefined,
  openings: ReadonlyMap<number, string>,
): StartDot[] {
  const seats = seatsByTeam(info);
  const dots: StartDot[] = [];
  for (const start of info.startPositions ?? []) {
    const at = mapFraction(start, world);
    if (!at) continue;
    dots.push({
      ...at,
      team: start.team,
      x: start.x,
      z: start.z,
      names: (seats.get(start.team) ?? []).map((seat) => seat.name),
      colour: colours.get(start.team) ?? NEUTRAL_TEAM_COLOUR,
      isMe: meTeam !== undefined && start.team === meTeam,
      opening: openings.get(start.team) ?? null,
    });
  }
  return dots;
}

/** What a dot is called: the names on the team, or a plain word for a team
 *  the setup does not describe. */
export function startDotName(dot: Pick<StartDot, "names">): string {
  return dot.names.length > 0 ? dot.names.join(", ") : "Unnamed player";
}

/**
 * What each team ordered first, by team: the first entry of its folded
 * opening, named. Empty without the game's units, because the replay holds
 * only a unit definition id.
 */
export function openingsByTeam(
  orders: readonly BuildOrder[],
  units: UnitDatasetEntry[] | null,
): Map<number, string> {
  const out = new Map<number, string>();
  if (!units) return out;
  const byTeam = new Map<number, BuildOrder[]>();
  for (const order of orders) {
    if (order.team === undefined) continue;
    const held = byTeam.get(order.team);
    if (held) held.push(order);
    else byTeam.set(order.team, [order]);
  }
  for (const [team, own] of byTeam) {
    const first = collapseOrders(own)[0];
    const unit = first ? resolveBuildUnit(first.unitDefId, units) : undefined;
    if (!first || !unit) continue;
    const name = unit.fullName || unit.name;
    out.set(team, first.count > 1 ? `${name} ×${first.count}` : name);
  }
  return out;
}

/** One order to place a building, ready to draw. */
export interface BuildMark extends MapFraction {
  team: number | undefined;
  /** What the building is for, or null when no installed game can say. */
  category: UnitCategory | null;
}

export interface BuildMarks {
  marks: BuildMark[];
  /** Orders with a position that is off the map, which are not drawn. */
  offMap: number;
  /** Factory queue orders, which have no position to draw. */
  unplaced: number;
}

/**
 * The placed buildings among a replay's build orders, as marks.
 *
 * These are orders, not buildings: one that was cancelled or never carried out
 * is a mark like any other, and a re-issued order is two marks on one spot.
 */
export function buildMarks(
  orders: readonly BuildOrder[],
  world: MapWorld,
  units: UnitDatasetEntry[] | null,
): BuildMarks {
  const marks: BuildMark[] = [];
  let offMap = 0;
  let unplaced = 0;
  for (const order of orders) {
    if (!order.position) {
      unplaced++;
      continue;
    }
    const at = mapFraction(order.position, world);
    if (!at) {
      offMap++;
      continue;
    }
    const unit = resolveBuildUnit(order.unitDefId, units);
    marks.push({
      ...at,
      team: order.team,
      category: units ? (unit ? classifyUnit(unit) : "unclassified") : null,
    });
  }
  return { marks, offMap, unplaced };
}

/** Where buildings were ordered, as points for a density field. */
export function buildingHeatPoints(orders: readonly BuildOrder[]): HeatPoints {
  const placed = orders.filter((order) => order.position);
  const positions = new Float32Array(placed.length * 2);
  placed.forEach((order, i) => {
    positions[i * 2] = order.position?.x ?? 0;
    positions[i * 2 + 1] = order.position?.z ?? 0;
  });
  return { positions };
}

/** The shapes a mark can be. Each is a path in a box from -1 to 1. */
export const MARK_SHAPES = {
  circle: "M1,0A1,1 0 1,1 -1,0A1,1 0 1,1 1,0Z",
  square: "M-0.85,-0.85H0.85V0.85H-0.85Z",
  triangle: "M0,-1.05L1,0.8H-1Z",
  triangleDown: "M0,1.05L1,-0.8H-1Z",
  diamond: "M0,-1.15L1.15,0L0,1.15L-1.15,0Z",
  plus: "M-0.38,-1H0.38V-0.38H1V0.38H0.38V1H-0.38V0.38H-1V-0.38H-0.38Z",
  ring: "M1,0A1,1 0 1,1 -1,0A1,1 0 1,1 1,0ZM0.45,0A0.45,0.45 0 1,0 -0.45,0A0.45,0.45 0 1,0 0.45,0Z",
  dot: "M0.6,0A0.6,0.6 0 1,1 -0.6,0A0.6,0.6 0 1,1 0.6,0Z",
} as const;

export type MarkShape = keyof typeof MARK_SHAPES;

/** The shape each kind of building is drawn as. Identity is the colour, and
 *  the shape is what the building is for. */
export const CATEGORY_SHAPE: Record<UnitCategory, MarkShape> = {
  economy: "circle",
  defence: "square",
  offence: "triangle",
  factory: "diamond",
  builder: "plus",
  intelligence: "ring",
  transport: "triangleDown",
  unclassified: "dot",
};

/** The one shape every mark takes when no installed game can say what a
 *  building is for. */
export const NEUTRAL_SHAPE: MarkShape = "dot";

export const CATEGORY_LABEL: Record<UnitCategory, string> = {
  economy: "Economy",
  defence: "Defence",
  offence: "Offence",
  factory: "Factory",
  builder: "Builder",
  intelligence: "Intelligence",
  transport: "Transport",
  unclassified: "Unclassified",
};

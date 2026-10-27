/**
 * The ground a blueprint's terrain steps leave behind, by Zero-K's own rules
 * (issue #4791).
 *
 * Zero-K never makes a vertical cliff. Its terraform gadget,
 * `LuaRules/Gadgets/unit_terraform.lua` in ZeroK-RTS/Zero-K, adds a slope round
 * anything it raises or digs, so a step covers more ground than the outline the
 * author drew. The editor, the on-map preview, the widget and the mission
 * runtime all need the same answer, so this is the one place it is worked out.
 * Line numbers in the comments are that file's.
 *
 * Named `terraform` rather than `terrain` because `../placement/terrain.ts`
 * already holds the height grid and `./terrainSteps.ts` the step geometry, and
 * terraform is the gadget's own word for what this models.
 *
 * What the model is, and where it parts from a live match:
 *
 * - Every step is ordered when the blueprint is placed, before anything is built.
 *   So a step's target heights and its metal estimate come from the ground as it
 *   was then (lines 1209, 1305-1340, 1657). Its slope is worked out against the
 *   ground as the steps before it left it, because the gadget reads the ground
 *   again when building starts (line 2419). That is also why two raises on the
 *   same spot do not add up: the second aims at the original ground plus its own
 *   height.
 * - Steps are built one at a time in the blueprint's order. A step stops at the
 *   buildings that come before it in that order, and only those, because a
 *   building only blocks terraform once it exists (lines 3582-3622).
 * - Each step is built as if it finished in one update, which is what the
 *   gadget's forced completion does (lines 3142, 3167). In a live match the slope
 *   grows with progress, and a slope that reaches a building freezes at the
 *   height it had then (lines 2857-2865). How far it had got depends on build
 *   power and the gadget's update period, which a blueprint cannot know. So next
 *   to a building the real ground can be steeper than modelled here. Away from
 *   buildings the finished ground is the same either way.
 * - The gadget splits a big step into blocks of 200 elmos or 14 wall points,
 *   each its own terraunit. The metal estimate follows those blocks, because each
 *   one pays a base cost and a perimeter. The shape treats the step as one piece:
 *   once every block has finished, each point is at its target either way. The
 *   check that drops points too thin to hold (lines 2324-2407) also looks at the
 *   whole step rather than one block.
 * - A closed ring of wall is modelled as its sides, one order each (see
 *   `ringSides`), and an open wall longer than 224 elmos as one order for each
 *   block of that length (see `wallPieces`), because that is how the widget
 *   orders them. The corners the parts share are charged once for each part, as
 *   Zero-K does.
 * - A level or ramp is ordered with the gadget's volume selection its `only`
 *   names: both ways when it has none, raise or lower otherwise (lines
 *   523-535). Raise and smooth steps are always ordered with 0.
 * - A building's own levelling of the ground under it is the engine's, not the
 *   gadget's, and is not modelled. Nor is a map's own terraform veto
 *   (`GG.map_AllowPositionTerraform`), or the cap of 7000 slope points per block
 *   (line 2916).
 */

import type { HeightGrid } from "@/placement/terrain";
import type { Point } from "../scenario/model";
import type { Rect } from "./footprint";
import type { TerrainStep } from "./model";
import { flippedStep, turnedStep } from "./terrainSteps";

/** `maxHeightDifference`, line 111: how far a raised slope drops across one 8
 *  elmo square. */
const MAX_HEIGHT_DIFFERENCE = 28;
/** `maxHeightDiffDownInner`, line 112: the first square round a dug point. */
const MAX_HEIGHT_DIFF_DOWN_INNER = 8;
/** `maxEdgeHeightDiff`, line 113: the lip at the foot of a slope. */
const MAX_EDGE_HEIGHT_DIFF = 4;
/** `maxRampGradient`, line 114. */
const MAX_RAMP_GRADIENT = 5;

/** Lines 102-109 and 138-141: the gadget refuses a step bigger or smaller than
 *  these. */
const MAX_AREA_SIZE = 2000;
const AREA_SEG_MAX_SIZE = 200;
const MAX_WALL_POINTS = 700;
const WALL_SEGMENT_LENGTH = 14;
const MAX_RAMP_WIDTH = 200;
const MAX_RAMP_LENGTH = 200;
const MAX_TOTAL_RAMP_LENGTH = 3000;
const MAX_TOTAL_RAMP_WIDTH = 800;
const MIN_TOTAL_RAMP_LENGTH = 64;
const MIN_TOTAL_RAMP_WIDTH = 48;

/** Line 99: the most points one order can carry, which for a step is its own
 *  `points`. */
const MAX_COMMAND_POINTS = 2500;

/** Lines 116-133: the cost constants, before the mod option scales them. */
const VOLUME_COST = 0.0128;
const POINT_EXTRA_AREA_COST = 0;
const POINT_EXTRA_AREA_COST_DEPTH = 14;
const POINT_EXTRA_PERIMETER_COST = 0.15;
const POINT_EXTRA_PERIMETER_COST_DEPTH = 10;
const BASE_TERRAUNIT_COST = 6;
const INBUILT_COST_MULT = 0.5;
const PERIMETER_EDGE_COST = [0, 1, 1.4, 1, 1];

const SQUARE = 8;

/** The ground in elmos, one height per corner of the engine's 8 elmo grid. */
export interface GroundHeights {
  /** `(mapx+1)` by `(mapy+1)`, as {@link HeightGrid}. */
  width: number;
  height: number;
  /** Row-major, row 0 at the map's north, in elmos. */
  heights: Float32Array;
  /**
   * For a block cut out of a larger map: the map's corner this block's first
   * corner is. Positions stay in the map's own elmos, so a result does not
   * differ from the whole map's by a rounding of the sums, and a read or write
   * outside the block is clamped or dropped as one outside the map is. 0, 0 if
   * absent.
   */
  col?: number;
  row?: number;
}

/** Where a layout stands, the way the widget's `place.lua` takes it: turned
 *  `quarters` quarter turns and flipped about `origin`, then moved so `origin`
 *  lands on `at`. */
export interface LayoutPlacement {
  /** Map elmos. Level and ramp heights are measured from the ground here. */
  at: Point;
  /** The point in the layout's own offsets that lands on `at`. 0, 0 if absent. */
  origin?: Point;
  quarters: number;
  flip?: { x?: boolean; z?: boolean };
}

/**
 * What became of one step.
 *
 * - `built`: the ground took it.
 * - `refused`: the gadget turns the order down for its size (lines 679-685,
 *   1140-1143, 1540-1543), so nothing changes and nothing is spent.
 * - `cancelled`: a raised slope and a dug one from the same step met on one
 *   point, which makes the gadget destroy the terraform (lines 2697-2702 and
 *   2832-2837). Modelled as no change, which is what forced completion leaves.
 */
export type StepOutcome = "built" | "refused" | "cancelled";

export interface StepResult {
  /** The step's index in the layout's `terrain`. */
  index: number;
  outcome: StepOutcome;
  /** The game's own estimate, as a terraunit's tooltip shows it when ordered. */
  metal: number;
  /** Corners inside the step that took its target height, in map elmos. */
  shape: Point[];
  /** Corners outside it the slope changed, in map elmos. */
  slope: Point[];
}

export interface TerraformResult {
  ground: GroundHeights;
  /** Every step's estimate added up. */
  metal: number;
  /** In build order, which is `before` order. */
  steps: StepResult[];
}

export interface TerraformOptions {
  /** Zero-K's `terracostmult` mod option, line 159. 1 if absent. */
  costMult?: number;
}

/** The grid in elmos, by `CSMFMapFile::ReadHeightmap`'s arithmetic, which is
 *  `cornerGround`'s in `../placement/terrain.ts`. */
export function groundFromGrid(
  grid: HeightGrid,
  minHeight: number,
  maxHeight: number,
): GroundHeights {
  const step = (maxHeight - minHeight) / 65536;
  const heights = new Float32Array(grid.words.length);
  for (let i = 0; i < heights.length; i++) {
    heights[i] = grid.words[i] * step + minHeight;
  }
  return { width: grid.width, height: grid.height, heights };
}

/**
 * Ground back into the 16 bit words the drawing and the building check read.
 *
 * A raised wall can stand above the map's old highest point, so the range comes
 * from the ground itself. It is stretched by one word so the highest corner
 * still reads back as itself, since a word only reaches 65535 / 65536 of the
 * range. Each corner is then within half a word of its height.
 */
export function gridFromGround(ground: GroundHeights): {
  grid: HeightGrid;
  minHeight: number;
  maxHeight: number;
} {
  let low = Number.POSITIVE_INFINITY;
  let high = Number.NEGATIVE_INFINITY;
  for (const h of ground.heights) {
    if (h < low) low = h;
    if (h > high) high = h;
  }
  if (ground.heights.length === 0) low = high = 0;
  const maxHeight = low + ((high - low) * 65536) / 65535;
  const step = (maxHeight - low) / 65536;
  const words = new Uint16Array(ground.heights.length);
  if (step > 0) {
    for (let i = 0; i < words.length; i++) {
      words[i] = Math.min(
        65535,
        Math.max(0, Math.round((ground.heights[i] - low) / step)),
      );
    }
  }
  const grid = { width: ground.width, height: ground.height } as HeightGrid;
  // Not enumerable, for the reason `heightGrid` gives.
  Object.defineProperty(grid, "words", { value: words, enumerable: false });
  return { grid, minHeight: low, maxHeight };
}

/** A layout's steps where they land on the map, turned and flipped as the
 *  widget's `place.lua` `M.terrain` does. */
export function placedSteps(
  steps: readonly TerrainStep[],
  placement: LayoutPlacement,
): TerrainStep[] {
  const origin = placement.origin ?? { x: 0, z: 0 };
  const dx = placement.at.x - origin.x;
  const dz = placement.at.z - origin.z;
  return steps.map((step) => {
    const turned = turnedStep(step, origin, placement.quarters);
    const flipped = placement.flip
      ? flippedStep(turned, origin, placement.flip)
      : turned;
    return {
      ...flipped,
      points: flipped.points.map((p) => ({ x: p.x + dx, z: p.z + dz })),
    };
  });
}

/**
 * The sides of a closed ring of wall, each a wall of two points, or null when
 * the step is not a closed ring. A ring is a wall of four or more points whose
 * last point is its first, to the elmo. The widget orders a ring this way, one
 * order for each side (`ringSides` in `place.lua`), so that builders can reach
 * every side from outside, and Zero-K charges the corners the sides share once
 * for each side. `fixtures/ring-sides.json` holds cases both implementations are
 * tested against.
 */
export function ringSides(step: TerrainStep): TerrainStep[] | null {
  const { points } = step;
  if (step.shape !== "wall" || points.length < 4) return null;
  const first = points[0];
  const last = points[points.length - 1];
  if (Math.abs(first.x - last.x) >= 1 || Math.abs(first.z - last.z) >= 1) {
    return null;
  }
  const sides: TerrainStep[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    if (a.x === b.x && a.z === b.z) continue;
    sides.push({ ...step, points: [{ ...a }, { ...b }] });
  }
  return sides;
}

/** How long a block of wall Zero-K builds with one terraform unit is: 14 of
 *  its path points, 16 elmos apart. */
export const WALL_BLOCK = WALL_SEGMENT_LENGTH * 16;

const length = (a: Point, b: Point) =>
  Math.sqrt((b.x - a.x) ** 2 + (b.z - a.z) ** 2);

/**
 * The orders for an open wall longer than one block, or null when the step is
 * not one. The widget cuts such a wall into one order for each block of 224
 * elmos, measured along the wall round its corners, so that builders can work
 * along it from outside (`wallPieces` in `place.lua`). Each cut is put on the
 * 16 elmo grid, and the pieces share the point they meet at, so Zero-K charges
 * that point's corners once for each piece. A ramp is one order and a closed
 * ring is cut into sides (`ringSides`). `fixtures/wall-pieces.json` holds cases
 * both implementations are tested against.
 */
export function wallPieces(step: TerrainStep): TerrainStep[] | null {
  const { points } = step;
  if (step.shape !== "wall" || step.kind === "ramp" || points.length < 2) {
    return null;
  }
  let total = 0;
  for (let i = 0; i < points.length - 1; i++) {
    total += length(points[i], points[i + 1]);
  }
  if (total <= WALL_BLOCK) return null;
  const snap = (v: number) => Math.floor(v / 16 + 0.5) * 16;
  const pieces: Point[][] = [];
  let current: Point[] = [{ x: points[0].x, z: points[0].z }];
  let run = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    const len = length(a, b);
    let along = 0;
    while (len - along > WALL_BLOCK - run) {
      along += WALL_BLOCK - run;
      const cut = {
        x: snap(a.x + ((b.x - a.x) * along) / len),
        z: snap(a.z + ((b.z - a.z) * along) / len),
      };
      current.push(cut);
      pieces.push(current);
      current = [{ x: cut.x, z: cut.z }];
      run = 0;
    }
    run += len - along;
    current.push({ x: b.x, z: b.z });
  }
  if (current.length > 1 && run > 0) pieces.push(current);
  return pieces.map((piece) => ({ ...step, points: piece }));
}

/** One step's result from the results of its parts: the cost added up, the
 *  corners joined, and the outcome the parts share. */
function joined(index: number, parts: readonly StepResult[]): StepResult {
  if (parts.length === 1) return parts[0];
  const outcomes = new Set(parts.map((p) => p.outcome));
  return {
    index,
    outcome: outcomes.size === 1 ? parts[0].outcome : "built",
    metal: parts.reduce((total, p) => total + p.metal, 0),
    shape: parts.flatMap((p) => p.shape),
    slope: parts.flatMap((p) => p.slope),
  };
}

/**
 * The ground after a layout's steps, and what they cost.
 *
 * `footprints` are the layout's buildings where they stand on the map, by index
 * in `buildings`, so a step's `before` says which of them exist when it is
 * built. A building with no footprint blocks nothing.
 */
export function terraform(
  ground: GroundHeights,
  steps: readonly TerrainStep[],
  placement: LayoutPlacement,
  footprints: readonly (Rect | null | undefined)[],
  options: TerraformOptions = {},
): TerraformResult {
  const mult = options.costMult ?? 1;
  const original = new Reader(ground, ground.heights);
  const current = new Reader(ground, Float32Array.from(ground.heights));
  const pivot = original.bilinear(placement.at.x, placement.at.z);
  const placed = placedSteps(steps, placement);
  const order = placed
    .map((_, index) => index)
    .sort((a, b) => placed[a].before - placed[b].before || a - b);

  const blocked = new Set<number>();
  let built = 0;
  const results: StepResult[] = [];
  let metal = 0;
  for (const index of order) {
    const step = placed[index];
    for (; built < Math.min(step.before, footprints.length); built++) {
      const rect = footprints[built];
      if (rect) addStructure(blocked, rect);
    }
    // A closed ring is ordered a side at a time and a long open wall a block at
    // a time, which is how the widget sends them, so each part is modelled as an
    // order of its own. They all measure the ground as it was, so the order the
    // parts are built in does not matter.
    const parts = ringSides(step) ?? wallPieces(step) ?? [step];
    const done: StepResult[] = [];
    for (const part of parts) {
      const segments = stepSegments(part, original, pivot);
      if (!segments) {
        done.push({
          index,
          outcome: "refused",
          metal: 0,
          shape: [],
          slope: [],
        });
        continue;
      }
      const cost = estimate(segments, original, mult);
      metal += cost;
      done.push({ index, metal: cost, ...build(segments, current, blocked) });
    }
    results.push(joined(index, done));
  }
  return {
    ground: {
      width: ground.width,
      height: ground.height,
      col: ground.col,
      row: ground.row,
      heights: current.heights,
    },
    metal,
    steps: results,
  };
}

/**
 * Which of the gadget's limits a step breaks, or null when it would take the
 * order (issue #4793). The editor's tools ask this before making a step, so
 * they stop at a limit rather than making one the game will refuse.
 *
 * - `points`: more than 2,500 points in the order (lines 99, 2078).
 * - `wall`: a wall that fills out to more than 700 points (line 105).
 * - `area`: an area wider or deeper than 2,000 elmos (line 102).
 * - `ramp`: a ramp shorter than 64 or longer than 3,000 elmos, or narrower
 *   than 48 or wider than 1,600 (lines 138-141, 2118).
 */
export type StepLimit = "points" | "wall" | "area" | "ramp";

export function stepRefusal(step: TerrainStep): StepLimit | null {
  if (step.points.length > MAX_COMMAND_POINTS) return "points";
  if (step.points.length === 0) return null;
  if (step.kind === "ramp") {
    const [a, b] = step.points;
    if (!a || !b) return null;
    return rampSegments(a.x, 0, a.z, b.x, 0, b.z, step.width ?? 0)
      ? null
      : "ramp";
  }
  if (step.shape === "wall") return wallSegments(step.points) ? null : "wall";
  return areaSegments(step.points) ? null : "area";
}

/** A point of a step with the height it is ordered to. */
interface Target {
  x: number;
  z: number;
  aim: number;
}

/** A key for a point on the 8 elmo grid, off the map included. */
function key(x: number, z: number): number {
  return (Math.round(z / SQUARE) + 32768) * 65536 + Math.round(x / SQUARE);
}

/** Lua's `%`, which floors, so -8 % 16 is 8. */
function mod(a: number, b: number): number {
  return a - Math.floor(a / b) * b;
}

/** Ground heights read the way `Spring.GetGroundHeight` reads a corner:
 *  clamped to the map. */
class Reader {
  constructor(
    readonly dims: {
      width: number;
      height: number;
      col?: number;
      row?: number;
    },
    readonly heights: Float32Array,
  ) {}

  private index(x: number, z: number): number {
    const c = Math.min(
      this.dims.width - 1,
      Math.max(0, Math.round(x / SQUARE) - (this.dims.col ?? 0)),
    );
    const r = Math.min(
      this.dims.height - 1,
      Math.max(0, Math.round(z / SQUARE) - (this.dims.row ?? 0)),
    );
    return r * this.dims.width + c;
  }

  at(x: number, z: number): number {
    return this.heights[this.index(x, z)];
  }

  /** A write off the map goes nowhere, as `Spring.SetHeightMap`'s does. */
  set(x: number, z: number, h: number): void {
    const c = x / SQUARE - (this.dims.col ?? 0);
    const r = z / SQUARE - (this.dims.row ?? 0);
    if (!Number.isInteger(c) || !Number.isInteger(r)) return;
    if (c < 0 || r < 0 || c >= this.dims.width || r >= this.dims.height) {
      return;
    }
    this.heights[r * this.dims.width + c] = h;
  }

  /** Between corners, for a pivot that is not on one. */
  bilinear(x: number, z: number): number {
    const c = Math.floor(x / SQUARE);
    const r = Math.floor(z / SQUARE);
    const fx = x / SQUARE - c;
    const fz = z / SQUARE - r;
    const at = (cc: number, rr: number) => this.at(cc * SQUARE, rr * SQUARE);
    const top = at(c, r) * (1 - fx) + at(c + 1, r) * fx;
    const bottom = at(c, r + 1) * (1 - fx) + at(c + 1, r + 1) * fx;
    return top * (1 - fz) + bottom * fz;
  }
}

/** `RegisterStructure`, lines 3527-3563: the corners a building blocks, edges
 *  included. */
function addStructure(blocked: Set<number>, rect: Rect): void {
  const cx = Math.floor(((rect.minX + rect.maxX) / 2 + 4) / SQUARE) * SQUARE;
  const cz = Math.floor(((rect.minZ + rect.maxZ) / 2 + 4) / SQUARE) * SQUARE;
  const hx = (rect.maxX - rect.minX) / 2;
  const hz = (rect.maxZ - rect.minZ) / 2;
  for (let x = cx - hx; x <= cx + hx; x += SQUARE) {
    for (let z = cz - hz; z <= cz + hz; z += SQUARE) blocked.add(key(x, z));
  }
}

/** A step's points as the gadget splits them into terraunits, each with its
 *  target height, or null when the gadget refuses the order. */
function stepSegments(
  step: TerrainStep,
  original: Reader,
  pivot: number,
): Target[][] | null {
  const segments = allSegments(step, original, pivot);
  if (!segments || !step.only || step.kind === "raise") return segments;
  return onlyMoving(segments, step.only, original);
}

/**
 * `checkPointCreation`, lines 523-535, for a level or ramp with a volume
 * selection: a point is made only if it moves the ground the chosen way, and a
 * point already at its target height is never made. The ground read is the
 * ground when the order was given (lines 849, 1212 and 1661).
 */
function onlyMoving(
  segments: Target[][],
  only: "raise" | "lower",
  original: Reader,
): Target[][] {
  const wanted = (p: Target): boolean => {
    const here = original.at(p.x, p.z);
    return only === "raise" ? here < p.aim : here > p.aim;
  };
  // A block with no point left is discarded, line 1228.
  return segments.map((s) => s.filter(wanted)).filter((s) => s.length > 0);
}

function allSegments(
  step: TerrainStep,
  original: Reader,
  pivot: number,
): Target[][] | null {
  if (step.kind === "ramp") {
    const [a, b] = step.points;
    const [h1, h2] = step.heights ?? [0, 0];
    if (!a || !b) return null;
    return rampSegments(
      a.x,
      pivot + h1,
      a.z,
      b.x,
      pivot + h2,
      b.z,
      step.width ?? 0,
    );
  }
  if (step.points.length === 0) return null;
  const segments =
    step.shape === "wall"
      ? wallSegments(step.points)
      : areaSegments(step.points);
  if (!segments) return null;
  const height = step.height ?? 0;
  const aim = (x: number, z: number): number => {
    switch (step.kind) {
      // Level, line 1305: the ordered height, which is the pivot's ground plus
      // the step's.
      case "level":
        return pivot + height;
      // Raise, line 1319: the step's height on top of the ground there.
      case "raise":
        return original.at(x, z) + height;
      // Smooth, lines 1329-1339: the average of the 5 by 5 corners round it.
      default: {
        let total = 0;
        for (let lx = -16; lx <= 16; lx += SQUARE) {
          for (let lz = -16; lz <= 16; lz += SQUARE) {
            total += original.at(x + lx, z + lz);
          }
        }
        return total / 25;
      }
    }
  };
  return segments.map((points) =>
    points.map((p) => ({ x: p.x, z: p.z, aim: aim(p.x, p.z) })),
  );
}

/**
 * `TerraformWall`, lines 1095-1234: each point snapped to 16 elmos, gaps filled
 * every 16, and the 5 by 5 corners round each, 14 points to a terraunit.
 */
function wallSegments(mouse: readonly Point[]): Point[][] | null {
  const snap = (v: number) => Math.floor((v + 8) / 16) * 16;
  const points: Point[] = [];
  let prev = { x: snap(mouse[0].x), z: snap(mouse[0].z) };
  points.push(prev);
  for (let i = 1; i < mouse.length; i++) {
    const next = { x: snap(mouse[i].x), z: snap(mouse[i].z) };
    const diffX = next.x - prev.x;
    const diffZ = next.z - prev.z;
    const absX = Math.abs(diffX);
    const absZ = Math.abs(diffZ);
    if (absX <= 16 && absZ <= 16) {
      points.push(next);
    } else if (absX > absZ) {
      const m = diffZ / diffX;
      const sign = diffX / absX;
      for (let j = 0; j <= absX; j += 16) {
        points.push({
          x: prev.x + j * sign,
          z: Math.floor((prev.z + j * m * sign) / 16) * 16,
        });
      }
    } else {
      const m = diffX / diffZ;
      const sign = diffZ / absZ;
      for (let j = 0; j <= absZ; j += 16) {
        points.push({
          x: Math.floor((prev.x + j * m * sign) / 16) * 16,
          z: prev.z + j * sign,
        });
      }
    }
    if (points.length > MAX_WALL_POINTS) return null;
    prev = next;
  }

  const taken = new Set<number>();
  const segments: Point[][] = [];
  for (let count = 0; count * WALL_SEGMENT_LENGTH < points.length; count++) {
    const segment: Point[] = [];
    const end = Math.min((count + 1) * WALL_SEGMENT_LENGTH, points.length);
    for (let j = count * WALL_SEGMENT_LENGTH; j < end; j++) {
      for (let lx = -16; lx <= 16; lx += SQUARE) {
        for (let lz = -16; lz <= 16; lz += SQUARE) {
          const x = points[j].x + lx;
          const z = points[j].z + lz;
          if (taken.has(key(x, z))) continue;
          taken.add(key(x, z));
          segment.push({ x, z });
        }
      }
    }
    if (segment.length > 0) segments.push(segment);
  }
  return segments;
}

/**
 * `TerraformArea`, lines 1489-1722: the outline closed and snapped to 16 elmos,
 * the inside found by flood fill from the edge of its box, and each inside 16
 * elmo cell filled in at 8, split into terraunits of at most 200 elmos a side.
 */
function areaSegments(mouse: readonly Point[]): Point[][] | null {
  const snap = (p: Point) => ({
    x: Math.floor(p.x / 16) * 16,
    z: Math.floor(p.z / 16) * 16,
  });
  const loop = [...mouse, mouse[0]].map(snap);
  const points: Point[] = [loop[0]];
  const border = {
    left: loop[0].x,
    right: loop[0].x,
    top: loop[0].z,
    bottom: loop[0].z,
  };
  const add = (p: Point) => {
    points.push(p);
    border.left = Math.min(border.left, p.x);
    border.right = Math.max(border.right, p.x);
    border.top = Math.min(border.top, p.z);
    border.bottom = Math.max(border.bottom, p.z);
  };
  for (let i = 1; i < loop.length; i++) {
    const next = loop[i];
    const diffX = next.x - loop[i - 1].x;
    const diffZ = next.z - loop[i - 1].z;
    const absX = Math.abs(diffX);
    const absZ = Math.abs(diffZ);
    if (absX <= 16 && absZ <= 16) {
      add(next);
    } else if (absX > absZ) {
      const m = diffZ / diffX;
      const sign = diffX / absX;
      for (let j = 0; j <= absX; j += 16) {
        add({
          x: next.x - j * sign,
          z: Math.floor((next.z - j * m * sign) / 16) * 16,
        });
      }
    } else {
      const m = diffX / diffZ;
      const sign = diffZ / absZ;
      for (let j = 0; j <= absZ; j += 16) {
        add({
          x: Math.floor((next.x - j * m * sign) / 16) * 16,
          z: next.z - j * sign,
        });
      }
    }
    if (
      border.right - border.left > MAX_AREA_SIZE ||
      border.bottom - border.top > MAX_AREA_SIZE
    ) {
      return null;
    }
  }

  // Lines 1549-1615. 2 is the outline, 1 not yet reached, -1 the flood, false
  // flooded. Whatever is still 1 or 2 is inside.
  const cell = new Map<number, number | false>();
  for (const p of points) cell.set(key(p.x, p.z), 2);
  for (let i = border.left; i <= border.right; i += 16) {
    for (let j = border.top; j <= border.bottom; j += 16) {
      if (cell.get(key(i, j)) !== 2) cell.set(key(i, j), 1);
    }
  }
  for (let i = border.left; i <= border.right; i += 16) {
    if (cell.get(key(i, border.top)) !== 2) cell.set(key(i, border.top), -1);
    if (cell.get(key(i, border.bottom)) !== 2) {
      cell.set(key(i, border.bottom), -1);
    }
  }
  for (let j = border.top; j <= border.bottom; j += 16) {
    if (cell.get(key(border.left, j)) !== 2) cell.set(key(border.left, j), -1);
    if (cell.get(key(border.right, j)) !== 2) {
      cell.set(key(border.right, j), -1);
    }
  }
  let flooding = true;
  while (flooding) {
    flooding = false;
    for (let i = border.left; i <= border.right; i += 16) {
      for (let j = border.top; j <= border.bottom; j += 16) {
        if (cell.get(key(i, j)) !== -1) continue;
        for (const [ni, nj] of [
          [i + 16, j],
          [i - 16, j],
          [i, j + 16],
          [i, j - 16],
        ]) {
          if (cell.get(key(ni, nj)) === 1) {
            cell.set(key(ni, nj), -1);
            flooding = true;
          }
        }
        cell.set(key(i, j), false);
      }
    }
  }
  const inside = (x: number, z: number) => {
    const v = cell.get(key(Math.floor(x / 16) * 16, Math.floor(z / 16) * 16));
    return v !== undefined && v !== false;
  };

  // Lines 1619-1722, the split, including its overlap of 8 between blocks.
  const right = border.right + 16;
  const bottom = border.bottom + 16;
  const wCount = Math.ceil((right - border.left) / AREA_SEG_MAX_SIZE) - 1;
  const hCount = Math.ceil((bottom - border.top) / AREA_SEG_MAX_SIZE) - 1;
  const width = (right - border.left) / (wCount + 1);
  const height = (bottom - border.top) / (hCount + 1);
  const segments: Point[][] = [];
  let addX = 0;
  for (let i = 0; i <= wCount; i++) {
    let addZ = 0;
    for (let j = 0; j <= hCount; j++) {
      const segment: Point[] = [];
      const xEnd = border.left + Math.floor((width * (i + 1)) / 8) * 8;
      const zEnd = border.top + Math.floor((height * (j + 1)) / 8) * 8;
      for (
        let lx = border.left + Math.floor((width * i) / 8) * 8 + addX;
        lx <= xEnd;
        lx += 16
      ) {
        for (
          let lz = border.top + Math.floor((height * j) / 8) * 8 + addZ;
          lz <= zEnd;
          lz += 16
        ) {
          if (!inside(lx, lz)) continue;
          for (let x = lx; x <= lx + 8; x += 8) {
            for (let z = lz; z <= lz + 8; z += 8) segment.push({ x, z });
          }
          const cx = Math.floor(lx / 16) * 16;
          const cz = Math.floor(lz / 16) * 16;
          const open = !inside(cx + 16, cz);
          const below = !inside(cx, cz + 16);
          if (open && below) segment.push({ x: lx + 16, z: lz + 16 });
          if (open) {
            for (let z = lz; z <= lz + 8; z += 8) {
              segment.push({ x: lx + 16, z });
            }
          }
          if (below) {
            for (let x = lx; x <= lx + 8; x += 8) {
              segment.push({ x, z: lz + 16 });
            }
          }
        }
      }
      addZ = 8;
      if (segment.length > 0) segments.push(segment);
    }
    addX = 8;
  }
  return segments;
}

/** A line through a point with a gradient, line 481. */
interface Line {
  x: number;
  z: number;
  m: number;
}

/**
 * `TerraformRamp`, lines 659-872: the corners inside a band `width` wide from
 * one end to the other, each at the height along it, in blocks of at most 200
 * elmos each way.
 *
 * `width` is the band's whole width on the ground. Zero-K's own terraform
 * widget sends half of it, and the gadget doubles it (line 2118).
 */
function rampSegments(
  x1: number,
  y1: number,
  z1: number,
  x2In: number,
  y2: number,
  z2In: number,
  width: number,
): Target[][] | null {
  let x2 = x2In;
  let z2 = z2In;
  if (Math.abs(x1 - x2) < 0.1) x2 = x1 + 0.1;
  if (Math.abs(z1 - z2) < 0.1) z2 = z1 + 0.1;
  const dis = Math.hypot(x1 - x2, z1 - z2);
  if (
    dis < MIN_TOTAL_RAMP_LENGTH - 0.05 ||
    dis > MAX_TOTAL_RAMP_LENGTH + 0.05
  ) {
    return null;
  }
  if (width < MIN_TOTAL_RAMP_WIDTH || width > MAX_TOTAL_RAMP_WIDTH * 2) {
    return null;
  }
  const xdis = Math.abs(x1 - x2);
  let heightDiff = y2 - y1;
  if (heightDiff / dis > MAX_RAMP_GRADIENT) {
    heightDiff = MAX_RAMP_GRADIENT * dis;
  } else if (heightDiff / dis < -MAX_RAMP_GRADIENT) {
    heightDiff = -MAX_RAMP_GRADIENT * dis;
  }
  const m = (z1 - z2) / (x1 - x2);
  const segmentsAlong = Math.ceil(dis / MAX_RAMP_LENGTH);
  const segmentsAcross = Math.ceil(width / MAX_RAMP_WIDTH);
  const segLength = dis / segmentsAlong;
  const segWidth = width / segmentsAcross;
  const widthScale = width / dis;
  const lengthScale = segLength / dis;
  const add = { x: (x2 - x1) * lengthScale, z: (z2 - z1) * lengthScale };
  const addPerp = {
    x: ((z1 - z2) * segWidth) / dis,
    z: (-(x1 - x2) * segWidth) / dis,
  };
  const mid = {
    x: ((x1 - x2) * widthScale) / 2,
    z: ((z1 - z2) * widthScale) / 2,
  };
  const rightRot = { x: -mid.z + x1, z: mid.x + z1 };
  const plus = (a: Point, b: Point) => ({ x: a.x + b.x, z: a.z + b.z });

  // Lines 727-775: the four corners of a block, which depend on the quadrant.
  let topleftGrad: number;
  let botleftGrad: number;
  let toppoint: Point;
  let botpoint: Point;
  let leftpoint: Point;
  let rightpoint: Point;
  if (x1 < x2) {
    if (z1 < z2) {
      topleftGrad = -1 / m;
      botleftGrad = m;
      toppoint = rightRot;
      leftpoint = plus(rightRot, addPerp);
      rightpoint = plus(toppoint, add);
      botpoint = plus(leftpoint, add);
    } else {
      topleftGrad = m;
      botleftGrad = -1 / m;
      leftpoint = rightRot;
      botpoint = plus(rightRot, addPerp);
      rightpoint = plus(botpoint, add);
      toppoint = plus(rightRot, add);
    }
  } else if (z1 < z2) {
    topleftGrad = m;
    botleftGrad = -1 / m;
    rightpoint = rightRot;
    toppoint = plus(rightRot, addPerp);
    botpoint = plus(rightRot, add);
    leftpoint = plus(toppoint, add);
  } else {
    topleftGrad = -1 / m;
    botleftGrad = m;
    botpoint = rightRot;
    rightpoint = plus(rightRot, addPerp);
    toppoint = plus(rightpoint, add);
    leftpoint = plus(rightRot, add);
  }

  // Line 489, the height along the ramp at a corner.
  const pointHeight = (x: number, z: number) => {
    const xInt = (z - z1 + m * x1 + x / m) / (m + 1 / m);
    return (Math.abs(xInt - x1) / xdis) * heightDiff + y1;
  };
  const along = (l: Line, x: number) => l.m * (x - l.x) + l.z;

  const segments: Target[][] = [];
  for (let i = 0; i < segmentsAlong; i++) {
    for (let j = 0; j < segmentsAcross; j++) {
      const middle =
        i > 0 && j > 0 && i < segmentsAlong - 1 && j < segmentsAcross - 1;
      const offset = middle ? 8 : 0;
      const shift = (p: Point) => ({
        x: p.x + add.x * i + addPerp.x * j,
        z: p.z + add.z * i + addPerp.z * j,
      });
      const left = shift(leftpoint);
      const top = shift(toppoint);
      const bot = shift(botpoint);
      const borderLeft = Math.floor(left.x / 8) * 8 - offset;
      const borderRight = Math.ceil(shift(rightpoint).x / 8) * 8 + offset;
      const borderTop = Math.floor(top.z / 8) * 8 - offset;
      const topline1 = {
        x: left.x - offset,
        z: left.z - offset,
        m: topleftGrad,
      };
      const topline2 = { x: top.x + offset, z: top.z - offset, m: botleftGrad };
      const botline1 = {
        x: left.x - offset,
        z: left.z + offset,
        m: botleftGrad,
      };
      const botline2 = { x: bot.x + offset, z: bot.z + offset, m: topleftGrad };
      let topline = topline1;
      let botline = botline1;
      const segment: Target[] = [];
      for (let lx = borderLeft - offset; lx <= borderRight + offset; ) {
        const zmin = along(topline, lx);
        const zmax = along(botline, lx);
        for (let lz = borderTop; lz <= zmax; lz += 8) {
          if (zmin <= lz) {
            segment.push({ x: lx, z: lz, aim: pointHeight(lx, lz) });
          }
        }
        lx += 8;
        if (topline === topline1 && topline2.x < lx) topline = topline2;
        if (botline === botline1 && botline2.x < lx) botline = botline2;
      }
      if (segment.length > 0) segments.push(segment);
    }
  }
  return segments;
}

/**
 * The gadget's estimate for one step, which is what a terraunit's tooltip shows
 * when the order is given: `totalCost + pyramidCostEstimate` for each block,
 * lines 937-990, 1294-1410 and 1785-1897, through `SetTooltip`.
 *
 * Worked from the ground when the blueprint is placed, which is when the gadget
 * works it out. No building of the layout exists yet then, so none is left out.
 */
function estimate(
  segments: readonly Target[][],
  original: Reader,
  mult: number,
): number {
  const volumeCost = VOLUME_COST * mult * INBUILT_COST_MULT;
  const perimeterCost = POINT_EXTRA_PERIMETER_COST * mult * INBUILT_COST_MULT;
  const areaCostEach = POINT_EXTRA_AREA_COST * mult * INBUILT_COST_MULT;
  let metal = 0;
  for (const segment of segments) {
    const area = new Set(segment.map((p) => key(p.x, p.z)));
    let volume = 0;
    let areaCost = 0;
    let perimeter = 0;
    let pyramid = 0;
    for (const p of segment) {
      const diff = Math.abs(p.aim - original.at(p.x, p.z));
      volume += diff;
      areaCost += Math.min(diff, POINT_EXTRA_AREA_COST_DEPTH);
      let edges = 0;
      if (!area.has(key(p.x + 8, p.z))) edges++;
      if (!area.has(key(p.x - 8, p.z))) edges++;
      if (!area.has(key(p.x, p.z + 8))) edges++;
      if (!area.has(key(p.x, p.z - 8))) edges++;
      perimeter +=
        PERIMETER_EDGE_COST[edges] *
        Math.min(diff, POINT_EXTRA_PERIMETER_COST_DEPTH);
      if (edges > 0 && diff > 30) {
        const steps = Math.floor(diff / MAX_HEIGHT_DIFFERENCE);
        const rest = diff % MAX_HEIGHT_DIFFERENCE;
        pyramid +=
          ((diff - rest) * (steps - 1) * 0.5 + steps * rest) * volumeCost;
      }
    }
    if (volume !== 0) {
      const base =
        areaCost * areaCostEach +
        perimeter * perimeterCost +
        BASE_TERRAUNIT_COST;
      metal += volume * volumeCost + base + pyramid;
    }
  }
  return metal;
}

/** One of a step's points while it is built. */
interface Building {
  x: number;
  z: number;
  aim: number;
  /** The ground there when building starts, line 2420. */
  or: number;
  /** Left alone: under a building, too thin, or cut back from one. */
  structure: boolean;
  edges: Edge[] | null;
}

/** A corner next to a point, and which way is outward from it, line 2280. 0
 *  where the gadget has nil. */
interface Edge {
  x: number;
  z: number;
  checkX: number;
  checkZ: number;
}

/** A corner the slope changes. Supported ones are on a slope from `support`,
 *  the rest are the lip at its foot. */
interface Extra {
  x: number;
  z: number;
  target: number;
  support: { x: number; z: number; h: number; id: number } | null;
  checkX: number;
  checkZ: number;
  pyramid: boolean;
}

type Pass =
  | { kind: "done"; extras: Extra[] }
  | { kind: "drop"; id: number }
  | { kind: "cancel" };

/** `GetHeightDiffLocal`, lines 2553-2570: how far below its top a slope may be
 *  this far from it. A dug slope starts with a gentler first square. */
function heightDiffLocal(
  xDiff: number,
  zDiff: number,
  inner: number | null,
): number {
  const per = MAX_HEIGHT_DIFFERENCE / 8;
  if (inner !== null) {
    if (xDiff === 0) return inner + (zDiff - 8) * per;
    if (zDiff === 0) return inner + (xDiff - 8) * per;
    return Math.SQRT2 * inner + Math.hypot(xDiff - 8, zDiff - 8) * per;
  }
  if (xDiff === 0) return zDiff * per;
  if (zDiff === 0) return xDiff * per;
  return Math.hypot(xDiff, zDiff) * per;
}

/**
 * Build one step on the ground as it stands, and write the result into it.
 *
 * The points of every block are one set here. A block's own edges would point
 * into its neighbours, but each neighbour then sets its own points to target, so
 * the finished ground is the same.
 */
function build(
  segments: readonly Target[][],
  ground: Reader,
  blocked: ReadonlySet<number>,
): Omit<StepResult, "index" | "metal"> {
  const points: Building[] = [];
  const seen = new Set<number>();
  // Inside the step: true while the point is terraformed, false once it is cut
  // back from a building, which still counts for thickness (line 2330).
  const area = new Map<number, boolean>();
  for (const segment of segments) {
    for (const p of segment) {
      const k = key(p.x, p.z);
      if (seen.has(k)) continue;
      seen.add(k);
      const structure = blocked.has(k);
      // `SetupPointStructure`, lines 425-435, and `RegisterStructure`, lines
      // 3600-3612: a point under a building is left alone and is not area.
      points.push({ ...p, or: ground.at(p.x, p.z), structure, edges: null });
      if (!structure) area.set(k, true);
    }
  }
  const inArea = (x: number, z: number) => area.get(key(x, z)) === true;
  const terraformable = (x: number, z: number) => !blocked.has(key(x, z));

  // `CheckThickness`, lines 2324-2382: a point needs enough of the step round
  // it, or the gadget drops it.
  const has = (x: number, z: number) => area.has(key(x, z));
  const thick = (x: number, z: number): boolean => {
    if (mod(x, 16) === 8) {
      if (mod(z, 16) === 8) {
        const n = has(x, z - 16);
        const ne = has(x + 16, z - 16);
        const e = has(x + 16, z);
        const se = has(x + 16, z + 16);
        const s = has(x, z + 16);
        const sw = has(x - 16, z + 16);
        const w = has(x - 16, z);
        const nw = has(x - 16, z - 16);
        return (
          (n && ne && e) ||
          (ne && e && se) ||
          (e && se && s) ||
          (se && s && sw) ||
          (s && sw && w) ||
          (sw && w && nw) ||
          (w && nw && n) ||
          (nw && n && ne)
        );
      }
      return has(x, z - 8) || has(x, z + 8);
    }
    if (mod(z, 16) === 8) return has(x - 8, z) || has(x + 8, z);
    return (
      has(x - 8, z - 8) ||
      has(x - 8, z + 8) ||
      has(x + 8, z - 8) ||
      has(x + 8, z + 8)
    );
  };
  // `updateTerraformCost`, lines 2387-2407.
  const prune = () => {
    let removed = true;
    while (removed) {
      removed = false;
      for (const p of points) {
        if (p.structure || thick(p.x, p.z)) continue;
        if (area.get(key(p.x, p.z))) area.delete(key(p.x, p.z));
        p.structure = true;
        removed = true;
      }
    }
  };
  // `updateTerraformEdgePoints`, lines 2249-2322.
  const findEdges = () => {
    for (const p of points) {
      if (p.structure) {
        p.edges = null;
        continue;
      }
      const { x, z } = p;
      const left = !inArea(x - 8, z);
      const right = !inArea(x + 8, z);
      const top = !inArea(x, z - 8);
      const bot = !inArea(x, z + 8);
      const edges: Edge[] = [];
      if (left) {
        edges.push({ x: x - 8, z, checkX: -8, checkZ: 0 });
        if (top) edges.push({ x: x - 8, z: z - 8, checkX: -8, checkZ: -8 });
        if (bot) edges.push({ x: x - 8, z: z + 8, checkX: -8, checkZ: 8 });
      }
      if (right) {
        edges.push({ x: x + 8, z, checkX: 8, checkZ: 0 });
        if (top) edges.push({ x: x + 8, z: z - 8, checkX: 8, checkZ: -8 });
        if (bot) edges.push({ x: x + 8, z: z + 8, checkX: 8, checkZ: 8 });
      }
      if (top) edges.push({ x, z: z - 8, checkX: 0, checkZ: -8 });
      if (bot) edges.push({ x, z: z + 8, checkX: 0, checkZ: 8 });
      p.edges = edges.length > 0 ? edges : null;
    }
  };

  // `updateTerraform` at full progress, lines 2640-2923.
  const slope = (): Pass => {
    const extras: Extra[] = [];
    const at = new Map<number, number>();

    /** Lines 2671-2683 and 2812-2824: the height a corner already has, and
     *  whether something on it already can be replaced. */
    const existing = (x: number, z: number) => {
      const ground0 = ground.at(x, z);
      const overlap = at.get(key(x, z));
      if (overlap === undefined) {
        return { ground0, edgeHeight: ground0, overlap, replaces: false };
      }
      const supported = extras[overlap].support !== null;
      return {
        ground0,
        edgeHeight: supported ? extras[overlap].target : ground0,
        overlap,
        replaces: !supported,
      };
    };

    /** Lines 2741-2777 and 2875-2910: the 4 elmo lip at the foot of a slope. */
    const lip = (
      x: number,
      z: number,
      lookX: number,
      lookZ: number,
      groundHere: number,
      parentGoal: number,
      pyramid: boolean,
    ) => {
      let border: number | null = null;
      if (pyramid) {
        if (groundHere + MAX_EDGE_HEIGHT_DIFF < parentGoal) {
          border = Math.min(
            MAX_EDGE_HEIGHT_DIFF,
            parentGoal - groundHere + MAX_EDGE_HEIGHT_DIFF,
          );
        }
      } else if (groundHere - MAX_EDGE_HEIGHT_DIFF > parentGoal) {
        border = Math.min(
          MAX_EDGE_HEIGHT_DIFF,
          groundHere - MAX_EDGE_HEIGHT_DIFF - parentGoal,
        );
      }
      if (border === null || inArea(lookX, lookZ)) return;
      const ahead = ground.at(lookX, lookZ);
      if (
        !at.has(key(x, z)) &&
        (pyramid ? groundHere < ahead + border : groundHere > ahead - border) &&
        terraformable(x, z)
      ) {
        extras.push({
          x,
          z,
          target: (pyramid ? border : -border) + ahead,
          support: null,
          checkX: 0,
          checkZ: 0,
          pyramid,
        });
        at.set(key(x, z), extras.length - 1);
      }
    };

    /** The lip's height under a raised slope's foot, when the lip would be
     *  there. Zero-K builds the slope up over many updates and reads the ground
     *  again at each, so the lip goes in first and the slope's check (line
     *  2693) then measures from it. A slope that would end below the lip ends
     *  on it instead (#4805). */
    const footHeight = (
      lookX: number,
      lookZ: number,
      groundHere: number,
      parentGoal: number,
    ): number => {
      if (
        groundHere + MAX_EDGE_HEIGHT_DIFF >= parentGoal ||
        inArea(lookX, lookZ)
      ) {
        return Number.NEGATIVE_INFINITY;
      }
      const border = Math.min(
        MAX_EDGE_HEIGHT_DIFF,
        parentGoal - groundHere + MAX_EDGE_HEIGHT_DIFF,
      );
      const ahead = ground.at(lookX, lookZ);
      return groundHere < ahead + border
        ? ahead + border
        : Number.NEGATIVE_INFINITY;
    };

    // Lines 2663-2781: the first square out from each edge of the step.
    for (let id = 0; id < points.length; id++) {
      const p = points[id];
      if (!p.edges) continue;
      const newHeight = p.aim;
      const pyramid = p.aim - p.or > 0;
      for (const edge of p.edges) {
        const { x, z } = edge;
        const here = existing(x, z);
        const diagonal = edge.checkX !== 0 && edge.checkZ !== 0;
        const base = pyramid
          ? MAX_HEIGHT_DIFFERENCE
          : MAX_HEIGHT_DIFF_DOWN_INNER;
        const maxDiff = diagonal ? Math.SQRT2 * base : base;
        const sign = pyramid ? 1 : -1;
        const diff = newHeight - here.edgeHeight;
        if ((pyramid && diff > maxDiff) || (!pyramid && diff < -maxDiff)) {
          let index = extras.length;
          if (here.overlap !== undefined) {
            if (!here.replaces && extras[here.overlap].pyramid !== pyramid) {
              return { kind: "cancel" };
            }
            index = here.overlap;
          }
          extras[index] = {
            x,
            z,
            target: pyramid
              ? Math.max(
                  newHeight - maxDiff,
                  footHeight(
                    x + edge.checkX,
                    z + edge.checkZ,
                    here.ground0,
                    p.aim,
                  ),
                )
              : newHeight - sign * maxDiff,
            support: { x: p.x, z: p.z, h: newHeight, id },
            checkX: edge.checkX,
            checkZ: edge.checkZ,
            pyramid,
          };
          if (!terraformable(x, z)) return { kind: "drop", id };
          at.set(key(x, z), index);
        } else {
          lip(
            x,
            z,
            x + edge.checkX,
            z + edge.checkZ,
            here.ground0,
            p.aim,
            pyramid,
          );
        }
      }
    }

    // Lines 2785-2921: each sloped corner carries the slope on outward, along
    // the way its edge faces, until the slope meets the ground.
    for (let i = 0; i < extras.length; i++) {
      const from = extras[i];
      const support = from.support;
      if (!support) continue;
      const directions: [number, number][] = [];
      if (from.checkX !== 0) directions.push([from.checkX, 0]);
      if (from.checkZ !== 0) directions.push([0, from.checkZ]);
      for (const [diffX, diffZ] of directions) {
        const x = from.x + diffX;
        const z = from.z + diffZ;
        if (inArea(x, z)) continue;
        const here = existing(x, z);
        const allowed = heightDiffLocal(
          Math.abs(x - support.x),
          Math.abs(z - support.z),
          from.pyramid ? null : MAX_HEIGHT_DIFF_DOWN_INNER,
        );
        const sign = from.pyramid ? 1 : -1;
        const diff = support.h - here.edgeHeight;
        if (
          (from.pyramid && diff > allowed) ||
          (!from.pyramid && diff < -allowed)
        ) {
          let index = extras.length;
          if (here.overlap !== undefined) {
            if (
              !here.replaces &&
              extras[here.overlap].pyramid !== from.pyramid
            ) {
              return { kind: "cancel" };
            }
            index = here.overlap;
          }
          extras[index] = {
            x,
            z,
            target: from.pyramid
              ? Math.max(
                  support.h - allowed,
                  footHeight(x + diffX, z + diffZ, here.ground0, from.target),
                )
              : support.h - sign * allowed,
            support,
            checkX: from.checkX,
            checkZ: from.checkZ,
            pyramid: from.pyramid,
          };
          if (!terraformable(x, z)) return { kind: "drop", id: support.id };
          at.set(key(x, z), index);
        } else {
          lip(
            x,
            z,
            x + diffX,
            z + diffZ,
            here.ground0,
            from.target,
            from.pyramid,
          );
        }
      }
    }
    return { kind: "done", extras };
  };

  // `finishInitialisingTerraformUnit`, line 2531, then `DoTerraformUpdate`'s
  // retries, lines 3179-3192: a point whose slope would reach a building is
  // dropped, and the slope is worked out again without it. Each retry drops a
  // point, so this ends.
  prune();
  findEdges();
  let pass = slope();
  while (pass.kind === "drop") {
    const dropped = points[pass.id];
    dropped.structure = true;
    if (area.get(key(dropped.x, dropped.z))) {
      area.set(key(dropped.x, dropped.z), false);
    }
    prune();
    findEdges();
    pass = slope();
  }
  if (pass.kind === "cancel") {
    return { outcome: "cancelled", shape: [], slope: [] };
  }

  // The height map function, lines 2995-3004: the step's points, then the
  // slope over them.
  const shape: Point[] = [];
  for (const p of points) {
    if (p.structure) continue;
    ground.set(p.x, p.z, p.aim);
    shape.push({ x: p.x, z: p.z });
  }
  for (const e of pass.extras) ground.set(e.x, e.z, e.target);
  return {
    outcome: "built",
    shape,
    slope: pass.extras.map((e) => ({ x: e.x, z: e.z })),
  };
}

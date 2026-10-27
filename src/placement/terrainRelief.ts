/**
 * The ground a blueprint's terrain steps leave, held so the editor can redraw
 * it while a step is dragged (issue #4794).
 *
 * `terraform` in `../blueprint/terraform.ts` is the rules. It copies the whole
 * map and works out every step, which is right for a result and too much for a
 * drag on a large map. A {@link Relief} runs it on the part of the map the steps
 * can reach, writes only that part back, and tells the caller which corners
 * moved, so everything downstream (the 3D ground, the standing models, the
 * building verdicts) redraws that part and nothing else.
 *
 * The working heights are one `Float32Array` in elmos, changed in place. They
 * are the ground the models stand on (as a {@link HeightField} with the range
 * 0 to 1, so a sample is its own height) and the ground the verdicts read (as a
 * `Ground`), so the picture and the verdicts cannot disagree.
 */

import type { Ground } from "@/blueprint/buildable";
import { type Rect, SQUARE_SIZE } from "@/blueprint/footprint";
import type { TerrainStep } from "@/blueprint/model";
import {
  type GroundHeights,
  type LayoutPlacement,
  placedSteps,
  type StepResult,
  terraform,
} from "@/blueprint/terraform";
import type { HeightField, HeightGrid } from "./terrain";

const SQUARE = SQUARE_SIZE;

/** How far past the steps' own extent the first window reaches, in elmos. A
 *  slope is 8 elmos for every 28 of height, so this holds a wall of 900. A
 *  taller one fails the edge check below and the window grows. */
const FIRST_MARGIN = 256;

/** Corners from a window edge that is not the map's edge, inside which a changed
 *  corner means the window was too small to give the same answer as the map. */
const EDGE_CORNERS = 3;

/** A block of corners, both ends included. */
export interface CornerRect {
  c0: number;
  r0: number;
  c1: number;
  r1: number;
}

/** The map's ground before any step, corner by corner. */
export interface CornerSource {
  width: number;
  height: number;
  /** A corner's height in elmos by its index in the row-major grid. */
  at: (index: number) => number;
  /** The lowest and highest ground, which a map reports and a flat floor is
   *  one number of. */
  min: number;
  max: number;
  /** Whether height 0 is the sea's surface. See `Ground.hasWater`. */
  hasWater: boolean;
}

/** A map's own words, by `CSMFMapFile::ReadHeightmap`'s arithmetic. */
export function gridSource(
  grid: HeightGrid,
  minHeight: number,
  maxHeight: number,
): CornerSource {
  const step = (maxHeight - minHeight) / 65536;
  return {
    width: grid.width,
    height: grid.height,
    at: (index) => grid.words[index] * step + minHeight,
    min: minHeight,
    max: maxHeight,
    hasWater: true,
  };
}

/** Level ground with no sea, the blueprint editor's floor. */
export function flatSource(
  width: number,
  height: number,
  level = 0,
): CornerSource {
  return {
    width,
    height,
    at: () => level,
    min: level,
    max: level,
    hasWater: false,
  };
}

/** What one {@link Relief.update} changed. */
export interface ReliefChange {
  /** The corners that may differ from before. Null when nothing was drawn
   *  before or after. */
  rect: CornerRect | null;
  /** Those corners' heights in elmos before the update, row-major over `rect`,
   *  for a drawing that eases from the old ground to the new. */
  before: Float32Array | null;
}

export class Relief {
  readonly width: number;
  readonly height: number;
  /** The working heights in elmos, changed in place. */
  readonly heights: Float32Array;
  /** Counts updates, so a reader holding the arrays knows they moved. */
  version = 0;
  /** Each step's outcome and the corners it changed, in map elmos. */
  results: StepResult[] = [];
  /** The estimate for every step added up. */
  metal = 0;
  private low: number;
  private high: number;
  /** The corners the last update's steps reached. */
  private reached: CornerRect | null = null;
  private readonly fieldValue: HeightField;

  constructor(readonly source: CornerSource) {
    this.width = source.width;
    this.height = source.height;
    this.heights = new Float32Array(source.width * source.height);
    for (let i = 0; i < this.heights.length; i++) {
      this.heights[i] = source.at(i);
    }
    this.low = source.min;
    this.high = source.max;
    this.fieldValue = {
      width: this.width,
      height: this.height,
      samples: this.heights,
    };
  }

  /** The heights as the field the models stand on. Its samples are elmos, so it
   *  is read with a range of 0 to 1. */
  get field(): HeightField {
    return this.fieldValue;
  }

  /** A corner's height before any step, by its position on the map in elmos,
   *  clamped to the map. */
  baseAt(x: number, z: number): number {
    const c = Math.min(this.width - 1, Math.max(0, Math.round(x / SQUARE)));
    const r = Math.min(this.height - 1, Math.max(0, Math.round(z / SQUARE)));
    return this.source.at(r * this.width + c);
  }

  /** A corner's height now, by its position on the map in elmos. */
  heightAt(x: number, z: number): number {
    const c = Math.min(this.width - 1, Math.max(0, Math.round(x / SQUARE)));
    const r = Math.min(this.height - 1, Math.max(0, Math.round(z / SQUARE)));
    return this.heights[r * this.width + c];
  }

  /** The ground a verdict is worked out on, as the heights stand now. A new
   *  object each time, so a memo keyed on it notices the change. */
  ground(): Ground {
    const { heights, width, height } = this;
    return {
      cornerAt: (x, z) => {
        const c = Math.min(width - 1, Math.max(0, x));
        const r = Math.min(height - 1, Math.max(0, z));
        return heights[r * width + c];
      },
      slack: 0,
      minHeight: this.low,
      maxHeight: this.high,
      hasWater: this.source.hasWater,
    };
  }

  /**
   * Work the ground out again for these steps, and say which corners moved.
   *
   * `footprints` are the layout's buildings where they stand on the map, in
   * order, as `terraform` takes them. Steps that are none leave the map's own
   * ground.
   */
  update(
    steps: readonly TerrainStep[],
    placement: LayoutPlacement,
    footprints: readonly (Rect | null | undefined)[],
  ): ReliefChange {
    const next =
      steps.length > 0 ? this.solve(steps, placement, footprints) : null;
    const previous = this.reached;
    const union = bounds(previous, next?.rect ?? null);
    this.version++;
    this.results = next?.results ?? [];
    this.metal = next?.metal ?? 0;
    this.reached = next?.rect ?? null;
    if (!union) {
      this.low = this.source.min;
      this.high = this.source.max;
      return { rect: null, before: null };
    }
    const before = this.read(this.heights, union);
    if (previous) this.restore(previous);
    if (next) this.write(next.rect, next.ground);
    this.low = Math.min(this.source.min, next?.low ?? this.source.min);
    this.high = Math.max(this.source.max, next?.high ?? this.source.max);
    return { rect: union, before };
  }

  /** The steps worked out on the smallest window that gives the map's answer. */
  private solve(
    steps: readonly TerrainStep[],
    placement: LayoutPlacement,
    footprints: readonly (Rect | null | undefined)[],
  ) {
    const extent = stepExtent(steps, placement);
    for (let margin = FIRST_MARGIN; ; margin *= 2) {
      const rect = this.window(extent, margin);
      const whole =
        rect.c0 === 0 &&
        rect.r0 === 0 &&
        rect.c1 === this.width - 1 &&
        rect.r1 === this.height - 1;
      const done = terraform(this.crop(rect), steps, placement, footprints);
      if (!whole && !this.fits(done.steps, rect)) continue;
      let low = Number.POSITIVE_INFINITY;
      let high = Number.NEGATIVE_INFINITY;
      for (const h of done.ground.heights) {
        if (h < low) low = h;
        if (h > high) high = h;
      }
      return {
        rect,
        ground: done.ground.heights,
        low,
        high,
        metal: done.metal,
        results: done.steps,
      };
    }
  }

  /** The corners round the steps, a margin out and held to the map. */
  private window(
    extent: { minX: number; maxX: number; minZ: number; maxZ: number },
    margin: number,
  ): CornerRect {
    const lo = (v: number) => Math.max(0, Math.floor((v - margin) / SQUARE));
    const hi = (v: number, size: number) =>
      Math.min(size - 1, Math.ceil((v + margin) / SQUARE));
    return {
      c0: lo(extent.minX),
      r0: lo(extent.minZ),
      c1: hi(extent.maxX, this.width),
      r1: hi(extent.maxZ, this.height),
    };
  }

  /** Whether every corner a step changed is clear of the window's edges that are
   *  not the map's, where `terraform` read ground that is not there. */
  private fits(results: readonly StepResult[], rect: CornerRect): boolean {
    const w = rect.c1 - rect.c0 + 1;
    const h = rect.r1 - rect.r0 + 1;
    const west = rect.c0 > 0;
    const north = rect.r0 > 0;
    const east = rect.c1 < this.width - 1;
    const south = rect.r1 < this.height - 1;
    for (const result of results) {
      for (const list of [result.shape, result.slope]) {
        for (const p of list) {
          const c = Math.round(p.x / SQUARE) - rect.c0;
          const r = Math.round(p.z / SQUARE) - rect.r0;
          if (west && c < EDGE_CORNERS) return false;
          if (north && r < EDGE_CORNERS) return false;
          if (east && c > w - 1 - EDGE_CORNERS) return false;
          if (south && r > h - 1 - EDGE_CORNERS) return false;
        }
      }
    }
    return true;
  }

  private crop(rect: CornerRect): GroundHeights {
    const w = rect.c1 - rect.c0 + 1;
    const h = rect.r1 - rect.r0 + 1;
    const heights = new Float32Array(w * h);
    for (let r = 0; r < h; r++) {
      const from = (rect.r0 + r) * this.width + rect.c0;
      for (let c = 0; c < w; c++) heights[r * w + c] = this.source.at(from + c);
    }
    return { width: w, height: h, col: rect.c0, row: rect.r0, heights };
  }

  /** Put the map's own ground back over a block. */
  private restore(rect: CornerRect): void {
    for (let r = rect.r0; r <= rect.r1; r++) {
      const row = r * this.width;
      for (let c = rect.c0; c <= rect.c1; c++) {
        this.heights[row + c] = this.source.at(row + c);
      }
    }
  }

  private write(rect: CornerRect, heights: Float32Array): void {
    const w = rect.c1 - rect.c0 + 1;
    for (let r = rect.r0; r <= rect.r1; r++) {
      const from = (r - rect.r0) * w;
      this.heights.set(
        heights.subarray(from, from + w),
        r * this.width + rect.c0,
      );
    }
  }

  /** A block of corners as they stand in `from`, row-major over the block. */
  private read(from: Float32Array, rect: CornerRect): Float32Array {
    const w = rect.c1 - rect.c0 + 1;
    const h = rect.r1 - rect.r0 + 1;
    const out = new Float32Array(w * h);
    for (let r = 0; r < h; r++) {
      const start = (rect.r0 + r) * this.width + rect.c0;
      out.set(from.subarray(start, start + w), r * w);
    }
    return out;
  }
}

/** The smallest block holding both, or whichever there is. */
function bounds(a: CornerRect | null, b: CornerRect | null): CornerRect | null {
  if (!a) return b;
  if (!b) return a;
  return {
    c0: Math.min(a.c0, b.c0),
    r0: Math.min(a.r0, b.r0),
    c1: Math.max(a.c1, b.c1),
    r1: Math.max(a.r1, b.r1),
  };
}

/** Where the steps' own points lie on the map, a ramp's width included, and the
 *  point the layout is held by, so a step with no points still has somewhere. */
function stepExtent(steps: readonly TerrainStep[], placement: LayoutPlacement) {
  const extent = {
    minX: placement.at.x,
    maxX: placement.at.x,
    minZ: placement.at.z,
    maxZ: placement.at.z,
  };
  for (const step of placedSteps(steps, placement)) {
    const reach = step.kind === "ramp" ? (step.width ?? 0) / 2 : 0;
    for (const p of step.points) {
      extent.minX = Math.min(extent.minX, p.x - reach);
      extent.maxX = Math.max(extent.maxX, p.x + reach);
      extent.minZ = Math.min(extent.minZ, p.z - reach);
      extent.maxZ = Math.max(extent.maxZ, p.z + reach);
    }
  }
  return extent;
}

/** How a height grid is cut down to the samples a displacement texture holds. */
export interface Decimation {
  /** Samples a side of the texture. */
  width: number;
  height: number;
  /** Corners of the grid averaged into one sample, either way. */
  stepX: number;
  stepZ: number;
}

/** What `decimateHeights` in `../mapconv/heightGrid.ts` does to a grid of this
 *  size for a texture of this size. */
export function decimationFor(
  grid: { width: number; height: number },
  texture: { width: number; height: number },
): Decimation {
  return {
    width: texture.width,
    height: texture.height,
    stepX: Math.max(1, Math.ceil(grid.width / texture.width)),
    stepZ: Math.max(1, Math.ceil(grid.height / texture.height)),
  };
}

/**
 * Rewrite the part of a displacement texture a block of corners reaches.
 *
 * The same averaging and row order as `decimateHeights`, over only the samples
 * the block touches. `height` turns a corner's index into its height in elmos,
 * so a drawing easing from the old ground to the new can hand in a blend. The
 * samples are the height's place in `min` to `max` and are not clamped, because
 * a wall can stand above a map's highest point and a texture of floats holds it.
 */
export function writeDisplacement(
  data: Float32Array,
  decimation: Decimation,
  grid: { width: number; height: number },
  rect: CornerRect,
  height: (index: number) => number,
  min: number,
  max: number,
): void {
  const span = max - min || 1;
  const { stepX, stepZ, width, height: rows } = decimation;
  const col0 = Math.floor(rect.c0 / stepX);
  const col1 = Math.min(width - 1, Math.floor(rect.c1 / stepX));
  const row0 = Math.floor(rect.r0 / stepZ);
  const row1 = Math.min(rows - 1, Math.floor(rect.r1 / stepZ));
  for (let row = row0; row <= row1; row++) {
    for (let col = col0; col <= col1; col++) {
      let sum = 0;
      let counted = 0;
      for (let dz = 0; dz < stepZ; dz++) {
        const z = row * stepZ + dz;
        if (z >= grid.height) break;
        for (let dx = 0; dx < stepX; dx++) {
          const x = col * stepX + dx;
          if (x >= grid.width) break;
          sum += height(z * grid.width + x);
          counted++;
        }
      }
      data[(rows - 1 - row) * width + col] = counted
        ? (sum / counted - min) / span
        : 0;
    }
  }
}
